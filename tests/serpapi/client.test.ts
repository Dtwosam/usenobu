import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  InMemorySearchUsageRecorder,
  SerpApiShoppingClient,
  assertNoSecretLeak,
  buildCapabilityReport,
  createSerpApiClientFromEnv,
} from "../../src/serpapi/index.js";

function loadFixture(name: string): unknown {
  const p = path.join(process.cwd(), "tests/fixtures/serpapi", name);
  return JSON.parse(readFileSync(p, "utf8")) as unknown;
}

const API_KEY = "unit_test_serpapi_key_DO_NOT_COMMIT_REAL";

describe("SerpApiShoppingClient", () => {
  it("createSerpApiClientFromEnv returns null without key", () => {
    expect(createSerpApiClientFromEnv({})).toBeNull();
  });

  it("normalizes fixtures and records usage when requested", () => {
    const usage = new InMemorySearchUsageRecorder();
    const client = new SerpApiShoppingClient({
      apiKey: API_KEY,
      usageCounter: usage,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
    });
    const result = client.normalizeFixture(
      loadFixture("shopping-success-target.json"),
      { q: "Example Target" },
      { recordAsSearch: true, live: false, httpStatus: 200 },
    );
    expect(result.provider_status).toBe("LIVE_TARGET_MATCH");
    expect(usage.getCount()).toBe(1);
    expect(result.searches_recorded).toBe(1);
  });

  it("searchShopping success path uses fetch, increments usage, redacts key", async () => {
    const usage = new InMemorySearchUsageRecorder();
    const body = loadFixture("shopping-success-target.json");
    const fetchImpl: typeof fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("engine=google_shopping");
      expect(url).toContain("api_key=");
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new SerpApiShoppingClient({
      apiKey: API_KEY,
      fetchImpl,
      usageCounter: usage,
      now: () => new Date("2026-07-13T16:00:00.000Z"),
    });

    const result = await client.searchShopping({
      q: "Example Wireless Earbuds Target",
      location: "Austin, Texas, United States",
    });

    expect(result.live).toBe(true);
    expect(result.provider_status).toBe("LIVE_TARGET_MATCH");
    expect(result.target_offers).toHaveLength(1);
    expect(usage.getCount()).toBe(1);
    expect(result.searches_recorded).toBe(1);

    const serialized = JSON.stringify(result);
    assertNoSecretLeak(serialized, API_KEY);
    expect(serialized).not.toContain(API_KEY);
  });

  it("maps HTTP 429 to PROVIDER_RATE_LIMITED and records search", async () => {
    const usage = new InMemorySearchUsageRecorder();
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Rate limit" }), {
        status: 429,
      });
    });
    const client = new SerpApiShoppingClient({
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      usageCounter: usage,
    });
    const result = await client.searchShopping({ q: "Target item" });
    expect(result.provider_status).toBe("PROVIDER_RATE_LIMITED");
    expect(usage.getCount()).toBe(1);
    expect(usage.getEntries()[0]?.http_status).toBe(429);
  });

  it("maps timeout to PROVIDER_ERROR without leaking key", async () => {
    const usage = new InMemorySearchUsageRecorder();
    const fetchImpl = vi.fn(async () => {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    });
    const client = new SerpApiShoppingClient({
      apiKey: API_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      usageCounter: usage,
      defaultTimeoutMs: 5,
    });
    const result = await client.searchShopping({ q: "Target item" });
    expect(result.provider_status).toBe("PROVIDER_ERROR");
    expect(result.error_message?.toLowerCase()).toContain("timed out");
    assertNoSecretLeak(JSON.stringify(result), API_KEY);
    expect(usage.getCount()).toBe(1);
  });

  it("maps 500 responses to PROVIDER_ERROR", async () => {
    const client = new SerpApiShoppingClient({
      apiKey: API_KEY,
      fetchImpl: (async () =>
        new Response("{}", { status: 500 })) as unknown as typeof fetch,
    });
    const result = await client.searchShopping({ q: "Target item" });
    expect(result.provider_status).toBe("PROVIDER_ERROR");
  });

  it("builds offline capability report from fixture without inventing live proof", () => {
    const client = new SerpApiShoppingClient({ apiKey: API_KEY });
    const result = client.normalizeFixture(
      loadFixture("shopping-success-target.json"),
      { q: "Example Target" },
      { live: false },
    );
    const report = buildCapabilityReport(result);
    expect(report.live).toBe(false);
    expect(report.provider).toBe("SerpApi");
    expect(report.target_offer_count).toBe(1);
    expect(report.fields.find((f) => f.field === "extracted_price")?.available).toBe(
      true,
    );
    expect(report.disclaimer.toLowerCase()).toContain("third-party");
    expect(report.notes.some((n) => n.includes("not live proof"))).toBe(true);
  });
});
