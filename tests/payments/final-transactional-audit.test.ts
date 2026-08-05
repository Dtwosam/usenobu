/**
 * Final transactional audit closeout proofs:
 * 1) bootstrap never revives terminal schedules
 * 2) settlement evidence bound to one payment
 * 3) outbox consent + summary retry + 24h bucket
 * 4) config readiness booleans only
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
  bootstrapDurableSchedulesFromActivations,
  runScheduledMonitoringTickWithDurableBridge,
} from "../../src/monitoring/durable-bridge.js";
import {
  applySettlementReview,
  verifySettlementEvidence,
} from "../../src/payments/settlement-review-service.js";
import {
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
} from "../../src/payments/x402.js";
import {
  processDueNotificationOutbox,
  buildOutboxEvidenceJson,
  buildSummaryOutboxEvidenceJson,
  summaryWindowStart,
} from "../../src/notifications/outbox-retry.js";
import { getConfigReadiness } from "../../src/ops/config-readiness.js";

const env = {
  NOBU_AUTH_TEST_MODE: "1",
  NOBU_FIXTURE_MODE: "1",
  SESSION_SECRET: "nobu-test-session-secret-do-not-use-in-prod",
  OKX_API_KEY: "k",
  OKX_SECRET_KEY: "s",
  OKX_PASSPHRASE: "p",
  OKX_PAY_TO: "0x2222222222222222222222222222222222222222",
};

function tempDb(label: string): string {
  return path.join(
    os.tmpdir(),
    `nobu-final-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

const PAY_TO = env.OKX_PAY_TO;
const GOOD_TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function successStatus(tx: string, extra: Record<string, string> = {}) {
  return {
    success: true,
    status: "success" as const,
    transaction: tx,
    network: DEFAULT_SETTLEMENT_NETWORK,
    amount: MONITORING_PRICE_ATOMIC_UNITS,
    asset: DEFAULT_SETTLEMENT_ASSET,
    payTo: PAY_TO,
    payer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ...extra,
  };
}

describe("1. bootstrap never revives terminal schedules", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("boot");
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

  it("blocked/stopped/expired unchanged; >200 blocked cannot starve; new schedule only if missing", async () => {
    const store = await getAuthStore({
      sqliteDb: durableDb,
      env,
      forceSqlite: true,
    });
    await store.ensureSchema();
    const nowIso = "2026-07-15T12:00:00.000Z";
    const account = await store.upsertAccountForEmail(
      "boot@example.com",
      nowIso,
    );

    // 220 blocked (sort early) + 5 active eligible (sort later)
    for (let i = 0; i < 220; i += 1) {
      const pid = `pur_b_${String(i).padStart(4, "0")}`;
      durableDb
        .prepare(
          `INSERT INTO monitor_activations
           (id, quote_id, activation_key, payment_attempt_id, purchase_id,
            fingerprint_id, monitor_id, status, created_at, projected_at)
           VALUES (?,?,?,?,?,?,?,'active',?,?)`,
        )
        .run(
          `act_b_${i}`,
          `q_b_${i}`,
          `k_b_${i}`,
          `p_b_${i}`,
          pid,
          `fp_b_${i}`,
          pid,
          nowIso,
          nowIso,
        );
      await store.savePurchaseBlob({
        accountId: account.id,
        purchaseId: pid,
        blobJson: JSON.stringify({
          purchase: {
            id: pid,
            status: "MONITORING_ACTIVE",
            fingerprint_id: `fp_b_${i}`,
            user_ref: account.id,
            purchase_price: 10,
            currency: "USD",
            purchase_date: "2026-07-01",
            purchase_channel: "target_online",
            country: "US",
            region: "TX",
          },
          fingerprint: { fingerprint_id: `fp_b_${i}`, product_title: "T" },
        }),
        nowIso,
      });
      await store.upsertDurableMonitorSchedule({
        purchaseId: pid,
        activationId: `act_b_${i}`,
        accountId: account.id,
        status: i % 3 === 0 ? "blocked" : i % 3 === 1 ? "stopped" : "expired",
        nextCheckAt: "2026-07-01T00:00:00.000Z",
        lastSkipReason: "terminal_seed",
        providerBackoffUntil: "2026-07-01T00:00:00.000Z",
        hydrationBlockerJson: JSON.stringify({ reason: "seed" }),
        nowIso,
      });
    }

    for (let i = 0; i < 5; i += 1) {
      const pid = `pur_e_${String(i).padStart(4, "0")}`;
      durableDb
        .prepare(
          `INSERT INTO monitor_activations
           (id, quote_id, activation_key, payment_attempt_id, purchase_id,
            fingerprint_id, monitor_id, status, created_at, projected_at)
           VALUES (?,?,?,?,?,?,?,'active',?,?)`,
        )
        .run(
          `act_e_${i}`,
          `q_e_${i}`,
          `k_e_${i}`,
          `p_e_${i}`,
          pid,
          `fp_e_${i}`,
          pid,
          nowIso,
          nowIso,
        );
      await store.savePurchaseBlob({
        accountId: account.id,
        purchaseId: pid,
        blobJson: JSON.stringify({
          purchase: {
            id: pid,
            status: "MONITORING_ACTIVE",
            fingerprint_id: `fp_e_${i}`,
            user_ref: account.id,
            purchase_price: 10,
            currency: "USD",
            purchase_date: "2026-07-01",
            purchase_channel: "target_online",
            country: "US",
            region: "TX",
          },
          fingerprint: { fingerprint_id: `fp_e_${i}`, product_title: "T" },
        }),
        nowIso,
      });
      await store.upsertDurableMonitorSchedule({
        purchaseId: pid,
        activationId: `act_e_${i}`,
        accountId: account.id,
        status: "active",
        nextCheckAt: null,
        nowIso,
      });
    }

    // Snapshot terminal rows before bootstrap/ticks
    const snap = (pid: string) => store.getDurableMonitorSchedule(pid);
    const sampleBlocked = await snap("pur_b_0000");
    const sampleStopped = await snap("pur_b_0001");
    const sampleExpired = await snap("pur_b_0002");
    expect(sampleBlocked?.status).toBe("blocked");
    expect(sampleBlocked?.last_skip_reason).toBe("terminal_seed");

    // Bootstrap multiple times must not overwrite terminals
    for (let b = 0; b < 3; b += 1) {
      await bootstrapDurableSchedulesFromActivations({ store, nowIso });
    }
    expect((await snap("pur_b_0000"))?.status).toBe(sampleBlocked!.status);
    expect((await snap("pur_b_0000"))?.next_check_at).toBe(
      sampleBlocked!.next_check_at,
    );
    expect((await snap("pur_b_0000"))?.provider_backoff_until).toBe(
      sampleBlocked!.provider_backoff_until,
    );
    expect((await snap("pur_b_0000"))?.last_skip_reason).toBe(
      sampleBlocked!.last_skip_reason,
    );
    expect((await snap("pur_b_0000"))?.hydration_blocker_json).toBe(
      sampleBlocked!.hydration_blocker_json,
    );
    expect((await snap("pur_b_0001"))?.status).toBe(sampleStopped!.status);
    expect((await snap("pur_b_0002"))?.status).toBe(sampleExpired!.status);
    // Eligible actives still active after bootstrap
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await snap(`pur_e_${String(i).padStart(4, "0")}`))?.status,
      ).toBe("active");
    }

    // Due pages never include blocked/stopped/expired (even with >200 terminals first)
    const duePages: string[] = [];
    let after: string | null = null;
    for (let p = 0; p < 6; p += 1) {
      const page = await store.listDueDurableMonitorSchedules({
        asOfIso: nowIso,
        limit: 50,
        afterPurchaseId: after,
      });
      for (const r of page) {
        expect(r.status).toBe("active");
        duePages.push(r.purchase_id);
      }
      if (!page.length) break;
      after = page[page.length - 1]!.purchase_id;
      if (page.length < 50) break;
    }
    expect(duePages.every((id) => !id.startsWith("pur_b_"))).toBe(true);
    expect(duePages.some((id) => id.startsWith("pur_e_"))).toBe(true);

    // Full bridge ticks: provider ids never include terminal pur_b_*
    const providerIds: string[] = [];
    for (let t = 0; t < 2; t += 1) {
      const local = openDatabase(tempDb(`tick${t}`));
      migrateUp(local);
      const tick = await runScheduledMonitoringTickWithDurableBridge({
        db: local,
        as_of: nowIso,
        store,
        env,
        max_pages: 6,
        durable_hydrate_limit: 50,
        process_emails: false,
        use_durable_bridge: true,
        lease_holder_id: `worker_tick_${t}`,
        fetchObservation: (async () => ({
          ok: false as const,
          status: "PROVIDER_ERROR" as const,
          notes: ["fixture"],
        })) as never,
      });
      providerIds.push(...tick.provider_fetch_ids);
      local.close();
    }
    expect(providerIds.every((id) => !id.startsWith("pur_b_"))).toBe(true);
    // Terminal rows still not revived to active by bootstrap-in-tick
    expect((await snap("pur_b_0000"))?.status).not.toBe("active");
    expect((await snap("pur_b_0001"))?.status).not.toBe("active");
    expect((await snap("pur_b_0002"))?.status).not.toBe("active");

    // New activation missing schedule gets exactly one insert
    const newPid = "pur_new_0001";
    durableDb
      .prepare(
        `INSERT INTO monitor_activations
         (id, quote_id, activation_key, payment_attempt_id, purchase_id,
          fingerprint_id, monitor_id, status, created_at, projected_at)
         VALUES (?,?,?,?,?,?,?,'active',?,?)`,
      )
      .run(
        "act_new",
        "q_new",
        "k_new",
        "p_new",
        newPid,
        "fp_new",
        newPid,
        nowIso,
        nowIso,
      );
    const c1 = await store.insertDurableMonitorScheduleIfMissing({
      purchaseId: newPid,
      activationId: "act_new",
      status: "active",
      nowIso,
    });
    const c2 = await store.insertDurableMonitorScheduleIfMissing({
      purchaseId: newPid,
      activationId: "act_new",
      status: "active",
      nowIso,
    });
    expect(c1.created).toBe(true);
    expect(c2.created).toBe(false);
    const newRow = await store.getDurableMonitorSchedule(newPid);
    expect(newRow?.status).toBe("active");

    // Bootstrap under lease must not revive terminal
    await bootstrapDurableSchedulesFromActivations({ store, nowIso });
    const stillBlocked = await snap("pur_b_0000");
    expect(stillBlocked?.status).toBe("blocked");
  });
});

describe("2. settlement evidence bound to one payment", () => {
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

  async function seedPayment(
    id: string,
    payer?: string | null,
  ) {
    const store = await getAuthStore({ sqliteDb: db, env, forceSqlite: true });
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
      payerAddress: payer ?? null,
    });
    return store;
  }

  it("missing amount/asset/recipient rejected; payer mismatch when known", async () => {
    await seedPayment("pay_a", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const tx = GOOD_TX;

    const noAmt = await verifySettlementEvidence({
      paymentId: "pay_a",
      transactionHash: tx,
      env,
      mode: "settled",
      expectedPayer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: DEFAULT_SETTLEMENT_NETWORK,
        asset: DEFAULT_SETTLEMENT_ASSET,
        payTo: PAY_TO,
      },
    });
    expect(noAmt.ok).toBe(false);
    if (!noAmt.ok) expect(noAmt.reason).toBe("amount_missing");

    const noAsset = await verifySettlementEvidence({
      paymentId: "pay_a",
      transactionHash: tx,
      env,
      mode: "settled",
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: DEFAULT_SETTLEMENT_NETWORK,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        payTo: PAY_TO,
      },
    });
    expect(noAsset.ok).toBe(false);
    if (!noAsset.ok) expect(noAsset.reason).toBe("asset_missing");

    const noRecip = await verifySettlementEvidence({
      paymentId: "pay_a",
      transactionHash: tx,
      env,
      mode: "settled",
      statusOverride: {
        success: true,
        status: "success",
        transaction: tx,
        network: DEFAULT_SETTLEMENT_NETWORK,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        asset: DEFAULT_SETTLEMENT_ASSET,
      },
    });
    expect(noRecip.ok).toBe(false);
    if (!noRecip.ok) expect(noRecip.reason).toBe("recipient_missing");

    const payerMismatch = await verifySettlementEvidence({
      paymentId: "pay_a",
      transactionHash: tx,
      env,
      mode: "settled",
      expectedPayer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      statusOverride: successStatus(tx, {
        payer: "0xcccccccccccccccccccccccccccccccccccccccc",
      }),
    });
    expect(payerMismatch.ok).toBe(false);
    if (!payerMismatch.ok) expect(payerMismatch.reason).toBe("payer_mismatch");
  });

  it("tx for payment A cannot settle or fail payment B; concurrent one winner", async () => {
    const storeA = await seedPayment("pay_a");
    await seedPayment("pay_b");
    const tx = GOOD_TX;

    const settledA = await applySettlementReview({
      paymentId: "pay_a",
      decision: "settled",
      transactionHash: tx,
      env,
      store: storeA,
      statusOverride: successStatus(tx),
    });
    expect(settledA.ok).toBe(true);

    const settleB = await applySettlementReview({
      paymentId: "pay_b",
      decision: "settled",
      transactionHash: tx,
      env,
      store: storeA,
      statusOverride: successStatus(tx),
    });
    expect(settleB.ok).toBe(false);
    if (!settleB.ok) {
      expect(settleB.error).toBe("evidence_bound_to_other_payment");
    }

    // Reset B still reviewable — failed with A's tx also rejected
    const failB = await applySettlementReview({
      paymentId: "pay_b",
      decision: "failed",
      transactionHash: tx,
      env,
      store: storeA,
      statusOverride: {
        success: false,
        status: "failed",
        transaction: tx,
        errorReason: "on_chain_failed",
      },
    });
    expect(failB.ok).toBe(false);

    // Concurrent claim of a fresh tx: one winner
    const store = storeA;
    await store.updateMonitoringPassPayment({
      id: "pay_b",
      status: "settlement_review_required",
      settlementRef: null,
      nowIso: new Date().toISOString(),
    });
    // use a third payment
    await seedPayment("pay_c");
    const tx2 =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const results = await Promise.all(
      ["pay_b", "pay_c"].map((id) =>
        applySettlementReview({
          paymentId: id,
          decision: "settled",
          transactionHash: tx2,
          env,
          store,
          statusOverride: successStatus(tx2),
        }),
      ),
    );
    const wins = results.filter((r) => r.ok);
    expect(wins.length).toBe(1);
  });

  it("audit and payment transition atomic (claim path)", async () => {
    const store = await seedPayment("pay_atomic");
    const tx =
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const r = await applySettlementReview({
      paymentId: "pay_atomic",
      decision: "settled",
      transactionHash: tx,
      env,
      store,
      statusOverride: successStatus(tx),
    });
    expect(r.ok).toBe(true);
    const payment = await store.getMonitoringPassPaymentById("pay_atomic");
    expect(payment?.status).toBe("settled");
    const claim = await store.getSettlementRefClaim(tx);
    expect(claim?.payment_id).toBe("pay_atomic");
    const audits = db
      .prepare(
        `SELECT COUNT(*) AS c FROM settlement_review_audit WHERE payment_id = ?`,
      )
      .get("pay_atomic") as { c: number };
    expect(audits.c).toBe(1);
  });
});

describe("3. outbox consent revalidation and summary", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("outbox");
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

  it("consent revoked after failure prevents retry; summary content preserved; 24h bucket", async () => {
    const store = await getAuthStore({
      sqliteDb: durableDb,
      env,
      forceSqlite: true,
    });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const account = await store.upsertAccountForEmail(
      "consent@example.com",
      nowIso,
    );
    await store.markAccountVerified(account.id, nowIso);
    await store.savePurchaseBlob({
      accountId: account.id,
      purchaseId: "pur_c1",
      blobJson: JSON.stringify({
        purchase: { id: "pur_c1", status: "MONITORING_ACTIVE" },
      }),
      nowIso,
    });
    await store.updatePurchaseLifecycleMeta({
      accountId: account.id,
      purchaseId: "pur_c1",
      email_alerts_enabled: 1,
      nowIso,
    });

    const evidence = {
      product_title: "Widget Immediate",
      purchase_price: 20,
      observed_price: 15,
      potential_recovery: 5,
      currency: "USD",
      monitoring_deadline: null as string | null,
      observed_at: nowIso,
      review_path: "/purchases/pur_c1",
    };

    await store.insertNotificationOutbox({
      id: "out_imm",
      opportunityKey: "opp_imm_1",
      purchaseId: "pur_c1",
      accountId: account.id,
      kind: "immediate",
      status: "pending",
      evidenceJson: buildOutboxEvidenceJson({
        ...evidence,
        purchase_id: "pur_c1",
        alert_id: "a1",
        opportunity_key: "opp_imm_1",
      }),
      nowIso,
    });

    // First attempt fails
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      sendFn: async () => ({ ok: false, error: "provider_send_failed" }),
    });
    let row = await store.getNotificationOutboxByOpportunity("opp_imm_1");
    expect(row?.status).toBe("failed_retryable");

    // Revoke consent
    await store.updatePurchaseLifecycleMeta({
      accountId: account.id,
      purchaseId: "pur_c1",
      email_alerts_enabled: 0,
      nowIso,
    });
    durableDb
      .prepare(
        `UPDATE durable_notification_outbox SET next_attempt_at = ? WHERE opportunity_key = ?`,
      )
      .run(nowIso, "opp_imm_1");

    let providerCalls = 0;
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      sendFn: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    });
    expect(providerCalls).toBe(0);
    row = await store.getNotificationOutboxByOpportunity("opp_imm_1");
    expect(row?.status).toBe("suppressed");
    expect(row?.reason).toBe("consent_revoked");

    // Re-enable consent; immediate content preserved on successful path
    await store.updatePurchaseLifecycleMeta({
      accountId: account.id,
      purchaseId: "pur_c1",
      email_alerts_enabled: 1,
      nowIso,
    });
    await store.insertNotificationOutbox({
      id: "out_imm2",
      opportunityKey: "opp_imm_2",
      purchaseId: "pur_c1",
      accountId: account.id,
      kind: "immediate",
      status: "pending",
      evidenceJson: buildOutboxEvidenceJson({
        ...evidence,
        product_title: "Immediate Title Only",
        purchase_id: "pur_c1",
        alert_id: "a2",
        opportunity_key: "opp_imm_2",
      }),
      nowIso,
    });
    let capturedTitle = "";
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      sendFn: async (a) => {
        capturedTitle = a.evidence?.product_title ?? "";
        return { ok: true };
      },
    });
    expect(capturedTitle).toBe("Immediate Title Only");

    // Summary content preserved (subject/text from evidence)
    const summaryJson = buildSummaryOutboxEvidenceJson({
      evidence: {
        ...evidence,
        product_title: "Sum Item",
        purchase_id: "pur_c1",
        alert_id: "sum",
        opportunity_key: "sum1",
      },
      items: [
        {
          product_title: "Sum Item",
          potential_recovery: 5,
          reviewUrl: "https://example.com/r",
        },
      ],
    });
    const day = summaryWindowStart(nowIso);
    await store.insertNotificationOutbox({
      id: "out_sum1",
      opportunityKey: `summary_${account.id}_${day}`,
      purchaseId: "pur_c1",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: summaryJson,
      nowIso,
    });
    let sumSubject = "";
    await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      sendFn: async (a) => {
        sumSubject = a.subject ?? "";
        expect(a.kind).toBe("summary");
        expect(a.text).toContain("Sum Item");
        return { ok: true };
      },
    });
    expect(sumSubject).toContain("possible price drops");

    // Second summary within rolling 24h suppressed
    await store.insertNotificationOutbox({
      id: "out_sum2",
      opportunityKey: `summary_${account.id}_${day}_dup`,
      purchaseId: "pur_c1",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: summaryJson,
      nowIso,
    });
    let sum2Calls = 0;
    const r2 = await processDueNotificationOutbox({
      store,
      nowIso,
      env,
      sendFn: async () => {
        sum2Calls += 1;
        return { ok: true };
      },
    });
    expect(sum2Calls).toBe(0);
    expect(r2.suppressed).toBeGreaterThanOrEqual(1);
    const sum2 = await store.getNotificationOutboxByOpportunity(
      `summary_${account.id}_${day}_dup`,
    );
    expect(sum2?.status).toBe("suppressed");
    expect(sum2?.reason).toMatch(/summary_cooldown|summary_reserve/);
  });
});

describe("4. config readiness booleans only", () => {
  it("returns only booleans and no secret material", () => {
    const r = getConfigReadiness({
      ...env,
      OWNER_OPS_SECRET: "owner-secret-value-here",
      CRON_SECRET: "cron-secret-value-here",
      NOBU_PASS_CLAIM_SECRET: "claim-secret-16chars",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM_ADDRESS: "n@example.com",
      AUTH_DATABASE_URL: "postgres://x",
    });
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/owner-secret|cron-secret|claim-secret|re_test/);
    expect(typeof r.durable_database_configured).toBe("boolean");
    expect(typeof r.okx_seller_configured).toBe("boolean");
    expect(typeof r.nobu_pass_claim_secret_configured).toBe("boolean");
    expect(typeof r.email_provider_configured).toBe("boolean");
    expect(typeof r.owner_ops_secret_configured).toBe("boolean");
    expect(typeof r.cron_secret_configured).toBe("boolean");
    expect(r.owner_ops_secret_configured).toBe(true);
    expect(r.nobu_pass_claim_secret_configured).toBe(true);
  });
});
