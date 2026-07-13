import { describe, expect, it } from "vitest";
import { safeParseTargetProductCandidate } from "../../src/domain/index.js";

const valid = {
  candidate_id: "cand-1",
  provider: "SerpApi",
  engine: "google_shopping",
  seller_kind: "target",
  seller_text: "Target",
  product_title: "Example Widget",
  product_url: "https://www.target.com/p/example/-/A-12345678",
  target_item_id: "12345678",
  model_number: "ABC-100",
  observed_price: 24.99,
  currency: "USD",
  observed_at: "2026-07-13T12:00:00.000Z",
  is_target_plus: false,
};

describe("TargetProductCandidateSchema", () => {
  it("accepts a Target seller candidate", () => {
    const result = safeParseTargetProductCandidate(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid price and currency", () => {
    expect(
      safeParseTargetProductCandidate({ ...valid, observed_price: 0 }).success,
    ).toBe(false);
    expect(
      safeParseTargetProductCandidate({ ...valid, currency: "CAD" }).success,
    ).toBe(false);
  });

  it("rejects Target Plus marked as seller_kind target", () => {
    expect(
      safeParseTargetProductCandidate({
        ...valid,
        is_target_plus: true,
        seller_kind: "target",
      }).success,
    ).toBe(false);
  });

  it("accepts Target Plus as explicit seller_kind for fail-closed review", () => {
    const result = safeParseTargetProductCandidate({
      ...valid,
      is_target_plus: true,
      seller_kind: "target_plus",
      seller_text: "Target Plus",
    });
    expect(result.success).toBe(true);
  });
});
