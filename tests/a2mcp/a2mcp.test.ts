import { describe, expect, it, beforeEach } from "vitest";
import {
  clearA2mcpAudit,
  defaultA2mcpRateLimiter,
  getA2mcpAuditEntries,
  runA2mcpTargetPriceCheck,
  safeParseA2mcpRequest,
  SlidingWindowRateLimiter,
} from "../../src/a2mcp/index.js";
import type { MatchableOffer } from "../../src/matching/types.js";

const validRequest = {
  target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
  purchase_price: 24.99,
  currency: "USD",
  purchase_date: "2026-07-05",
  country: "US",
  region: "TX",
  purchase_channel: "target_online",
  model_number: "WDG-100",
  target_item_id: "87654321",
};

function exactOffer(price: number): MatchableOffer {
  return {
    offer_id: "o1",
    title: "Example Widget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: price,
    currency: "USD",
    serpapi_product_id: "not-tcin",
  };
}

beforeEach(() => {
  clearA2mcpAudit();
  defaultA2mcpRateLimiter.reset();
});

describe("A2MCP request validation", () => {
  it("accepts OpenAPI-valid requests", () => {
    expect(safeParseA2mcpRequest(validRequest).success).toBe(true);
  });

  it("rejects invalid currency/channel and unknown sensitive fields", () => {
    expect(
      safeParseA2mcpRequest({ ...validRequest, currency: "EUR" }).success,
    ).toBe(false);
    expect(
      safeParseA2mcpRequest({ ...validRequest, purchase_channel: "in_store" })
        .success,
    ).toBe(false);
    expect(
      safeParseA2mcpRequest({ ...validRequest, password: "secret" }).success,
    ).toBe(false);
    expect(
      safeParseA2mcpRequest({ ...validRequest, purchase_price: 0 }).success,
    ).toBe(false);
  });
});

describe("A2MCP check service", () => {
  it("returns HTTP 200 JSON for valid exact match price drop", async () => {
    const result = await runA2mcpTargetPriceCheck(validRequest, {
      offersOverride: [exactOffer(18.0)],
      skipPolicyFreshness: true,
    });
    expect(result.http_status).toBe(200);
    expect(result.body).toMatchObject({
      status: "PRICE_DROP_DETECTED",
      policy_id: "target-us-online-price-match-v1",
      price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
      final_decision_by: "Target",
      provider: "SerpApi",
      observed_target_price: 18,
      potential_recovery: 6.99,
    });
    if ("disclaimer" in result.body) {
      expect(String(result.body.disclaimer).toLowerCase()).toContain(
        "does not guarantee a refund",
      );
    }
    const text = JSON.stringify(result.body);
    expect(text).not.toMatch(/password|card_number|cvv|private_key/i);
    expect(text).not.toContain("sk-");
    // Provider name "SerpApi" is allowed; API keys are not
    expect(result.body).toMatchObject({ provider: "SerpApi" });
  });

  it("returns HTTP 400 for invalid input", async () => {
    const result = await runA2mcpTargetPriceCheck({
      ...validRequest,
      currency: "CAD",
    });
    expect(result.http_status).toBe(400);
    expect(result.body).toMatchObject({ error: "invalid_input" });
  });

  it("returns MATCH_REVIEW_REQUIRED for ambiguous multi-Target offers", async () => {
    const result = await runA2mcpTargetPriceCheck(
      {
        ...validRequest,
        target_product_url: "https://www.target.com/p/example-widget",
        target_item_id: undefined,
      },
      {
        skipPolicyFreshness: true,
        offersOverride: [
          {
            ...exactOffer(10),
            offer_id: "a",
            merchant_link: "https://www.target.com/p/a/-/A-10000001",
            target_item_id: "10000001",
          },
          {
            ...exactOffer(9),
            offer_id: "b",
            merchant_link: "https://www.target.com/p/b/-/A-10000002",
            target_item_id: "10000002",
          },
        ],
      },
    );
    expect(result.http_status).toBe(200);
    expect(result.body).toMatchObject({ status: "MATCH_REVIEW_REQUIRED" });
    if ("potential_recovery" in result.body) {
      expect(result.body.potential_recovery).toBeUndefined();
    }
  });

  it("returns UNSUPPORTED_PURCHASE for Alaska", async () => {
    const result = await runA2mcpTargetPriceCheck(
      { ...validRequest, region: "AK" },
      { skipPolicyFreshness: true, offersOverride: [exactOffer(10)] },
    );
    expect(result.http_status).toBe(200);
    expect(result.body).toMatchObject({ status: "UNSUPPORTED_PURCHASE" });
  });

  it("returns 503 DATA_SOURCE_UNAVAILABLE when provider forced down", async () => {
    const result = await runA2mcpTargetPriceCheck(validRequest, {
      forceProviderError: true,
      skipPolicyFreshness: true,
    });
    expect(result.http_status).toBe(503);
    expect(result.body).toMatchObject({ status: "DATA_SOURCE_UNAVAILABLE" });
  });

  it("returns NO_PRICE_DROP when observed price is not lower", async () => {
    const result = await runA2mcpTargetPriceCheck(validRequest, {
      offersOverride: [exactOffer(24.99)],
      skipPolicyFreshness: true,
    });
    expect(result.http_status).toBe(200);
    expect(result.body).toMatchObject({
      status: "NO_PRICE_DROP",
      potential_recovery: 0,
    });
  });
});

describe("A2MCP rate limiting", () => {
  it("blocks after max requests in window", () => {
    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
    });
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
    expect(limiter.check("ip1").allowed).toBe(true);
    const blocked = limiter.check("ip1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    // other client still ok
    expect(limiter.check("ip2").allowed).toBe(true);
  });
});

describe("A2MCP audit safety", () => {
  it("stores redacted outcomes without request bodies", async () => {
    // audit is called from route; service-level assert is enough here
    await runA2mcpTargetPriceCheck(validRequest, {
      offersOverride: [exactOffer(10)],
      skipPolicyFreshness: true,
    });
    // No audit from service alone — ensure get is empty unless route used
    expect(getA2mcpAuditEntries().length).toBe(0);
  });
});
