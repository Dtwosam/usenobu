/**
 * Transactional closeout live-ready proofs:
 * failed settlement binding, canonical settlement refs, rolling 24h summary.
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
  applySettlementReview,
  verifySettlementEvidence,
} from "../../src/payments/settlement-review-service.js";
import { canonicalizeSettlementRef } from "../../src/payments/settlement-ref.js";
import {
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
} from "../../src/payments/x402.js";
import {
  processDueNotificationOutbox,
  buildSummaryOutboxEvidenceJson,
  SUMMARY_ROLLING_WINDOW_MS,
} from "../../src/notifications/outbox-retry.js";

const PAY_TO = "0x2222222222222222222222222222222222222222";
const env = {
  NOBU_AUTH_TEST_MODE: "1",
  NOBU_FIXTURE_MODE: "1",
  SESSION_SECRET: "nobu-test-session-secret-do-not-use-in-prod",
  OKX_API_KEY: "k",
  OKX_SECRET_KEY: "s",
  OKX_PASSPHRASE: "p",
  OKX_PAY_TO: PAY_TO,
};

function tempDb(label: string): string {
  return path.join(
    os.tmpdir(),
    `nobu-live-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

const TX =
  "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TX_CANON = canonicalizeSettlementRef(TX)!;

function successBody(tx: string, extra: Record<string, string> = {}) {
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

function failedBody(tx: string, extra: Record<string, string> = {}) {
  return {
    success: false,
    status: "failed" as const,
    transaction: tx,
    network: DEFAULT_SETTLEMENT_NETWORK,
    amount: MONITORING_PRICE_ATOMIC_UNITS,
    asset: DEFAULT_SETTLEMENT_ASSET,
    payTo: PAY_TO,
    payer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    errorReason: "on_chain_revert",
    ...extra,
  };
}

describe("canonicalizeSettlementRef", () => {
  it("trims, lowercases, validates hex", () => {
    expect(canonicalizeSettlementRef(`  ${TX}  `)).toBe(TX_CANON);
    expect(canonicalizeSettlementRef(TX_CANON)).toBe(TX_CANON);
    expect(canonicalizeSettlementRef("not-a-tx")).toBeNull();
    expect(canonicalizeSettlementRef("0x12")).toBeNull();
  });
});

describe("failed settlement binding", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("failbind");
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

  async function seed(
    id: string,
    payer = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
      payerAddress: payer,
    });
    return store;
  }

  it("unrelated bare failed tx cannot fail a payment", async () => {
    const store = await seed("pay_unrelated");
    const bareTx =
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const r = await applySettlementReview({
      paymentId: "pay_unrelated",
      decision: "failed",
      transactionHash: bareTx,
      env,
      store,
      statusOverride: {
        success: false,
        status: "failed",
        transaction: bareTx,
        errorReason: "generic_fail",
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("inconclusive_failure_evidence");
      expect(r.status).toBe("settlement_review_required");
    }
    const p = await store.getMonitoringPassPaymentById("pay_unrelated");
    expect(p?.status).toBe("settlement_review_required");
  });

  it("wrong payer / network / payTo / asset / amount rejected", async () => {
    const store = await seed("pay_wrong");
    const base = failedBody(TX);

    const wrongPayer = await applySettlementReview({
      paymentId: "pay_wrong",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: {
        ...base,
        payer: "0xcccccccccccccccccccccccccccccccccccccccc",
      },
    });
    expect(wrongPayer.ok).toBe(false);

    const wrongNet = await verifySettlementEvidence({
      paymentId: "pay_wrong",
      transactionHash: TX,
      env,
      mode: "failed",
      expectedPayer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      statusOverride: { ...base, network: "eip155:1" },
    });
    expect(wrongNet.ok).toBe(false);
    if (!wrongNet.ok) expect(wrongNet.reason).toBe("network_mismatch");

    const wrongPayTo = await verifySettlementEvidence({
      paymentId: "pay_wrong",
      transactionHash: TX,
      env,
      mode: "failed",
      statusOverride: {
        ...base,
        payTo: "0x9999999999999999999999999999999999999999",
      },
    });
    expect(wrongPayTo.ok).toBe(false);
    if (!wrongPayTo.ok) expect(wrongPayTo.reason).toBe("recipient_mismatch");

    const wrongAsset = await verifySettlementEvidence({
      paymentId: "pay_wrong",
      transactionHash: TX,
      env,
      mode: "failed",
      statusOverride: {
        ...base,
        asset: "0x0000000000000000000000000000000000000001",
      },
    });
    expect(wrongAsset.ok).toBe(false);
    if (!wrongAsset.ok) expect(wrongAsset.reason).toBe("asset_mismatch");

    const wrongAmt = await verifySettlementEvidence({
      paymentId: "pay_wrong",
      transactionHash: TX,
      env,
      mode: "failed",
      statusOverride: { ...base, amount: "1" },
    });
    expect(wrongAmt.ok).toBe(false);
    if (!wrongAmt.ok) expect(wrongAmt.reason).toBe("amount_mismatch");
  });

  it("missing binding fields remain review-required; bound failure succeeds once", async () => {
    const store = await seed("pay_bound");
    const missingNet = await applySettlementReview({
      paymentId: "pay_bound",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: {
        success: false,
        status: "failed",
        transaction: TX,
        asset: DEFAULT_SETTLEMENT_ASSET,
        payTo: PAY_TO,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        // no network
      },
    });
    expect(missingNet.ok).toBe(false);
    if (!missingNet.ok) {
      expect(missingNet.status).toBe("settlement_review_required");
    }

    const ok = await applySettlementReview({
      paymentId: "pay_bound",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX),
    });
    expect(ok.ok).toBe(true);
    const p = await store.getMonitoringPassPaymentById("pay_bound");
    expect(p?.status).toBe("failed");
    expect(p?.settlement_ref).toBe(TX_CANON);

    // Second payment cannot use same failed tx
    await seed("pay_other");
    const again = await applySettlementReview({
      paymentId: "pay_other",
      decision: "failed",
      transactionHash: TX.toLowerCase(),
      env,
      store,
      statusOverride: failedBody(TX.toLowerCase()),
    });
    expect(again.ok).toBe(false);
  });
});

describe("mixed-case settlement references", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("case");
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

  async function seed(id: string) {
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
    });
    return store;
  }

  it("upper and lower case are one claim; casing cannot settle second payment", async () => {
    const store = await seed("pay_case_a");
    await seed("pay_case_b");
    const upper =
      "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
    const lower = upper.toLowerCase();

    const a = await applySettlementReview({
      paymentId: "pay_case_a",
      decision: "settled",
      transactionHash: upper,
      env,
      store,
      statusOverride: successBody(upper),
    });
    expect(a.ok).toBe(true);
    const claim = await store.getSettlementRefClaim(lower);
    expect(claim?.payment_id).toBe("pay_case_a");
    const pay = await store.getMonitoringPassPaymentById("pay_case_a");
    expect(pay?.settlement_ref).toBe(lower);

    const b = await applySettlementReview({
      paymentId: "pay_case_b",
      decision: "settled",
      transactionHash: lower,
      env,
      store,
      statusOverride: successBody(lower),
    });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe("evidence_bound_to_other_payment");

    // Concurrent mixed-case: one winner
    await seed("pay_c1");
    await seed("pay_c2");
    const tx2 =
      "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    const results = await Promise.all([
      applySettlementReview({
        paymentId: "pay_c1",
        decision: "settled",
        transactionHash: tx2,
        env,
        store,
        statusOverride: successBody(tx2),
      }),
      applySettlementReview({
        paymentId: "pay_c2",
        decision: "settled",
        transactionHash: tx2.toLowerCase(),
        env,
        store,
        statusOverride: successBody(tx2.toLowerCase()),
      }),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(1);
  });
});

describe("rolling 24h summary limit", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("roll");
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

  it("midnight boundary and 23h59 suppressed; 24h later allowed; concurrent one send", async () => {
    const store = await getAuthStore({
      sqliteDb: durableDb,
      env,
      forceSqlite: true,
    });
    await store.ensureSchema();
    const t0 = "2026-07-01T23:59:00.000Z";
    const account = await store.upsertAccountForEmail(
      "roll@example.com",
      t0,
    );
    await store.markAccountVerified(account.id, t0);
    await store.savePurchaseBlob({
      accountId: account.id,
      purchaseId: "pur_roll",
      blobJson: JSON.stringify({
        purchase: { id: "pur_roll", status: "MONITORING_ACTIVE" },
      }),
      nowIso: t0,
    });
    await store.updatePurchaseLifecycleMeta({
      accountId: account.id,
      purchaseId: "pur_roll",
      email_alerts_enabled: 1,
      nowIso: t0,
    });

    const summaryJson = buildSummaryOutboxEvidenceJson({
      evidence: {
        purchase_id: "pur_roll",
        product_title: "Roll Item",
        purchase_price: 10,
        observed_price: 5,
        potential_recovery: 5,
        currency: "USD",
        monitoring_deadline: null,
        observed_at: t0,
        alert_id: "s1",
        opportunity_key: "sum_roll_1",
        review_path: "/purchases/pur_roll",
      },
      items: [
        {
          product_title: "Roll Item",
          potential_recovery: 5,
          reviewUrl: "https://example.com/r",
        },
      ],
    });

    await store.insertNotificationOutbox({
      id: "out_sum_r1",
      opportunityKey: "sum_roll_1",
      purchaseId: "pur_roll",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: summaryJson,
      nowIso: t0,
    });

    let subjects: string[] = [];
    const r1 = await processDueNotificationOutbox({
      store,
      nowIso: t0,
      env,
      sendFn: async (a) => {
        subjects.push(a.subject ?? "");
        expect(a.kind).toBe("summary");
        expect(a.text).toContain("Roll Item");
        return { ok: true };
      },
    });
    expect(r1.sent).toBe(1);
    expect(subjects[0]).toMatch(/possible price drops/i);

    // 00:01 next UTC day — still within 24h rolling window
    const tMidnight = "2026-07-02T00:01:00.000Z";
    await store.insertNotificationOutbox({
      id: "out_sum_r2",
      opportunityKey: "sum_roll_2",
      purchaseId: "pur_roll",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: summaryJson,
      nowIso: tMidnight,
    });
    let calls = 0;
    const r2 = await processDueNotificationOutbox({
      store,
      nowIso: tMidnight,
      env,
      sendFn: async () => {
        calls += 1;
        return { ok: true };
      },
    });
    expect(calls).toBe(0);
    expect(r2.suppressed).toBeGreaterThanOrEqual(1);

    // 23h59 after first send still blocked
    const t2359 = new Date(
      Date.parse(t0) + SUMMARY_ROLLING_WINDOW_MS - 60_000,
    ).toISOString();
    await store.insertNotificationOutbox({
      id: "out_sum_r3",
      opportunityKey: "sum_roll_3",
      purchaseId: "pur_roll",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: summaryJson,
      nowIso: t2359,
    });
    calls = 0;
    await processDueNotificationOutbox({
      store,
      nowIso: t2359,
      env,
      sendFn: async () => {
        calls += 1;
        return { ok: true };
      },
    });
    expect(calls).toBe(0);

    // Exactly 24h later allowed
    const t24 = new Date(
      Date.parse(t0) + SUMMARY_ROLLING_WINDOW_MS,
    ).toISOString();
    await store.insertNotificationOutbox({
      id: "out_sum_r4",
      opportunityKey: "sum_roll_4",
      purchaseId: "pur_roll",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: summaryJson,
      nowIso: t24,
    });
    // Concurrent workers → one provider call
    calls = 0;
    const [a, b] = await Promise.all([
      processDueNotificationOutbox({
        store,
        nowIso: t24,
        env,
        sendFn: async () => {
          calls += 1;
          return { ok: true };
        },
      }),
      processDueNotificationOutbox({
        store,
        nowIso: t24,
        env,
        sendFn: async () => {
          calls += 1;
          return { ok: true };
        },
      }),
    ]);
    expect(a.sent + b.sent).toBe(1);
    expect(calls).toBe(1);
  });
});
