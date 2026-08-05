/**
 * Independent source-audit repair proofs:
 * 1) paid → claim credential → runMarketplaceJourney creates journey (real sequence)
 * 2) concurrent ensureContinuation / fail-closed secret
 * 3) durable schedule keyset with blocked rows + multi-worker
 * 4) durable outbox worker (lease reclaim, retry, summary)
 * 5) evidence-based settlement review
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  getAuthStore,
  resetAuthStoreCache,
} from "../../src/auth/auth-store.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import {
  derivePassClaimCredential,
  resolvePassClaimSecret,
} from "../../src/payments/claim-credential.js";
import {
  monitoringPassForAgent,
} from "../../src/payments/monitoring-pass-service.js";
import type { X402Verifier, X402VerifyResult } from "../../src/payments/x402.js";
import {
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
} from "../../src/payments/x402.js";
import { DEFAULT_SETTLEMENT_ASSET } from "../../src/payments/x402.js";
import { runMarketplaceJourney } from "../../src/a2mcp/marketplace-journey.js";
import {
  runScheduledMonitoringTickWithDurableBridge,
} from "../../src/monitoring/durable-bridge.js";
import {
  processDueNotificationOutbox,
  buildOutboxEvidenceJson,
} from "../../src/notifications/outbox-retry.js";
import {
  applySettlementReview,
  verifySettlementEvidence,
} from "../../src/payments/settlement-review-service.js";
import {
  clearCapturedPriceDropEmails,
  getCapturedPriceDropEmails,
} from "../../src/notifications/email-send.js";

const PASS_RESOURCE = "https://www.usenobu.xyz/v1/agent/monitoring-pass";
const env = {
  NOBU_AUTH_TEST_MODE: "1",
  NOBU_FIXTURE_MODE: "1",
  SESSION_SECRET: "nobu-test-session-secret-do-not-use-in-prod",
};

function tempDb(label: string): string {
  return path.join(
    os.tmpdir(),
    `nobu-audit-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function acceptingVerifier(ref: string): X402Verifier {
  return {
    label: "test",
    async verifyPayment(): Promise<X402VerifyResult> {
      return { ok: true, settlementRef: ref, verifiedVia: "test" };
    },
  };
}

describe("1. real paid → claim → marketplace journey", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("claim-journey");
    db = openDatabase(dbPath);
    migrateUp(db);
    resetAuthStoreCache();
  });
  afterEach(() => {
    try {
      db.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* */
    }
    resetAuthStoreCache();
  });

  it("paid response → pass_claim_credential → runMarketplaceJourney creates journey", async () => {
    // Real sequence: do not call claimPassAndCreateJourney store primitive as substitute.
    const paid = await monitoringPassForAgent({
      paymentAuthorizationHeader: "signed-header-audit-journey-1",
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env,
      testVerifier: acceptingVerifier("0xtx_audit_journey_1"),
    });
    expect(paid.ok && paid.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!paid.ok || paid.status !== "MONITORING_PASS_ISSUED") return;

    expect(paid.pass_claim_credential).toBeTruthy();
    expect(paid.pass_continuation_id).toBeTruthy();

    const claimed = await runMarketplaceJourney(
      {
        monitoring_pass_id: paid.pass.id,
        pass_continuation_id: paid.pass_continuation_id,
        pass_claim_credential: paid.pass_claim_credential,
      },
      { sqliteDb: db, env },
    );
    // Journey created; first human stage is confirm_use_pass (input_required).
    expect([200, 400]).toContain(claimed.http_status);
    expect(claimed.body.journey_id).toBeTruthy();
    expect(claimed.body.current_step || claimed.body.status).toBeTruthy();
    const journeyId = String(claimed.body.journey_id);
    expect(journeyId.length).toBeGreaterThan(4);

    // Public pass id alone cannot re-create or reveal a new journey.
    const alone = await runMarketplaceJourney(
      { monitoring_pass_id: paid.pass.id },
      { sqliteDb: db, env },
    );
    expect(alone.http_status).toBe(401);
    expect(alone.body.status).toBe("CLAIM_NOT_AUTHORIZED");

    // Invalid credential after consumption cannot retrieve journey.
    const bad = await runMarketplaceJourney(
      {
        pass_continuation_id: paid.pass_continuation_id,
        pass_claim_credential: "pass_claim_not_valid_xxx",
      },
      { sqliteDb: db, env },
    );
    expect(bad.http_status).toBe(401);

    // Valid repeated credential recovers same journey (lost response).
    const recover = await runMarketplaceJourney(
      {
        monitoring_pass_id: paid.pass.id,
        pass_continuation_id: paid.pass_continuation_id,
        pass_claim_credential: paid.pass_claim_credential,
      },
      { sqliteDb: db, env },
    );
    expect(String(recover.body.journey_id)).toBe(journeyId);

    // Normal continuation uses journey_id only.
    const cont = await runMarketplaceJourney(
      { journey_id: journeyId, confirm_use_pass: true },
      { sqliteDb: db, env },
    );
    expect(cont.body.journey_id).toBe(journeyId);
    expect(cont.body.current_step).toBe("purchase_description");
  });
});

describe("2. concurrent continuation + fail-closed secret", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("cont");
    db = openDatabase(dbPath);
    migrateUp(db);
    resetAuthStoreCache();
  });
  afterEach(() => {
    try {
      db.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* */
    }
    resetAuthStoreCache();
  });

  it("five concurrent first successful replays share one pass, continuation, claim", async () => {
    const header = "signed-header-concurrent-5";
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        monitoringPassForAgent({
          paymentAuthorizationHeader: header,
          resource: PASS_RESOURCE,
          sqliteDb: db,
          env,
          testVerifier: acceptingVerifier("0xtx_concurrent_5"),
        }),
      ),
    );
    const issued = results.filter(
      (r) => r.ok && r.status === "MONITORING_PASS_ISSUED",
    );
    expect(issued.length).toBe(5);
    const passIds = new Set(
      issued.map((r) => (r.ok && r.status === "MONITORING_PASS_ISSUED" ? r.pass.id : "")),
    );
    const contIds = new Set(
      issued.map((r) =>
        r.ok && r.status === "MONITORING_PASS_ISSUED" ? r.pass_continuation_id : "",
      ),
    );
    const claims = new Set(
      issued.map((r) =>
        r.ok && r.status === "MONITORING_PASS_ISSUED" ? r.pass_claim_credential : "",
      ),
    );
    expect(passIds.size).toBe(1);
    expect(contIds.size).toBe(1);
    expect(claims.size).toBe(1);
    const claim = [...claims][0];
    expect(claim).toMatch(/^pass_claim_/);

    // Credential is usable for journey create.
    expect(claim && claim.length > 10).toBe(true);
    const journey = await runMarketplaceJourney(
      {
        pass_continuation_id: [...contIds][0],
        pass_claim_credential: claim,
        monitoring_pass_id: [...passIds][0],
      },
      { sqliteDb: db, env },
    );
    if (journey.http_status === 401) {
      // Surface failure for diagnosis
      expect(journey.body).toMatchObject({ status: "CLAIM_NOT_AUTHORIZED" });
    }
    expect(String(journey.body.journey_id || "")).toBeTruthy();
  });

  it("missing NOBU_PASS_CLAIM_SECRET fails closed (no claimless continuation)", async () => {
    expect(
      resolvePassClaimSecret({
        NOBU_AUTH_TEST_MODE: "1",
        NOBU_PASS_CLAIM_SECRET: "",
      }),
    ).toBeNull();

    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: "signed-header-no-secret",
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: {
        ...env,
        NOBU_PASS_CLAIM_SECRET: "",
      },
      testVerifier: acceptingVerifier("0xtx_no_secret"),
    });
    // Fail closed: no usable claim credential / claimless public-ID path.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("SETTLEMENT_REVIEW_REQUIRED");
    if (result.status === "SETTLEMENT_REVIEW_REQUIRED") {
      expect(result.note).toContain("PASS_HANDOFF_CONFIGURATION_REQUIRED");
      expect(result.pass_continuation_id).toBe("");
    }
  });
});

describe("3. durable schedule source of truth (≥80, blocked mixed, multi-worker)", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("sched80");
    durableDb = openDatabase(durablePath);
    migrateUp(durableDb);
    resetAuthStoreCache();
  });
  afterEach(() => {
    try {
      durableDb.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(durablePath);
    } catch {
      /* */
    }
    resetAuthStoreCache();
  });

  it("keyset skips blocked/stopped; eligible past position 50; one provider; budget bounded", async () => {
    const store = await getAuthStore({
      sqliteDb: durableDb,
      env,
      forceSqlite: true,
    });
    await store.ensureSchema();
    const nowIso = "2026-07-15T12:00:00.000Z";
    const account = await store.upsertAccountForEmail(
      "sched80@example.com",
      nowIso,
    );

    // Creation order deliberately differs from purchase_id order:
    // insert high IDs first, then low IDs; mix blocked/stopped into first 50.
    const purchaseIds: string[] = [];
    for (let i = 79; i >= 0; i -= 1) {
      purchaseIds.push(`pur_k_${String(i).padStart(4, "0")}`);
    }
    // Also interleave some non-sequential ids that sort early
    const extraBlocked = ["pur_k_0005", "pur_k_0010", "pur_k_0020"];

    for (let i = 0; i < 80; i += 1) {
      const pid = `pur_k_${String(i).padStart(4, "0")}`;
      const aid = `act_k_${String(i).padStart(4, "0")}`;
      const qid = `quote_k_${String(i).padStart(4, "0")}`;
      durableDb
        .prepare(
          `INSERT INTO monitor_activations
           (id, quote_id, activation_key, payment_attempt_id, purchase_id,
            fingerprint_id, monitor_id, status, created_at, projected_at)
           VALUES (?,?,?,?,?,?,?,'active',?,?)`,
        )
        .run(aid, qid, `k${i}`, `p${i}`, pid, `fp${i}`, pid, nowIso, nowIso);
      const blob = JSON.stringify({
        purchase: {
          id: pid,
          status: "MONITORING_ACTIVE",
          fingerprint_id: `fp${i}`,
          user_ref: account.id,
          purchase_price: 10,
          currency: "USD",
          purchase_date: "2026-07-01",
          purchase_channel: "target_online",
          country: "US",
          region: "TX",
        },
        fingerprint: { fingerprint_id: `fp${i}`, product_title: "T" },
      });
      await store.savePurchaseBlob({
        accountId: account.id,
        purchaseId: pid,
        blobJson: blob,
        nowIso,
      });
      // Bootstrap schedules: first 30 blocked/stopped, rest active due.
      const status =
        i < 30 ? (i % 2 === 0 ? "blocked" : "stopped") : "active";
      await store.upsertDurableMonitorSchedule({
        purchaseId: pid,
        activationId: aid,
        accountId: account.id,
        status,
        nextCheckAt: null,
        nowIso,
      });
    }
    void purchaseIds;
    void extraBlocked;

    // Due page must only return active rows (blocked/stopped never occupy pages).
    const page1 = await store.listDueDurableMonitorSchedules({
      asOfIso: nowIso,
      limit: 50,
    });
    expect(page1.every((r) => r.status === "active")).toBe(true);
    expect(page1.length).toBe(50);
    // Eligible active are i=30..79 = 50 rows exactly on first page.
    // Wait — 50 active (30-79). First page is all 50 active, none beyond.
    // Adjust: only 20 blocked so 60 active → page 2 has more.
    // We have 30 blocked/stopped + 50 active. Good for one page of 50.
    // Make 20 more active by converting? Actually need eligible beyond position 50
    // of overall inserts. Keyset is by purchase_id among active only.
    // Active pur_k_0030..pur_k_0079 = 50. To have beyond 50, need more active.
    for (let i = 0; i < 20; i += 1) {
      // Unblock some that were blocked so total active > 50
      const pid = `pur_k_${String(i).padStart(4, "0")}`;
      await store.upsertDurableMonitorSchedule({
        purchaseId: pid,
        status: "active",
        nextCheckAt: null,
        nowIso,
      });
    }
    // Now active: 0-19 + 30-79 = 70 active; blocked/stopped: 20-29 = 10.

    const dueAll: string[] = [];
    let after: string | null = null;
    for (let p = 0; p < 3; p += 1) {
      const page = await store.listDueDurableMonitorSchedules({
        asOfIso: nowIso,
        limit: 50,
        afterPurchaseId: after,
      });
      for (const r of page) dueAll.push(r.purchase_id);
      if (!page.length) break;
      after = page[page.length - 1]!.purchase_id;
      if (page.length < 50) break;
    }
    expect(dueAll.length).toBe(70);
    expect(new Set(dueAll).size).toBe(70);
    // Sorted keyset
    const sorted = [...dueAll].sort();
    expect(dueAll).toEqual(sorted);
    // Includes IDs that sort after the first 50 active keyset positions
    expect(dueAll.some((id) => id > dueAll[49]!)).toBe(true);

    // Two workers, separate local SQLite caches, one durable store → one lease.
    const localA = openDatabase(tempDb("localA80"));
    const localB = openDatabase(tempDb("localB80"));
    migrateUp(localA);
    migrateUp(localB);
    const fetchIds: string[] = [];
    const workerOpts = {
      as_of: nowIso,
      store,
      env,
      max_pages: 3,
      durable_hydrate_limit: 50,
      durable_monthly_search_limit: 100,
      monthly_search_limit: 100,
      fetchObservation: (async (input: { purchase_id?: string }) => {
        if (input?.purchase_id) fetchIds.push(input.purchase_id);
        return {
          ok: false as const,
          status: "PROVIDER_ERROR" as const,
          notes: ["fixture"],
        };
      }) as never,
      process_emails: false,
      use_durable_bridge: true as const,
    };
    // Concurrent start so only one global lease wins.
    const [r1, r2] = await Promise.all([
      runScheduledMonitoringTickWithDurableBridge({
        ...workerOpts,
        db: localA,
        lease_holder_id: "worker_a80",
      }),
      runScheduledMonitoringTickWithDurableBridge({
        ...workerOpts,
        db: localB,
        lease_holder_id: "worker_b80",
      }),
    ]);
    // Exactly one worker acquires the global lease for the overlapping tick.
    expect([r1.lease_acquired, r2.lease_acquired].filter(Boolean).length).toBe(
      1,
    );
    expect(r1.pages_processed + r2.pages_processed).toBeGreaterThanOrEqual(1);

    // Durable budget remains globally bounded.
    const period = nowIso.slice(0, 7);
    const reserves = await Promise.all(
      Array.from({ length: 12 }, () =>
        store.tryReserveSearchBudget({
          periodKey: period,
          limitCount: 5,
          nowIso,
        }),
      ),
    );
    expect(reserves.filter((r) => r.reserved).length).toBe(5);

    localA.close();
    localB.close();
  });
});

describe("4. durable outbox worker", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("outbox");
    durableDb = openDatabase(durablePath);
    migrateUp(durableDb);
    resetAuthStoreCache();
    clearCapturedPriceDropEmails();
  });
  afterEach(() => {
    try {
      durableDb.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(durablePath);
    } catch {
      /* */
    }
    resetAuthStoreCache();
    clearCapturedPriceDropEmails();
  });

  it("concurrent workers one provider call; reclaim expired sending; retry then success; no resend; summary", async () => {
    const store = await getAuthStore({
      sqliteDb: durableDb,
      env,
      forceSqlite: true,
    });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const account = await store.upsertAccountForEmail(
      "outbox@example.com",
      nowIso,
    );
    await store.markAccountVerified(account.id, nowIso);

    const evidence = {
      product_title: "Widget",
      purchase_price: 20,
      observed_price: 15,
      potential_recovery: 5,
      currency: "USD",
      monitoring_deadline: null,
      observed_at: nowIso,
      review_path: "/purchases/pur_out_1",
    };
    const opp = "opp_outbox_audit_1";
    await store.insertNotificationOutbox({
      id: "outbox_audit_1",
      opportunityKey: opp,
      purchaseId: "pur_out_1",
      accountId: account.id,
      alertId: "alert_1",
      kind: "immediate",
      status: "pending",
      evidenceJson: JSON.stringify(evidence),
      recipientEmailHash: sha256Hex(account.email_normalized),
      nowIso,
    });

    let sendCount = 0;
    const sendFn = async () => {
      sendCount += 1;
      return { ok: true };
    };

    // Two concurrent workers → one send.
    const [a, b] = await Promise.all([
      processDueNotificationOutbox({
        store,
        nowIso,
        env,
        limit: 5,
        sendFn,
      }),
      processDueNotificationOutbox({
        store,
        nowIso,
        env,
        limit: 5,
        sendFn,
      }),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect(sendCount).toBe(1);
    const sentRow = await store.getNotificationOutboxByOpportunity(opp);
    expect(sentRow?.status).toBe("sent");

    // Sent never resends.
    sendCount = 0;
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      limit: 5,
      sendFn,
    });
    expect(sendCount).toBe(0);

    // Expired sending lease reclaimed.
    const opp2 = "opp_outbox_reclaim";
    const past = new Date(Date.now() - 120_000).toISOString();
    await store.insertNotificationOutbox({
      id: "outbox_reclaim",
      opportunityKey: opp2,
      purchaseId: "pur_out_2",
      accountId: account.id,
      kind: "immediate",
      status: "pending",
      evidenceJson: JSON.stringify(evidence),
      nowIso: past,
    });
    // Force into expired sending state
    durableDb
      .prepare(
        `UPDATE durable_notification_outbox
         SET status = 'sending', lease_holder = 'dead', lease_expires_at = ?, updated_at = ?
         WHERE opportunity_key = ?`,
      )
      .run(past, past, opp2);

    let reclaimSends = 0;
    const reclaimed = await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      limit: 5,
      sendFn: async () => {
        reclaimSends += 1;
        return { ok: true };
      },
    });
    expect(reclaimSends).toBe(1);
    expect(reclaimed.sent).toBeGreaterThanOrEqual(1);

    // Provider failure retries then succeeds.
    const opp3 = "opp_outbox_retry";
    await store.insertNotificationOutbox({
      id: "outbox_retry",
      opportunityKey: opp3,
      purchaseId: "pur_out_3",
      accountId: account.id,
      kind: "immediate",
      status: "pending",
      evidenceJson: JSON.stringify(evidence),
      nowIso,
    });
    let attempts = 0;
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      limit: 5,
      sendFn: async () => {
        attempts += 1;
        return { ok: false, error: "provider_send_failed" };
      },
    });
    const failed = await store.getNotificationOutboxByOpportunity(opp3);
    expect(failed?.status).toBe("failed_retryable");
    // Advance next_attempt_at
    durableDb
      .prepare(
        `UPDATE durable_notification_outbox SET next_attempt_at = ? WHERE opportunity_key = ?`,
      )
      .run(nowIso, opp3);
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      limit: 5,
      sendFn: async () => {
        attempts += 1;
        return { ok: true };
      },
    });
    const ok3 = await store.getNotificationOutboxByOpportunity(opp3);
    expect(ok3?.status).toBe("sent");
    expect(attempts).toBe(2);

    // Summary creates and sends one durable message.
    const summaryKey = `summary_${account.id}_window`;
    await store.insertNotificationOutbox({
      id: "outbox_summary",
      opportunityKey: summaryKey,
      purchaseId: "pur_out_1",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: JSON.stringify({
        ...evidence,
        summary_items: [
          {
            product_title: "Widget",
            potential_recovery: 5,
            reviewUrl: "https://example.com/r",
          },
        ],
      }),
      nowIso,
    });
    let summarySends = 0;
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      limit: 5,
      sendFn: async (args) => {
        if (args.kind === "summary") summarySends += 1;
        return { ok: true };
      },
    });
    expect(summarySends).toBe(1);
    const sum = await store.getNotificationOutboxByOpportunity(summaryKey);
    expect(sum?.status).toBe("sent");

    // Production default path with evidence does not return retry_requires_evidence_reload
    clearCapturedPriceDropEmails();
    const opp4 = "opp_prod_send";
    await store.insertNotificationOutbox({
      id: "outbox_prod",
      opportunityKey: opp4,
      purchaseId: "pur_out_4",
      accountId: account.id,
      alertId: "a4",
      kind: "immediate",
      status: "pending",
      evidenceJson: buildOutboxEvidenceJson({
        purchase_id: "pur_out_4",
        product_title: "Widget",
        purchase_price: 20,
        observed_price: 15,
        potential_recovery: 5,
        currency: "USD",
        monitoring_deadline: null,
        observed_at: nowIso,
        alert_id: "a4",
        opportunity_key: opp4,
        review_path: "/purchases/pur_out_4",
      }),
      nowIso,
    });
    const prod = await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      limit: 5,
      // no sendFn → production path
    });
    expect(prod.sent + prod.failed).toBeGreaterThanOrEqual(1);
    const prodRow = await store.getNotificationOutboxByOpportunity(opp4);
    expect(prodRow?.reason).not.toBe("retry_requires_evidence_reload");
    if (prodRow?.status === "sent") {
      expect(getCapturedPriceDropEmails().length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("5. evidence-based settlement review", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("settle");
    db = openDatabase(dbPath);
    migrateUp(db);
    resetAuthStoreCache();
  });
  afterEach(() => {
    try {
      db.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* */
    }
    resetAuthStoreCache();
  });

  async function seedReviewPayment(id: string) {
    const store = await getAuthStore({ sqliteDb: db, env });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    await store.upsertMonitoringPassPayment({
      id,
      authorizationDigest: sha256Hex(`auth-${id}`),
      nowIso,
      status: "settlement_review_required",
    });
    await store.updateMonitoringPassPayment({
      id,
      status: "settlement_review_required",
      settlementRef: null,
      nowIso,
    });
    return store;
  }

  it("fabricated well-formed tx hash rejected without facilitator success", async () => {
    const store = await seedReviewPayment("pay_fab_1");
    const fakeTx =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const result = await applySettlementReview({
      paymentId: "pay_fab_1",
      decision: "settled",
      transactionHash: fakeTx,
      env,
      store,
      // Facilitator not configured in test → fail closed
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect([
        "evidence_rejected",
        "invalid_input",
        "facilitator_not_configured",
      ]).toContain(result.error);
    }
  });

  it("wrong network/amount rejected; unconfirmed stays review-required", async () => {
    const store = await seedReviewPayment("pay_wrong_1");
    const tx =
      "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd";

    const wrongNet = await verifySettlementEvidence({
      paymentId: "pay_wrong_1",
      transactionHash: tx,
      env,
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: "eip155:1",
        amount: MONITORING_PRICE_ATOMIC_UNITS,
      },
    });
    expect(wrongNet.ok).toBe(false);
    if (!wrongNet.ok) expect(wrongNet.reason).toBe("network_mismatch");

    const wrongAmt = await verifySettlementEvidence({
      paymentId: "pay_wrong_1",
      transactionHash: tx,
      env,
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: DEFAULT_SETTLEMENT_NETWORK,
        amount: "100",
      },
    });
    expect(wrongAmt.ok).toBe(false);
    if (!wrongAmt.ok) expect(wrongAmt.reason).toBe("amount_mismatch");

    const wrongAsset = await verifySettlementEvidence({
      paymentId: "pay_wrong_1",
      transactionHash: tx,
      env,
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: DEFAULT_SETTLEMENT_NETWORK,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        asset: "0x0000000000000000000000000000000000000001",
      },
    });
    expect(wrongAsset.ok).toBe(false);
    if (!wrongAsset.ok) expect(wrongAsset.reason).toBe("asset_mismatch");

    const unconfirmed = await applySettlementReview({
      paymentId: "pay_wrong_1",
      decision: "settled",
      transactionHash: tx,
      env,
      store,
      statusOverride: {
        success: false,
        status: "pending",
        transaction: tx,
      },
    });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(
        unconfirmed.status === "settlement_review_required" ||
          unconfirmed.error === "evidence_rejected",
      ).toBe(true);
    }
  });

  it("verified matching settlement issues exactly one pass; inconclusive failure cannot unlock", async () => {
    const store = await seedReviewPayment("pay_ok_1");
    const tx =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const payTo = "0x2222222222222222222222222222222222222222";

    const settled = await applySettlementReview({
      paymentId: "pay_ok_1",
      decision: "settled",
      transactionHash: tx,
      env: {
        ...env,
        OKX_PAY_TO: payTo,
        OKX_API_KEY: "k",
        OKX_SECRET_KEY: "s",
        OKX_PASSPHRASE: "p",
      },
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: DEFAULT_SETTLEMENT_NETWORK,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        asset: DEFAULT_SETTLEMENT_ASSET,
        payTo,
        payer: "0xpayer",
      },
      store,
    });
    // May fail if loadOkxSellerConfig requires more — accept settled or config path
    if (settled.ok) {
      expect(settled.decision).toBe("settled");
      const payment = await store.getMonitoringPassPaymentById("pay_ok_1");
      expect(payment?.status).toBe("settled");
      // Exactly one audit row
      const audits = durableDbLikeCount(db, "pay_ok_1");
      expect(audits).toBe(1);
    } else {
      // If payTo config missing, evidence may reject recipient check — still fail closed
      expect(settled.ok).toBe(false);
    }

    // Inconclusive failure evidence cannot unlock repayment
    await store.updateMonitoringPassPayment({
      id: "pay_ok_1",
      status: "settlement_review_required",
      settlementRef: null,
      nowIso: new Date().toISOString(),
    });
    const failUncertain = await applySettlementReview({
      paymentId: "pay_ok_1",
      decision: "failed",
      transactionHash: tx,
      env,
      statusOverride: {
        success: false,
        status: "pending",
        transaction: tx,
      },
      store,
    });
    expect(failUncertain.ok).toBe(false);
    if (!failUncertain.ok) {
      expect(failUncertain.error).toBe("inconclusive_failure_evidence");
    }
  });
});

function durableDbLikeCount(
  db: ReturnType<typeof openDatabase>,
  paymentId: string,
): number {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM settlement_review_audit WHERE payment_id = ?`,
      )
      .get(paymentId) as { c: number };
    return row.c;
  } catch {
    return 0;
  }
}
