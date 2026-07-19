import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySeller,
  isTargetStoreFilterText,
  meetsLane3LivePassCriteria,
  normalizeShoppingResponse,
} from "../../src/serpapi/index.js";

function loadFixture(name: string): unknown {
  const p = path.join(process.cwd(), "tests/fixtures/serpapi", name);
  return JSON.parse(readFileSync(p, "utf8")) as unknown;
}

const query = {
  q: "Example Target",
  gl: "us",
  hl: "en",
  location: "Austin, Texas, United States",
  device: "desktop" as const,
  no_cache: false,
};

describe("SerpApi normalize + seller classification", () => {
  it("classifies Target, Target Plus, and other sellers", () => {
    expect(classifySeller("Target").seller_kind).toBe("target");
    expect(classifySeller("Target Plus").is_target_plus).toBe(true);
    expect(classifySeller("Walmart").seller_kind).toBe("other");
  });

  it("normalizes a Target offer to LIVE_TARGET_MATCH without matching engine", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-success-target.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.provider).toBe("SerpApi");
    expect(result.engine).toBe("google_shopping");
    expect(result.provider_status).toBe("LIVE_TARGET_MATCH");
    expect(result.target_offers).toHaveLength(1);
    expect(result.result_counts).toMatchObject({
      shopping_results_count: 2,
      normalized_offers_count: 2,
      target_offers_count: 1,
    });
    expect(result.target_offers[0]?.extracted_price).toBe(29.99);
    expect(result.target_offers[0]?.link).toContain("target.com");
    expect(result.raw_result_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.live).toBe(false);
  });

  it("returns NO_TARGET_RESULT when Target seller absent", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-no-target.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.provider_status).toBe("NO_TARGET_RESULT");
    expect(result.target_offers).toHaveLength(0);
    expect(result.result_counts?.target_offers_count).toBe(0);
  });

  it("returns AMBIGUOUS_TARGET_RESULTS for multiple Target sellers", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-ambiguous-target.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.provider_status).toBe("AMBIGUOUS_TARGET_RESULTS");
    expect(result.target_offers.length).toBeGreaterThan(1);
  });

  it("does not treat Target Plus as a Target-sold offer", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-target-plus.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.target_offers).toHaveLength(0);
    expect(result.provider_status).toBe("NO_TARGET_RESULT");
    expect(result.offers[0]?.seller_kind).toBe("target_plus");
  });

  it("maps body rate-limit style errors", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-rate-limit.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 1,
      httpStatus: 200,
    });
    expect(result.provider_status).toBe("PROVIDER_RATE_LIMITED");
  });

  it("maps provider errors", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-provider-error.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 1,
      httpStatus: 400,
    });
    expect(result.provider_status).toBe("PROVIDER_ERROR");
  });

  it("extracts Target shoprs filter tokens without treating Target Plus as Target", () => {
    expect(isTargetStoreFilterText("Target")).toBe(true);
    expect(isTargetStoreFilterText("Target Plus")).toBe(false);
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-with-target-filter.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.target_shoprs_tokens).toContain("CAE_TEST_TARGET_SHOPRS_TOKEN");
    expect(result.target_shoprs_tokens.join(" ")).not.toContain("PLUS");
    expect(result.provider_status).toBe("NO_TARGET_RESULT");
    expect(result.result_counts?.categorized_results_count).toBe(0);
  });

  it("counts categorized shopping rows without exposing raw rows", () => {
    const result = normalizeShoppingResponse({
      raw: {
        categorized_shopping_results: [
          {
            title: "Popular",
            shopping_results: [
              {
                title: "Apple AirTag",
                source: "Target",
                price: "$29.99",
                link: "https://www.target.com/p/apple-airtag/-/A-54191097",
              },
              {
                title: "Apple AirTag Case",
                source: "Target Plus",
                price: "$9.99",
              },
            ],
          },
        ],
      },
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.result_counts).toMatchObject({
      shopping_results_count: 0,
      inline_shopping_results_count: 0,
      categorized_results_count: 2,
      normalized_offers_count: 2,
      target_offers_count: 1,
    });
    expect(JSON.stringify(result.result_counts)).not.toContain("Apple AirTag");
  });

  it("captures merchant_link only for non-Google hosts", () => {
    const result = normalizeShoppingResponse({
      raw: loadFixture("shopping-success-target.json"),
      query,
      observedAt: "2026-07-13T15:00:00.000Z",
      live: false,
      searchesRecorded: 0,
      httpStatus: 200,
    });
    expect(result.target_offers[0]?.merchant_link).toContain("target.com");
    expect(meetsLane3LivePassCriteria(result).pass).toBe(true);
  });
});
