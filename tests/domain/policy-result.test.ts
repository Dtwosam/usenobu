import { describe, expect, it } from "vitest";
import { safeParseTargetPolicyResult } from "../../src/domain/index.js";

const base = {
  status: "NO_PRICE_DROP",
  policy_id: "target-us-online-price-match-v1",
  policy_version: "v1",
  policy_verified_at: "2026-07-13T00:00:00.000Z",
  purchase_price: 30,
  observed_target_price: 30,
  potential_recovery: 0,
  currency: "USD",
  days_since_purchase: 2,
  days_remaining: 12,
  price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
  final_decision_by: "Target",
  disclaimer:
    "Observed Target price is third-party data. Target must verify the lower price and makes the final decision.",
  reasons: ["price_not_lower"],
  evaluated_at: "2026-07-13T12:00:00.000Z",
};

describe("TargetPolicyResultSchema", () => {
  it("accepts a structured non-positive policy result", () => {
    const result = safeParseTargetPolicyResult(base);
    expect(result.success).toBe(true);
  });

  it("accepts PRICE_DROP_DETECTED with recovery fields", () => {
    const result = safeParseTargetPolicyResult({
      ...base,
      status: "PRICE_DROP_DETECTED",
      check_status: "PRICE_DROP_DETECTED",
      observed_target_price: 22,
      potential_recovery: 8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects positive eligibility without required price fields", () => {
    expect(
      safeParseTargetPolicyResult({
        ...base,
        status: "POTENTIALLY_ELIGIBLE",
        observed_target_price: undefined,
        potential_recovery: undefined,
      }).success,
    ).toBe(false);
  });

  it("rejects wrong policy id or final decision party", () => {
    expect(
      safeParseTargetPolicyResult({
        ...base,
        policy_id: "amazon-us-v1",
      }).success,
    ).toBe(false);
    expect(
      safeParseTargetPolicyResult({
        ...base,
        final_decision_by: "Nobu",
      }).success,
    ).toBe(false);
  });

  it("rejects forbidden guarantee language in disclaimer", () => {
    expect(
      safeParseTargetPolicyResult({
        ...base,
        disclaimer: "Guaranteed refund from Target",
      }).success,
    ).toBe(false);
  });

  it("rejects non-USD currency on results", () => {
    expect(
      safeParseTargetPolicyResult({
        ...base,
        currency: "EUR",
      }).success,
    ).toBe(false);
  });
});
