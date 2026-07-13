import { describe, expect, it } from "vitest";
import { safeParsePriceObservation } from "../../src/domain/index.js";

const hash =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const provenance = {
  price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
  provider: "SerpApi",
  engine: "google_shopping",
  query: "ABC-100 Target",
  observed_at: "2026-07-13T12:00:00.000Z",
  raw_result_hash: hash,
  country: "US",
  language: "en",
  device: "desktop",
};

const validLive = {
  observation_id: "obs-1",
  provider_status: "LIVE_TARGET_MATCH",
  seller_kind: "target",
  seller_text: "Target",
  product_title: "Example Widget",
  product_url: "https://www.target.com/p/example/-/A-12345678",
  target_item_id: "12345678",
  observed_price: 22.5,
  currency: "USD",
  observed_at: "2026-07-13T12:00:00.000Z",
  is_target_plus: false,
  provenance,
};

describe("PriceObservationSchema and EvidenceProvenanceSchema", () => {
  it("accepts a live Target observation with full provenance", () => {
    const result = safeParsePriceObservation(validLive);
    expect(result.success).toBe(true);
  });

  it("rejects invalid prices and currencies on live matches", () => {
    expect(
      safeParsePriceObservation({ ...validLive, observed_price: 0 }).success,
    ).toBe(false);
    expect(
      safeParsePriceObservation({ ...validLive, currency: "GBP" }).success,
    ).toBe(false);
  });

  it("requires price and currency for positive provider statuses", () => {
    const { observed_price: _p, currency: _c, ...rest } = validLive;
    expect(safeParsePriceObservation(rest).success).toBe(false);
  });

  it("allows missing price for provider errors", () => {
    const result = safeParsePriceObservation({
      observation_id: "obs-err",
      provider_status: "PROVIDER_ERROR",
      seller_kind: "unknown",
      seller_text: "unknown",
      product_title: "n/a",
      observed_at: "2026-07-13T12:00:00.000Z",
      provenance,
    });
    expect(result.success).toBe(true);
  });

  it("rejects third-party provenance without SerpApi engine/hash", () => {
    expect(
      safeParsePriceObservation({
        ...validLive,
        provenance: {
          price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
          observed_at: "2026-07-13T12:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects bad raw_result_hash", () => {
    expect(
      safeParsePriceObservation({
        ...validLive,
        provenance: { ...provenance, raw_result_hash: "not-a-hash" },
      }).success,
    ).toBe(false);
  });
});
