/**
 * Policy freshness gate — must reverify within max_freshness_hours.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateTargetPolicy,
  TARGET_US_POLICY,
} from "../../src/policy/index.js";

describe("Target policy freshness (A.3)", () => {
  const base = {
    purchase_channel: "target_online" as const,
    country: "US" as const,
    region: "TX",
    purchase_date: "2026-07-10",
    purchase_price: 39.99,
    currency: "USD" as const,
    is_target_plus: false,
    has_receipt_or_packing_slip: true,
    has_locked_fingerprint: true,
    observed_target_price: 30,
    observed_currency: "USD" as const,
    observed_price_reliable: true,
  };

  it("verified_at is 2026-07-14", () => {
    expect(TARGET_US_POLICY.verified_at.startsWith("2026-07-14")).toBe(true);
    expect(TARGET_US_POLICY.max_freshness_hours).toBe(24);
  });

  it("fresh evaluation within 24h is not POLICY_STALE", () => {
    const result = evaluateTargetPolicy({
      ...base,
      evaluated_at: "2026-07-14T21:00:00.000Z",
    });
    expect(result.status).not.toBe("POLICY_STALE");
  });

  it("evaluation more than 24h after verified_at is POLICY_STALE", () => {
    const result = evaluateTargetPolicy({
      ...base,
      evaluated_at: "2026-07-16T21:00:00.000Z",
    });
    expect(result.status).toBe("POLICY_STALE");
  });
});
