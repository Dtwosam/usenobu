/**
 * Lane 8-R1A — sustainable policy operations.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyMemoryOwnerReview,
  buildDefaultPolicyOperationsRecord,
  countMemoryActiveOwnerAlerts,
  evaluateTargetPolicy,
  getMemoryPolicyRuntime,
  OwnerReviewAction,
  PolicyReviewState,
  resetMemoryPolicyOps,
  runMemoryPolicyReviewScheduler,
  setMemoryPolicyRecord,
  TARGET_US_POLICY,
} from "../../src/policy/index.js";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  authorizeOwnerRequest,
  getOwnerOpsSecret,
} from "../../src/policy/operations/auth.js";
import {
  applyOwnerReview as applyDbOwnerReview,
  ensureDefaultPolicyOperations,
  runPolicyReviewScheduler as runDbScheduler,
  countActiveOwnerAlerts,
  getPolicyRuntime,
} from "../../src/policy/operations/store.js";

const baseEval = {
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

describe("policy operations runtime rules", () => {
  beforeEach(() => {
    resetMemoryPolicyOps();
  });

  it("CURRENT returns normal positive eligibility", () => {
    const record = buildDefaultPolicyOperationsRecord(
      "2026-07-19T18:00:00.000Z",
    );
    const result = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T20:00:00.000Z",
      policy_operations: record,
    });
    expect(result.status).toBe("PRICE_DROP_DETECTED");
    expect(result.check_status).toBe("POTENTIALLY_ELIGIBLE");
    expect(result.eligibility_suppressed).toBe(false);
    expect(result.policy_runtime?.effective_state).toBe(
      PolicyReviewState.CURRENT,
    );
  });

  it("CHECK_DUE continues matching/price comparison with warning", () => {
    const record = {
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.CHECK_DUE,
      next_review_at: "2026-07-19T18:00:00.000Z",
    };
    const result = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-20T12:00:00.000Z",
      policy_operations: record,
    });
    expect(result.status).toBe("PRICE_DROP_DETECTED");
    expect(result.observed_target_price).toBe(30);
    expect(result.potential_recovery).toBe(9.99);
    expect(result.policy_warning).toMatch(/review is due/i);
    expect(result.status).not.toBe("POLICY_STALE");
  });

  it("SOURCE_UNAVAILABLE continues within grace and blocks after grace", () => {
    const base = {
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.SOURCE_UNAVAILABLE,
      source_last_checked_at: "2026-07-19T18:00:00.000Z",
    };

    const inGrace = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-20T18:00:00.000Z", // +24h < 72h grace
      policy_operations: base,
    });
    expect(inGrace.status).toBe("PRICE_DROP_DETECTED");
    expect(inGrace.policy_warning).toMatch(/unavailable/i);
    expect(inGrace.status).not.toBe("POLICY_STALE");

    const pastGrace = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-23T19:00:00.000Z", // >72h
      policy_operations: base,
    });
    expect(pastGrace.status).toBe("POLICY_STALE");
    expect(pastGrace.reasons).toContain(
      "policy_source_unavailable_grace_expired",
    );
  });

  it("CHANGE_DETECTED preserves factual prices but suppresses positive eligibility", () => {
    const record = {
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.CHANGE_DETECTED,
    };
    const result = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T20:00:00.000Z",
      policy_operations: record,
    });
    expect(result.observed_target_price).toBe(30);
    expect(result.potential_recovery).toBe(9.99);
    expect(result.eligibility_suppressed).toBe(true);
    expect(result.check_status).not.toBe("POTENTIALLY_ELIGIBLE");
    expect(result.reasons).toContain(
      "policy_eligibility_suppressed_pending_review",
    );
    expect(result.policy_warning).toBeTruthy();
  });

  it("REVIEW_REQUIRED suppresses positive eligibility like CHANGE_DETECTED", () => {
    const record = {
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.REVIEW_REQUIRED,
    };
    const result = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T20:00:00.000Z",
      policy_operations: record,
    });
    expect(result.eligibility_suppressed).toBe(true);
    expect(result.check_status).not.toBe("POTENTIALLY_ELIGIBLE");
    expect(result.observed_target_price).toBe(30);
  });

  it("RETIRED blocks Target eligibility safely with POLICY_STALE", () => {
    const record = {
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.RETIRED,
      retired_at: "2026-07-19T20:00:00.000Z",
    };
    const result = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T21:00:00.000Z",
      policy_operations: record,
    });
    expect(result.status).toBe("POLICY_STALE");
    expect(result.reasons).toContain("policy_retired");
    expect(result.policy_runtime?.block_positive_service).toBe(true);
  });
});

describe("owner review + durable alerts (memory)", () => {
  beforeEach(() => {
    resetMemoryPolicyOps();
  });

  it("scheduler marks overdue CURRENT as CHECK_DUE and creates one alert", () => {
    setMemoryPolicyRecord({
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      next_review_at: "2026-07-19T18:00:00.000Z",
      review_state: PolicyReviewState.CURRENT,
    });
    const first = runMemoryPolicyReviewScheduler("2026-07-21T00:00:00.000Z");
    expect(first.transitioned).toBe(true);
    expect(first.alert_created).toBe(true);
    expect(first.runtime.effective_state).toBe(PolicyReviewState.CHECK_DUE);
    expect(countMemoryActiveOwnerAlerts()).toBe(1);

    const second = runMemoryPolicyReviewScheduler("2026-07-21T01:00:00.000Z");
    expect(second.transitioned).toBe(false);
    expect(second.alert_created).toBe(false);
    expect(countMemoryActiveOwnerAlerts()).toBe(1);
  });

  it("UNCHANGED owner review restores CURRENT without code changes", () => {
    setMemoryPolicyRecord({
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.CHECK_DUE,
      next_review_at: "2026-07-19T18:00:00.000Z",
    });
    runMemoryPolicyReviewScheduler("2026-07-21T00:00:00.000Z");
    expect(countMemoryActiveOwnerAlerts()).toBe(1);

    const reviewed = applyMemoryOwnerReview({
      action: OwnerReviewAction.UNCHANGED,
      actor: "owner",
      nowIso: "2026-07-21T02:00:00.000Z",
      note: "Official Target page unchanged",
    });
    expect(reviewed.record.review_state).toBe(PolicyReviewState.CURRENT);
    expect(reviewed.record.source_last_checked_at).toBe(
      "2026-07-21T02:00:00.000Z",
    );
    expect(
      new Date(reviewed.record.next_review_at).getTime(),
    ).toBeGreaterThan(new Date("2026-07-21T02:00:00.000Z").getTime());
    expect(countMemoryActiveOwnerAlerts()).toBe(0);

    const runtime = getMemoryPolicyRuntime("2026-07-21T03:00:00.000Z");
    expect(runtime.effective_state).toBe(PolicyReviewState.CURRENT);
  });

  it("MATERIAL_CHANGE_DETECTED preserves approved policy and creates pending review", () => {
    const result = applyMemoryOwnerReview({
      action: OwnerReviewAction.MATERIAL_CHANGE_DETECTED,
      actor: "owner",
      nowIso: "2026-07-21T02:00:00.000Z",
      note: "Window wording may have changed — do not auto-apply",
    });
    expect(result.record.review_state).toBe(PolicyReviewState.REVIEW_REQUIRED);
    expect(result.record.policy_version).toBe(TARGET_US_POLICY.policy_version);
    expect(result.pending_review_id).toBeTruthy();
  });
});

describe("owner review + durable alerts (sqlite)", () => {
  it("migrations include policy_operations tables and seed works", () => {
    const db = openDatabase(":memory:");
    try {
      const applied = migrateUp(db);
      expect(applied).toContain("0004_policy_operations");
      const record = ensureDefaultPolicyOperations(
        db,
        "2026-07-19T18:00:00.000Z",
      );
      expect(record.policy_id).toBe(TARGET_US_POLICY.policy_id);
      expect(record.review_state).toBe(PolicyReviewState.CURRENT);
    } finally {
      db.close();
    }
  });

  it("scheduler and UNCHANGED are durable and idempotent", () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      ensureDefaultPolicyOperations(db, "2026-07-19T18:00:00.000Z");
      // Force overdue by rewriting next_review_at
      db.prepare(
        `UPDATE policy_operations SET next_review_at = ?, review_state = ?`,
      ).run("2026-07-19T18:00:00.000Z", PolicyReviewState.CURRENT);

      const first = runDbScheduler(db, "2026-07-21T00:00:00.000Z");
      expect(first.transitioned).toBe(true);
      expect(first.alert_created).toBe(true);
      expect(countActiveOwnerAlerts(db)).toBe(1);

      const second = runDbScheduler(db, "2026-07-21T01:00:00.000Z");
      expect(second.transitioned).toBe(false);
      expect(second.alert_created).toBe(false);
      expect(countActiveOwnerAlerts(db)).toBe(1);

      applyDbOwnerReview(db, {
        action: OwnerReviewAction.UNCHANGED,
        actor: "owner",
        nowIso: "2026-07-21T02:00:00.000Z",
      });
      expect(countActiveOwnerAlerts(db)).toBe(0);
      const runtime = getPolicyRuntime(db, "2026-07-21T03:00:00.000Z");
      expect(runtime.effective_state).toBe(PolicyReviewState.CURRENT);
    } finally {
      db.close();
    }
  });

  it("unauthorized owner request is rejected", () => {
    const prevOwner = process.env.OWNER_OPS_SECRET;
    const prevCron = process.env.CRON_SECRET;
    process.env.OWNER_OPS_SECRET = "test-owner-secret-not-real";
    delete process.env.CRON_SECRET;

    const bad = authorizeOwnerRequest(
      new Request("http://localhost/v1/owner/policy-review", {
        headers: { Authorization: "Bearer wrong" },
      }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(401);

    const good = authorizeOwnerRequest(
      new Request("http://localhost/v1/owner/policy-review", {
        headers: { Authorization: "Bearer test-owner-secret-not-real" },
      }),
    );
    expect(good.ok).toBe(true);

    if (prevOwner === undefined) delete process.env.OWNER_OPS_SECRET;
    else process.env.OWNER_OPS_SECRET = prevOwner;
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  });

  it("missing owner secret returns 503 configuration error", () => {
    const prevOwner = process.env.OWNER_OPS_SECRET;
    const prevCron = process.env.CRON_SECRET;
    delete process.env.OWNER_OPS_SECRET;
    delete process.env.CRON_SECRET;
    expect(getOwnerOpsSecret()).toBeNull();
    const res = authorizeOwnerRequest(
      new Request("http://localhost/v1/owner/policy-status", {
        headers: { Authorization: "Bearer anything" },
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.error).toBe("owner_ops_secret_not_configured");
    }
    if (prevOwner === undefined) delete process.env.OWNER_OPS_SECRET;
    else process.env.OWNER_OPS_SECRET = prevOwner;
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  });
});

describe("fail-closed matching still independent of ops", () => {
  it("missing locked fingerprint remains MATCH_REVIEW_REQUIRED under CHECK_DUE", () => {
    const record = {
      ...buildDefaultPolicyOperationsRecord("2026-07-19T18:00:00.000Z"),
      review_state: PolicyReviewState.CHECK_DUE,
    };
    const result = evaluateTargetPolicy({
      ...baseEval,
      has_locked_fingerprint: false,
      evaluated_at: "2026-07-20T12:00:00.000Z",
      policy_operations: record,
    });
    expect(result.status).toBe("MATCH_REVIEW_REQUIRED");
    expect(result.reasons).toContain("no_locked_exact_match");
  });
});
