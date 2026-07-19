import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateTargetPolicy,
  TARGET_US_POLICY,
  type TargetPolicyEvaluationInput,
} from "../../src/policy/index.js";

const PURCHASE_DATE = "2026-07-01";

function baseSupported(
  overrides: Partial<TargetPolicyEvaluationInput> = {},
): TargetPolicyEvaluationInput {
  return {
    purchase_channel: "target_online",
    country: "US",
    region: "CA",
    purchase_date: PURCHASE_DATE,
    purchase_price: 40,
    currency: "USD",
    is_target_plus: false,
    has_receipt_or_packing_slip: true,
    has_locked_fingerprint: true,
    observed_target_price: 30,
    observed_currency: "USD",
    observed_price_reliable: true,
    // Within freshness window relative to policy.verified_at
    evaluated_at: "2026-07-14T21:00:00.000Z",
    ...overrides,
  };
}

function expectBound(result: ReturnType<typeof evaluateTargetPolicy>): void {
  expect(result.policy_id).toBe(TARGET_US_POLICY.policy_id);
  expect(result.policy_version).toBe(TARGET_US_POLICY.policy_version);
  expect(result.policy_verified_at).toBe(TARGET_US_POLICY.verified_at);
  expect(result.final_decision_by).toBe("Target");
  expect(result.price_source_type).toBe("THIRD_PARTY_SEARCH_OBSERVATION");
  expect(result.disclaimer.toLowerCase()).not.toContain("guaranteed refund");
  expect(result.disclaimer.toLowerCase()).toContain(
    "target must verify the lower price",
  );
}

describe("Target policy fixture matrix", () => {
  it("binds policy snapshot facts to the YAML source file", () => {
    const yamlPath = path.join(
      process.cwd(),
      "data/retailer-policies/target-us-v1.yaml",
    );
    const yaml = readFileSync(yamlPath, "utf8");
    expect(yaml).toContain(`policy_id: ${TARGET_US_POLICY.policy_id}`);
    expect(yaml).toContain("days: 14");
    expect(yaml).toContain("target_plus: false");
    expect(yaml).toContain("alaska: false");
    expect(yaml).toContain("hawaii: false");
    expect(yaml).toContain("preorder");
    expect(yaml).toContain("clearance");
    expect(yaml).toContain(TARGET_US_POLICY.claim_route.guest_services_phone);
  });

  it("online Target-sold purchase, day 0 → PRICE_DROP_DETECTED / potentially eligible", () => {
    const result = evaluateTargetPolicy(
      baseSupported({
        purchase_date: "2026-07-13",
        evaluated_at: "2026-07-13T12:00:00.000Z",
      }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("PRICE_DROP_DETECTED");
    expect(result.check_status).toBe("POTENTIALLY_ELIGIBLE");
    expect(result.days_since_purchase).toBe(0);
    expect(result.days_remaining).toBe(14);
    expect(result.potential_recovery).toBe(10);
  });

  it("day 14 boundary still inside window", () => {
    const result = evaluateTargetPolicy(
      baseSupported({
        purchase_date: "2026-07-01",
        evaluated_at: "2026-07-15T12:00:00.000Z",
      }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("PRICE_DROP_DETECTED");
    expect(result.days_since_purchase).toBe(14);
    expect(result.days_remaining).toBe(0);
  });

  it("day 15 → WINDOW_EXPIRED", () => {
    const result = evaluateTargetPolicy(
      baseSupported({
        purchase_date: "2026-07-01",
        evaluated_at: "2026-07-16T12:00:00.000Z",
      }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("WINDOW_EXPIRED");
    expect(result.check_status).toBe("WINDOW_EXPIRED");
    expect(result.days_since_purchase).toBe(15);
    expect(result.days_remaining).toBe(0);
  });

  it("future purchase date → UNSUPPORTED_PURCHASE", () => {
    const result = evaluateTargetPolicy(
      baseSupported({
        purchase_date: "2026-07-20",
        evaluated_at: "2026-07-13T12:00:00.000Z",
      }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("UNSUPPORTED_PURCHASE");
    expect(result.reasons).toContain("future_purchase_date");
  });

  it("Alaska → UNSUPPORTED_PURCHASE", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ region: "AK" }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("UNSUPPORTED_PURCHASE");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["unsupported_region", "AK"]),
    );
  });

  it("Hawaii → UNSUPPORTED_PURCHASE", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ region: "HI" }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("UNSUPPORTED_PURCHASE");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["unsupported_region", "HI"]),
    );
  });

  it("in-store purchase → UNSUPPORTED_PURCHASE", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ purchase_channel: "in_store" }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("UNSUPPORTED_PURCHASE");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["unsupported_purchase_channel"]),
    );
  });

  it("Target Plus → POLICY_EXCLUSION", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ is_target_plus: true }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("POLICY_EXCLUSION");
    expect(result.reasons).toContain("target_plus_excluded");
  });

  it("known clearance exclusion → POLICY_EXCLUSION", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ known_exclusion: "clearance" }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("POLICY_EXCLUSION");
    expect(result.reasons).toEqual(
      expect.arrayContaining(["known_exclusion", "clearance"]),
    );
  });

  it("coupon/bonus ambiguity → POLICY_EXCLUSION fail-closed", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ known_exclusion: "coupon_or_bonus_ambiguity" }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("POLICY_EXCLUSION");
  });

  it("preorder exclusion → POLICY_EXCLUSION", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ known_exclusion: "preorder" }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("POLICY_EXCLUSION");
  });

  it("missing purchase date → UNSUPPORTED_PURCHASE", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ purchase_date: null }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("UNSUPPORTED_PURCHASE");
    expect(result.reasons).toContain("missing_purchase_date");
  });

  it("missing receipt evidence → MATCH_REVIEW_REQUIRED", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ has_receipt_or_packing_slip: false }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("MATCH_REVIEW_REQUIRED");
    expect(result.reasons).toContain("missing_receipt_or_packing_slip");
  });

  it("no locked fingerprint → MATCH_REVIEW_REQUIRED", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ has_locked_fingerprint: false }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("MATCH_REVIEW_REQUIRED");
    expect(result.reasons).toContain("no_locked_exact_match");
  });

  it("unreliable / missing observed price → NO_RELIABLE_PRICE", () => {
    const missing = evaluateTargetPolicy(
      baseSupported({ observed_target_price: null }),
      { skip_freshness_check: true },
    );
    expect(missing.status).toBe("NO_RELIABLE_PRICE");

    const unreliable = evaluateTargetPolicy(
      baseSupported({ observed_price_reliable: false }),
      { skip_freshness_check: true },
    );
    expect(unreliable.status).toBe("NO_RELIABLE_PRICE");
  });

  it("observed price not lower → NO_PRICE_DROP", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ observed_target_price: 40 }),
      { skip_freshness_check: true },
    );
    expectBound(result);
    expect(result.status).toBe("NO_PRICE_DROP");
    expect(result.potential_recovery).toBe(0);
  });

  it("retired/unusable policy → POLICY_STALE; overdue review is CHECK_DUE not STALE", () => {
    const forced = evaluateTargetPolicy(
      baseSupported({ force_policy_stale: true }),
    );
    expectBound(forced);
    expect(forced.status).toBe("POLICY_STALE");
    expect(forced.reasons).toContain("policy_retired");

    // 24h+ overdue is an operational review reminder, not a full service block.
    const byAge = evaluateTargetPolicy(
      baseSupported({
        evaluated_at: "2026-07-21T21:00:00.000Z", // >24h after verified_at
      }),
    );
    expect(byAge.status).not.toBe("POLICY_STALE");
    expect(byAge.policy_runtime?.effective_state).toBe("CHECK_DUE");
    expect(byAge.policy_warning).toBeTruthy();
  });

  it("unknown exclusion label fails closed without inventing support", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ known_exclusion: "mystery_promo_xyz" }),
      { skip_freshness_check: true },
    );
    expect(result.status).toBe("POLICY_EXCLUSION");
    expect(result.reasons[0]).toBe("unknown_exclusion_fail_closed");
  });

  it("missing channel fails closed", () => {
    const result = evaluateTargetPolicy(
      baseSupported({ purchase_channel: null }),
      { skip_freshness_check: true },
    );
    expect(result.status).toBe("UNSUPPORTED_PURCHASE");
    expect(result.reasons).toContain("missing_purchase_channel");
  });
});
