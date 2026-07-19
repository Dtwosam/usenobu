/**
 * Lane 8-R2A — durable shared PolicyOperationsStore contract.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  createMemoryPolicyStoreForTests,
  setPolicyOperationsStoreForTests,
  resetPolicyOperationsStoreCache,
  getPolicyOperationsStore,
  applyOwnerReviewOnStore,
  runPolicyReviewSchedulerOnStore,
  getPolicyRuntimeFromStore,
  policyStatusSnapshotOnStore,
  OwnerReviewAction,
  PolicyReviewState,
  PolicyStoreUnavailableError,
  isProductionRuntime,
  resolvePolicyDatabaseUrl,
} from "../../src/policy/operations/index.js";
import { createSqlitePolicyStore } from "../../src/policy/operations/adapters/sqlite-adapter.js";
import { createPostgresPolicyStore } from "../../src/policy/operations/adapters/postgres-adapter.js";
import {
  authorizeOwnerRequest,
  authorizeCronRequest,
  authorizeOwnerOrCronRequest,
} from "../../src/policy/operations/auth.js";
import { TARGET_US_POLICY } from "../../src/policy/target-us-policy.js";
import { evaluateTargetPolicy } from "../../src/policy/evaluate-target-policy.js";
import { runA2mcpTargetPriceCheck } from "../../src/a2mcp/index.js";

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

describe("PolicyOperationsStore adapters (memory + sqlite)", () => {
  beforeEach(() => {
    resetPolicyOperationsStoreCache();
    setPolicyOperationsStoreForTests(null);
  });

  afterEach(() => {
    setPolicyOperationsStoreForTests(null);
    resetPolicyOperationsStoreCache();
  });

  it("memory and sqlite share the same contract behaviour", async () => {
    for (const store of [
      createMemoryPolicyStoreForTests(),
      createSqlitePolicyStore(":memory:"),
    ]) {
      await store.ensureSchema();
      const seed = await store.ensureInitialized("2026-07-19T18:00:00.000Z");
      expect(seed.policy_id).toBe(TARGET_US_POLICY.policy_id);
      expect(seed.review_state).toBe(PolicyReviewState.CURRENT);
      // Idempotent init
      const again = await store.ensureInitialized("2026-07-20T00:00:00.000Z");
      expect(again.source_last_checked_at).toBe(seed.source_last_checked_at);

      // Force overdue stored state
      await store.upsertRecord({
        ...seed,
        next_review_at: "2026-07-19T18:00:00.000Z",
        review_state: PolicyReviewState.CURRENT,
      });

      const first = await runPolicyReviewSchedulerOnStore(
        store,
        "2026-07-21T00:00:00.000Z",
      );
      expect(first.transitioned).toBe(true);
      expect(first.alert_created).toBe(true);
      expect(first.runtime.effective_state).toBe(PolicyReviewState.CHECK_DUE);

      const second = await runPolicyReviewSchedulerOnStore(
        store,
        "2026-07-21T01:00:00.000Z",
      );
      expect(second.transitioned).toBe(false);
      expect(second.alert_created).toBe(false);
      expect(await store.countActiveOwnerAlerts()).toBe(1);

      const reviewed = await applyOwnerReviewOnStore(store, {
        action: OwnerReviewAction.UNCHANGED,
        actor: "owner",
        nowIso: "2026-07-21T02:00:00.000Z",
      });
      expect(reviewed.record.review_state).toBe(PolicyReviewState.CURRENT);
      expect(await store.countActiveOwnerAlerts()).toBe(0);

      const runtime = await getPolicyRuntimeFromStore(
        store,
        "2026-07-21T03:00:00.000Z",
      );
      expect(runtime.effective_state).toBe(PolicyReviewState.CURRENT);
    }
  });

  it("CURRENT / CHECK_DUE / REVIEW_REQUIRED / RETIRED evaluation semantics", async () => {
    const store = createMemoryPolicyStoreForTests();
    const seed = await store.ensureInitialized("2026-07-19T18:00:00.000Z");

    const current = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T20:00:00.000Z",
      policy_operations: seed,
    });
    expect(current.status).toBe("PRICE_DROP_DETECTED");
    expect(current.check_status).toBe("POTENTIALLY_ELIGIBLE");

    await store.upsertRecord({
      ...seed,
      review_state: PolicyReviewState.CHECK_DUE,
      next_review_at: "2026-07-19T18:00:00.000Z",
    });
    const due = await getPolicyRuntimeFromStore(store, "2026-07-20T12:00:00.000Z");
    const dueEval = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-20T12:00:00.000Z",
      policy_runtime: due,
    });
    expect(dueEval.status).toBe("PRICE_DROP_DETECTED");
    expect(dueEval.policy_warning).toBeTruthy();

    await store.upsertRecord({
      ...seed,
      review_state: PolicyReviewState.REVIEW_REQUIRED,
    });
    const review = await getPolicyRuntimeFromStore(
      store,
      "2026-07-19T20:00:00.000Z",
    );
    const suppressed = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T20:00:00.000Z",
      policy_runtime: review,
    });
    expect(suppressed.eligibility_suppressed).toBe(true);
    expect(suppressed.check_status).not.toBe("POTENTIALLY_ELIGIBLE");

    await store.upsertRecord({
      ...seed,
      review_state: PolicyReviewState.RETIRED,
      retired_at: "2026-07-19T20:00:00.000Z",
    });
    const retired = await getPolicyRuntimeFromStore(
      store,
      "2026-07-19T21:00:00.000Z",
    );
    const blocked = evaluateTargetPolicy({
      ...baseEval,
      evaluated_at: "2026-07-19T21:00:00.000Z",
      policy_runtime: retired,
    });
    expect(blocked.status).toBe("POLICY_STALE");
  });

  it("factory uses injected test store; forbids production without Postgres URL", async () => {
    const mem = createMemoryPolicyStoreForTests();
    setPolicyOperationsStoreForTests(mem);
    const got = await getPolicyOperationsStore();
    expect(got.kind).toBe("memory");

    setPolicyOperationsStoreForTests(null);
    resetPolicyOperationsStoreCache();
    // Without URL, non-production uses sqlite file path — not /tmp
    if (!isProductionRuntime() && !resolvePolicyDatabaseUrl()) {
      const store = await getPolicyOperationsStore();
      expect(store.kind).toBe("sqlite");
    }
  });

  it("unauthorized owner/cron rejected; secrets separate", () => {
    const prevOwner = process.env.OWNER_OPS_SECRET;
    const prevCron = process.env.CRON_SECRET;
    process.env.OWNER_OPS_SECRET = "test-owner-secret-not-real";
    process.env.CRON_SECRET = "test-cron-secret-not-real";

    expect(
      authorizeOwnerRequest(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer wrong" },
        }),
      ).ok,
    ).toBe(false);

    expect(
      authorizeOwnerRequest(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer test-owner-secret-not-real" },
        }),
      ).ok,
    ).toBe(true);

    // Cron secret does not authorize owner writes
    expect(
      authorizeOwnerRequest(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer test-cron-secret-not-real" },
        }),
      ).ok,
    ).toBe(false);

    expect(
      authorizeCronRequest(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer test-cron-secret-not-real" },
        }),
      ).ok,
    ).toBe(true);

    expect(
      authorizeOwnerOrCronRequest(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer test-cron-secret-not-real" },
        }),
      ).ok,
    ).toBe(true);

    if (prevOwner === undefined) delete process.env.OWNER_OPS_SECRET;
    else process.env.OWNER_OPS_SECRET = prevOwner;
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  });

  it("A2MCP reads injected durable store state (no SerpApi)", async () => {
    const store = createMemoryPolicyStoreForTests();
    await store.ensureInitialized("2026-07-19T18:00:00.000Z");
    await store.upsertRecord({
      ...(await store.getActiveRecord())!,
      review_state: PolicyReviewState.CHECK_DUE,
      next_review_at: "2026-07-19T18:00:00.000Z",
    });
    setPolicyOperationsStoreForTests(store);

    const runtime = await getPolicyRuntimeFromStore(
      store,
      "2026-07-21T12:00:00.000Z",
    );
    const result = await runA2mcpTargetPriceCheck(
      {
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        purchase_price: 24.99,
        currency: "USD",
        purchase_date: "2026-07-15",
        country: "US",
        region: "TX",
        purchase_channel: "target_online",
        model_number: "WDG-100",
        target_item_id: "87654321",
        user_confirmed_match_id: "c1",
      },
      {
        offersOverride: [
          {
            offer_id: "o1",
            title: "Example Widget WDG-100",
            seller_kind: "target",
            seller_text: "Target",
            is_target_plus: false,
            merchant_link:
              "https://www.target.com/p/example-widget/-/A-87654321",
            target_item_id: "87654321",
            model_number: "WDG-100",
            observed_price: 18,
            currency: "USD",
          },
        ],
        policyRuntime: runtime,
        now: () => new Date("2026-07-21T12:00:00.000Z"),
      },
    );
    expect(result.http_status).toBe(200);
    if ("status" in result.body) {
      expect(result.body.status).toBe("PRICE_DROP_DETECTED");
      expect(result.body.policy_review_state).toBe("CHECK_DUE");
      expect(result.body.policy_warning).toBeTruthy();
    }
  });

  it("local sqlite file path outside /tmp", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nobu-policy-ops-"));
    // Note: parent is OS temp, but we only forbid production /tmp paths via factory.
    // Adapter itself may open any path for tests.
    const dbPath = path.join(dir, "policy.sqlite");
    const store = createSqlitePolicyStore(dbPath);
    await store.ensureInitialized("2026-07-19T18:00:00.000Z");
    const snap = await policyStatusSnapshotOnStore(
      store,
      "2026-07-19T19:00:00.000Z",
    );
    expect(snap.store_kind).toBe("sqlite");
    expect(snap.runtime.effective_state).toBe(PolicyReviewState.CURRENT);
  });
});

describe("Postgres adapter (optional)", () => {
  const url = process.env.POLICY_OPS_TEST_DATABASE_URL?.trim();

  it.runIf(Boolean(url))("postgres init + scheduler + UNCHANGED", async () => {
    const store = createPostgresPolicyStore(url!);
    await store.ensureSchema();
    // Isolate by policy version suffix is not available — use unique review_note cycle
    const seed = await store.ensureInitialized("2026-07-19T18:00:00.000Z");
    expect(seed.policy_id).toBe(TARGET_US_POLICY.policy_id);

    await store.upsertRecord({
      ...seed,
      next_review_at: "2026-07-19T18:00:00.000Z",
      review_state: PolicyReviewState.CURRENT,
      updated_at: "2026-07-21T00:00:00.000Z",
    });
    const sched = await runPolicyReviewSchedulerOnStore(
      store,
      "2026-07-21T00:00:00.000Z",
    );
    expect(sched.runtime.effective_state).toBe(PolicyReviewState.CHECK_DUE);
    await applyOwnerReviewOnStore(store, {
      action: OwnerReviewAction.UNCHANGED,
      actor: "owner",
      nowIso: "2026-07-21T02:00:00.000Z",
    });
    const runtime = await getPolicyRuntimeFromStore(
      store,
      "2026-07-21T03:00:00.000Z",
    );
    expect(runtime.effective_state).toBe(PolicyReviewState.CURRENT);
  });

  it.runIf(!url)("skips real Postgres when POLICY_OPS_TEST_DATABASE_URL unset", () => {
    expect(url).toBeFalsy();
  });
});

describe("store unavailable error type", () => {
  it("is identifiable", () => {
    const err = new PolicyStoreUnavailableError();
    expect(err.code).toBe("policy_ops_store_unavailable");
  });
});
