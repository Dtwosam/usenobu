/**
 * Policy operations freshness — 24h is a review reminder, not a shutdown.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateTargetPolicy,
  TARGET_US_POLICY,
  buildDefaultPolicyOperationsRecord,
  resolvePolicyRuntime,
  PolicyReviewState,
} from "../../src/policy/index.js";

describe("Target policy operations freshness (8-R1A)", () => {
  const base = {
    purchase_channel: "target_online" as const,
    country: "US" as const,
    region: "TX",
    purchase_date: "2026-07-15",
    purchase_price: 39.99,
    currency: "USD" as const,
    is_target_plus: false,
    has_receipt_or_packing_slip: true,
    has_locked_fingerprint: true,
    observed_target_price: 30,
    observed_currency: "USD" as const,
    observed_price_reliable: true,
  };

  it("verified_at is 2026-07-19 after reverification", () => {
    expect(TARGET_US_POLICY.verified_at.startsWith("2026-07-19")).toBe(true);
    expect(TARGET_US_POLICY.review_interval_hours).toBe(24);
  });

  it("CURRENT evaluation within review interval returns normal positive path", () => {
    const result = evaluateTargetPolicy({
      ...base,
      evaluated_at: "2026-07-19T19:00:00.000Z",
    });
    expect(result.status).toBe("PRICE_DROP_DETECTED");
    expect(result.check_status).toBe("POTENTIALLY_ELIGIBLE");
    expect(result.status).not.toBe("POLICY_STALE");
    expect(result.policy_runtime?.effective_state).toBe(
      PolicyReviewState.CURRENT,
    );
  });

  it("evaluation more than 24h after last check becomes CHECK_DUE, not POLICY_STALE", () => {
    const result = evaluateTargetPolicy({
      ...base,
      evaluated_at: "2026-07-21T19:00:00.000Z",
    });
    expect(result.status).toBe("PRICE_DROP_DETECTED");
    expect(result.status).not.toBe("POLICY_STALE");
    expect(result.policy_runtime?.effective_state).toBe(
      PolicyReviewState.CHECK_DUE,
    );
    expect(result.policy_warning).toBeTruthy();
    expect(result.reasons).toContain("policy_review_check_due");
  });

  it("force_policy_stale still maps to unusable POLICY_STALE (retired path)", () => {
    const result = evaluateTargetPolicy({
      ...base,
      force_policy_stale: true,
    });
    expect(result.status).toBe("POLICY_STALE");
    expect(result.reasons).toContain("policy_retired");
  });

  it("resolvePolicyRuntime marks overdue CURRENT as CHECK_DUE", () => {
    const record = buildDefaultPolicyOperationsRecord(
      "2026-07-19T18:00:00.000Z",
    );
    const runtime = resolvePolicyRuntime(record, "2026-07-21T18:00:00.000Z");
    expect(runtime.effective_state).toBe(PolicyReviewState.CHECK_DUE);
    expect(runtime.block_positive_service).toBe(false);
    expect(runtime.suppress_positive_eligibility).toBe(false);
  });
});
