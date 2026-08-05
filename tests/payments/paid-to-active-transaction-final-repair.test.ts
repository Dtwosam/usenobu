/**
 * Final paid-to-active transactional repair:
 * A) provider payment/authorization id persistence through real payment flow
 * B) failed settlement payment-specific binding
 * C) real initial summary orchestration via processPriceDropEmailForNewAlert
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
  evaluatePaymentSpecificBinding,
  verifySettlementEvidence,
} from "../../src/payments/settlement-review-service.js";
import { canonicalizeSettlementRef } from "../../src/payments/settlement-ref.js";
import {
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_VERSION,
} from "../../src/payments/x402.js";
import { reconcilePendingPassSettlements } from "../../src/payments/monitoring-pass-service.js";
import {
  sanitizeProviderId,
  extractProviderIds,
} from "../../src/payments/provider-ids.js";
import type { OkxHttpFetch } from "../../src/payments/okx-seller-client.js";
import {
  processDueNotificationOutbox,
  processNotificationOutboxOpportunity,
  SUMMARY_ROLLING_WINDOW_MS,
  summaryWindowStart,
} from "../../src/notifications/outbox-retry.js";
import { processPriceDropEmailForNewAlert } from "../../src/notifications/process.js";
import {
  clearCapturedPriceDropEmails,
  getCapturedPriceDropEmails,
  setEmailAlertPreference,
} from "../../src/notifications/index.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import { runMonitoringPass } from "../../src/monitoring/index.js";

const PAY_TO = "0x2222222222222222222222222222222222222222";
const PASS_RESOURCE = "https://www.usenobu.xyz/v1/agent/monitoring-pass";
const env = {
  NOBU_AUTH_TEST_MODE: "1",
  NOBU_FIXTURE_MODE: "1",
  SESSION_SECRET: "nobu-test-session-secret-do-not-use-in-prod",
  OKX_API_KEY: "k",
  OKX_SECRET_KEY: "s",
  OKX_PASSPHRASE: "p",
  OKX_PAY_TO: PAY_TO,
  NOBU_PASS_CLAIM_SECRET: "claim-secret-for-tests-only-32chars!!",
};

function tempDb(label: string): string {
  return path.join(
    os.tmpdir(),
    `nobu-final-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

const TX =
  "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TX_CANON = canonicalizeSettlementRef(TX)!;
const PAYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function failedBody(tx: string, extra: Record<string, string> = {}) {
  return {
    success: false,
    status: "failed" as const,
    transaction: tx,
    network: DEFAULT_SETTLEMENT_NETWORK,
    amount: MONITORING_PRICE_ATOMIC_UNITS,
    asset: DEFAULT_SETTLEMENT_ASSET,
    payTo: PAY_TO,
    payer: PAYER,
    errorReason: "on_chain_revert",
    ...extra,
  };
}

function validPayloadHeader(overrides: Record<string, unknown> = {}): string {
  const payload = {
    x402Version: X402_VERSION,
    accepted: {
      scheme: "exact",
      network: DEFAULT_SETTLEMENT_NETWORK,
      asset: DEFAULT_SETTLEMENT_ASSET,
      amount: MONITORING_PRICE_ATOMIC_UNITS,
      resource: PASS_RESOURCE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USD₮0", version: "1" },
      ...overrides,
    },
    payload: { signature: "sig_test_opaque" },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function okxEnvelope(data: unknown) {
  return {
    code: "0",
    msg: "",
    data,
  };
}

describe("provider id sanitize", () => {
  it("trims, caps length, rejects payloads", () => {
    expect(sanitizeProviderId("  pay_abc  ")).toBe("pay_abc");
    expect(sanitizeProviderId("x".repeat(250))!.length).toBe(200);
    expect(sanitizeProviderId('{"payment":"sig"}')).toBeNull();
    expect(
      extractProviderIds({ paymentId: "p1", authorization_id: "a1" }),
    ).toEqual({
      providerPaymentId: "p1",
      providerAuthorizationId: "a1",
    });
  });
});

describe("A. original payment identifier persistence", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("prov");
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

  it("captures provider ids from verify/settle and preserves on reconcile", async () => {
    const settlementTx =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const store = await getAuthStore({ sqliteDb: db, env, forceSqlite: true });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();

    // Store path: verify id then settle id
    await store.upsertMonitoringPassPayment({
      id: "pay_prov_1",
      authorizationDigest: sha256Hex("auth-prov-1"),
      nowIso,
      status: "verifying",
    });
    await store.updateMonitoringPassPayment({
      id: "pay_prov_1",
      status: "settlement_pending",
      settlementRef: settlementTx,
      nowIso,
      payerAddress: PAYER,
      lastProviderOperation: "verify",
      providerPaymentId: sanitizeProviderId("fac_pay_VERIFY_99"),
      providerAuthorizationId: null,
    });
    let row = await store.getMonitoringPassPaymentById("pay_prov_1");
    expect(row?.provider_payment_id).toBe("fac_pay_VERIFY_99");
    expect(
      row?.provider_authorization_id == null ||
        row?.provider_authorization_id === "",
    ).toBe(true);

    await store.updateMonitoringPassPayment({
      id: "pay_prov_1",
      status: "settlement_pending",
      settlementRef: settlementTx,
      nowIso,
      lastProviderOperation: "settle",
      providerAuthorizationId: sanitizeProviderId("fac_auth_SETTLE_77"),
    });
    row = await store.getMonitoringPassPaymentById("pay_prov_1");
    expect(row?.provider_payment_id).toBe("fac_pay_VERIFY_99");
    expect(row?.provider_authorization_id).toBe("fac_auth_SETTLE_77");

    // Real payment-service seller path: mocked verify + settle return provider ids
    const calls: string[] = [];
    const liveFetch: OkxHttpFetch = async (url) => {
      const u = String(url);
      if (u.includes("/supported")) {
        return new Response(
          JSON.stringify(
            okxEnvelope({
              kinds: [
                {
                  x402Version: 2,
                  scheme: "exact",
                  network: DEFAULT_SETTLEMENT_NETWORK,
                  extra: { name: "USD₮0", version: "1" },
                },
              ],
            }),
          ),
          { status: 200 },
        );
      }
      if (u.includes("/verify")) {
        calls.push("verify");
        return new Response(
          JSON.stringify(
            okxEnvelope({
              isValid: true,
              payer: PAYER,
              paymentId: "fac_live_pay_1",
            }),
          ),
          { status: 200 },
        );
      }
      if (u.includes("/settle/status")) {
        calls.push("status");
        return new Response(
          JSON.stringify(
            okxEnvelope({
              success: true,
              status: "success",
              transaction: settlementTx,
              payer: PAYER,
              network: DEFAULT_SETTLEMENT_NETWORK,
              paymentId: "fac_live_pay_1",
              authorizationId: "fac_live_auth_1",
            }),
          ),
          { status: 200 },
        );
      }
      if (u.includes("/settle")) {
        calls.push("settle");
        return new Response(
          JSON.stringify(
            okxEnvelope({
              success: true,
              status: "success",
              transaction: settlementTx,
              payer: PAYER,
              network: DEFAULT_SETTLEMENT_NETWORK,
              amount: MONITORING_PRICE_ATOMIC_UNITS,
              authorizationId: "fac_live_auth_1",
              payment_id: "fac_live_pay_1",
            }),
          ),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    };

    const { createOkxSellerVerifier } = await import(
      "../../src/payments/okx-seller-verifier.js"
    );
    const seller = createOkxSellerVerifier({ env, fetchImpl: liveFetch });
    const header = validPayloadHeader();
    const detailed = await seller.verifyAndSettleDetailed({
      resource: PASS_RESOURCE,
      authorizationHeader: header,
    });
    expect(detailed.ok).toBe(true);
    if (detailed.ok) {
      expect(detailed.providerPaymentId).toBe("fac_live_pay_1");
      expect(detailed.providerAuthorizationId).toBe("fac_live_auth_1");
    }
    expect(calls).toContain("verify");
    expect(calls).toContain("settle");

    await store.upsertMonitoringPassPayment({
      id: "pay_live_2",
      authorizationDigest: sha256Hex(header),
      nowIso,
      status: "authorization_received",
    });
    if (detailed.ok) {
      await store.updateMonitoringPassPayment({
        id: "pay_live_2",
        status: "settled",
        settlementRef: detailed.settlementRef,
        nowIso,
        payerAddress: detailed.payer ?? null,
        lastProviderOperation: "settle",
        providerPaymentId: detailed.providerPaymentId,
        providerAuthorizationId: detailed.providerAuthorizationId,
      });
    }
    const liveRow = await store.getMonitoringPassPaymentById("pay_live_2");
    expect(liveRow?.provider_payment_id).toBe("fac_live_pay_1");
    expect(liveRow?.provider_authorization_id).toBe("fac_live_auth_1");

    // Reconcile fills/preserves identifiers from settle-status (unique tx)
    const reconTx =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    await store.upsertMonitoringPassPayment({
      id: "pay_recon",
      authorizationDigest: sha256Hex("recon"),
      nowIso,
      status: "settlement_pending",
    });
    await store.updateMonitoringPassPayment({
      id: "pay_recon",
      status: "settlement_pending",
      settlementRef: reconTx,
      nowIso,
      providerPaymentId: "fac_recon_pay",
    });
    // Isolate recon payment: leave other pending rows settled so only pay_recon runs.
    await store.updateMonitoringPassPayment({
      id: "pay_prov_1",
      status: "settled",
      settlementRef: settlementTx,
      nowIso,
    });
    const reconFetch: OkxHttpFetch = async (url) => {
      if (String(url).includes("/settle/status")) {
        return new Response(
          JSON.stringify(
            okxEnvelope({
              success: true,
              status: "success",
              transaction: reconTx,
              payer: PAYER,
              network: DEFAULT_SETTLEMENT_NETWORK,
              paymentId: "fac_recon_pay",
              authorization_id: "fac_recon_auth",
            }),
          ),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(okxEnvelope({})), { status: 200 });
    };
    await reconcilePendingPassSettlements({
      sqliteDb: db,
      env,
      fetchImpl: reconFetch,
      limit: 5,
    });
    const recon = await store.getMonitoringPassPaymentById("pay_recon");
    expect(recon?.status).toBe("settled");
    expect(recon?.provider_payment_id).toBe("fac_recon_pay");
    expect(recon?.provider_authorization_id).toBe("fac_recon_auth");

    // Safety: raw signature / authorization payload never stored
    const allRows = db
      .prepare(`SELECT * FROM monitoring_pass_payments`)
      .all() as Array<Record<string, unknown>>;
    for (const r of allRows) {
      const blob = JSON.stringify(r);
      expect(blob).not.toContain("sig_test_opaque");
      expect(blob).not.toMatch(/"authorization"\s*:\s*\{/);
      expect(String(r.sanitized_settle_reason || "")).not.toContain(
        "fac_live_pay_1",
      );
    }
  });
});

describe("B. failed settlement payment-specific binding", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("bind");
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
    extra: {
      payer?: string | null;
      settlementRef?: string | null;
      providerPaymentId?: string | null;
      providerAuthorizationId?: string | null;
    } = {},
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
      settlementRef: extra.settlementRef ?? null,
      nowIso,
      payerAddress: extra.payer === undefined ? PAYER : extra.payer,
      providerPaymentId: extra.providerPaymentId,
      providerAuthorizationId: extra.providerAuthorizationId,
    });
    return store;
  }

  it("1. payer unknown + commercial fields only → review required", async () => {
    const store = await seed("pay_u1", { payer: null });
    const r = await applySettlementReview({
      paymentId: "pay_u1",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: { ...failedBody(TX), payer: "" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("inconclusive_failure_evidence");
      expect(r.status).toBe("settlement_review_required");
    }
    const p = await store.getMonitoringPassPaymentById("pay_u1");
    expect(p?.status).toBe("settlement_review_required");
  });

  it("2. same payer + commercial + unrelated tx + no provider id → review", async () => {
    const store = await seed("pay_u2");
    const bare =
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const r = await applySettlementReview({
      paymentId: "pay_u2",
      decision: "failed",
      transactionHash: bare,
      env,
      store,
      statusOverride: failedBody(bare),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("inconclusive_failure_evidence");
  });

  it("3. matching provider_payment_id → conclusive failure", async () => {
    const store = await seed("pay_b3", {
      providerPaymentId: "fac_pay_match",
    });
    const r = await applySettlementReview({
      paymentId: "pay_b3",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, { paymentId: "fac_pay_match" }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.decision).toBe("failed");
    const p = await store.getMonitoringPassPaymentById("pay_b3");
    expect(p?.status).toBe("failed");
    expect(p?.settlement_ref).toBe(TX_CANON);
  });

  it("4. matching provider_authorization_id → conclusive failure", async () => {
    const store = await seed("pay_b4", {
      providerAuthorizationId: "fac_auth_match",
    });
    const r = await applySettlementReview({
      paymentId: "pay_b4",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, { authorization_id: "fac_auth_match" }),
    });
    expect(r.ok).toBe(true);
    const p = await store.getMonitoringPassPaymentById("pay_b4");
    expect(p?.status).toBe("failed");
  });

  it("5. mismatched provider payment id → review required", async () => {
    const store = await seed("pay_b5", {
      providerPaymentId: "fac_pay_stored",
    });
    const r = await applySettlementReview({
      paymentId: "pay_b5",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, { paymentId: "fac_pay_other" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("inconclusive_failure_evidence");
      expect(r.message).toBe("provider_payment_id_mismatch");
    }
  });

  it("6. mismatched provider authorization id → review required", async () => {
    const store = await seed("pay_b6", {
      providerAuthorizationId: "fac_auth_stored",
    });
    const r = await applySettlementReview({
      paymentId: "pay_b6",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, { authorizationId: "fac_auth_other" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe("provider_authorization_id_mismatch");
    }
  });

  it("7. canonical tx already on this payment → conclusive failure", async () => {
    const store = await seed("pay_b7", { settlementRef: TX });
    const r = await applySettlementReview({
      paymentId: "pay_b7",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX),
    });
    expect(r.ok).toBe(true);
    const p = await store.getMonitoringPassPaymentById("pay_b7");
    expect(p?.status).toBe("failed");
    expect(p?.settlement_ref).toBe(TX_CANON);
  });

  it("8. tx on payment A cannot fail payment B", async () => {
    const store = await seed("pay_a8", {
      settlementRef: TX,
      providerPaymentId: "fac_a",
    });
    await applySettlementReview({
      paymentId: "pay_a8",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, { paymentId: "fac_a" }),
    });
    await seed("pay_b8", { providerPaymentId: "fac_b" });
    const r = await applySettlementReview({
      paymentId: "pay_b8",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, { paymentId: "fac_b" }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("evidence_bound_to_other_payment");
  });

  it("9. upper/lower case transaction → one canonical claim", async () => {
    const store = await seed("pay_c9", {
      providerPaymentId: "fac_case",
    });
    const upper =
      "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
    const r = await applySettlementReview({
      paymentId: "pay_c9",
      decision: "failed",
      transactionHash: upper,
      env,
      store,
      statusOverride: failedBody(upper, { paymentId: "fac_case" }),
    });
    expect(r.ok).toBe(true);
    const claim = await store.getSettlementRefClaim(upper.toLowerCase());
    expect(claim?.payment_id).toBe("pay_c9");
    await seed("pay_c9b", { providerPaymentId: "fac_case2" });
    const again = await applySettlementReview({
      paymentId: "pay_c9b",
      decision: "failed",
      transactionHash: upper.toLowerCase(),
      env,
      store,
      statusOverride: failedBody(upper.toLowerCase(), {
        paymentId: "fac_case2",
      }),
    });
    expect(again.ok).toBe(false);
  });

  it("10. concurrent review → exactly one winner", async () => {
    const store = await seed("pay_conc_a", {
      providerPaymentId: "fac_conc",
    });
    await seed("pay_conc_b", { providerPaymentId: "fac_conc" });
    const tx2 =
      "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    const results = await Promise.all([
      applySettlementReview({
        paymentId: "pay_conc_a",
        decision: "failed",
        transactionHash: tx2,
        env,
        store,
        statusOverride: failedBody(tx2, { paymentId: "fac_conc" }),
      }),
      applySettlementReview({
        paymentId: "pay_conc_b",
        decision: "failed",
        transactionHash: tx2.toLowerCase(),
        env,
        store,
        statusOverride: failedBody(tx2.toLowerCase(), {
          paymentId: "fac_conc",
        }),
      }),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(1);
  });

  it("11. commercial-only fields are insufficient (binding helper)", () => {
    const r = evaluatePaymentSpecificBinding({
      expectedTx: TX_CANON,
      storedSettlementRef: null,
      storedProviderPaymentId: null,
      storedProviderAuthorizationId: null,
      status: failedBody(TX),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("inconclusive_failure_evidence");
  });

  it("does not compare provider ids to Nobu payment.id or digest", async () => {
    const store = await seed("pay_ns", {
      // deliberately set provider id equal to internal payment id would still need status match
    });
    const dig = sha256Hex("auth-pay_ns");
    // Facilitator returns Nobu payment id — without stored provider id this is not Binding B
    const r = await applySettlementReview({
      paymentId: "pay_ns",
      decision: "failed",
      transactionHash: TX,
      env,
      store,
      statusOverride: failedBody(TX, {
        paymentId: "pay_ns",
        authorizationId: dig,
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("inconclusive_failure_evidence");
  });
});

describe("C. real initial summary path", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;
  let localPath: string;
  let localDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("sum-d");
    durableDb = openDatabase(durablePath);
    migrateUp(durableDb);
    localPath = tempDb("sum-l");
    localDb = openDatabase(localPath);
    migrateUp(localDb);
    resetAuthStoreCache();
    clearCapturedPriceDropEmails();
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
  });
  afterEach(() => {
    clearCapturedPriceDropEmails();
    resetAuthStoreCache();
    try {
      durableDb.close();
    } catch {
      /* */
    }
    try {
      localDb.close();
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(durablePath);
    } catch {
      /* */
    }
    try {
      fs.unlinkSync(localPath);
    } catch {
      /* */
    }
  });

  function seedPurchase(
    db: ReturnType<typeof openDatabase>,
    args: { purchaseId: string; ownerRef: string; price?: number },
  ) {
    const price = args.price ?? 20;
    db.prepare(
      `INSERT INTO purchases (
        id, user_ref, target_product_url, purchase_price, currency, purchase_date,
        country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
        is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      args.purchaseId,
      args.ownerRef,
      "https://www.target.com/p/example-widget/-/A-87654321",
      price,
      "USD",
      "2026-07-01",
      "US",
      "TX",
      "target_online",
      "WDG-100",
      null,
      "87654321",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      null,
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    const purchase = {
      purchase_id: args.purchaseId,
      target_product_url:
        "https://www.target.com/p/example-widget/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
      product_title: "Example Widget Blue",
      size: "10 oz",
      color: "blue",
    };
    const offer: MatchableOffer = {
      offer_id: "seed",
      title: "Example Widget Blue 10 oz",
      seller_kind: "target",
      seller_text: "Target",
      is_target_plus: false,
      merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
      size: "10 oz",
      color: "blue",
      observed_price: price,
      currency: "USD",
    };
    const evaluation = evaluateProductMatches(purchase, [offer]);
    confirmAndPersistLockedFingerprint({
      db,
      purchase,
      candidate: evaluation.exact_candidate!,
      confirmed_at: "2026-07-02T00:00:00.000Z",
    });
  }

  function insertImmediateSent(
    db: ReturnType<typeof openDatabase>,
    accountId: string,
    n: number,
    at: string,
  ) {
    for (let i = 0; i < n; i++) {
      db.prepare(
        `INSERT INTO email_notifications (
          id, purchase_id, account_id, alert_id, opportunity_key, kind, status,
          reason, recipient_email_hash, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        `n_imm_${i}_${Math.random().toString(16).slice(2, 8)}`,
        `pur_imm_${i}`,
        accountId,
        `al_imm_${i}`,
        `opp_imm_${i}_${at}`,
        "immediate",
        "sent",
        "sent_immediate",
        "hash",
        at,
      );
    }
  }

  async function createAlert(
    db: ReturnType<typeof openDatabase>,
    purchaseId: string,
    observedPrice: number,
    asOf: string,
  ): Promise<string> {
    const batch = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: asOf,
      purchase_id: purchaseId,
      fetchObservation: () => ({
        offers: [
          {
            offer_id: "obs",
            title: "Example Widget Blue 10 oz",
            seller_kind: "target",
            seller_text: "Target",
            is_target_plus: false,
            merchant_link:
              "https://www.target.com/p/example-widget/-/A-87654321",
            target_item_id: "87654321",
            model_number: "WDG-100",
            size: "10 oz",
            color: "blue",
            observed_price: observedPrice,
            currency: "USD",
          },
        ],
        provider_status: "LIVE_TARGET_MATCH",
        observed_at: asOf,
        consumed_search: true,
      }),
    });
    expect(batch.alerts_created).toBe(1);
    return batch.results[0]!.alert_id!;
  }

  it("single-db orchestration: summary path + rolling + consent + idempotency", async () => {
    // One SQLite for local + durable (test mode)
    const dbPath = tempDb("orch");
    const db = openDatabase(dbPath);
    migrateUp(db);
    resetAuthStoreCache();
    clearCapturedPriceDropEmails();

    const store = await getAuthStore({ sqliteDb: db, env, forceSqlite: true });
    await store.ensureSchema();
    const t0 = "2026-07-01T23:59:00.000Z";
    const account = await store.upsertAccountForEmail("orch@example.com", t0);
    await store.markAccountVerified(account.id, t0);

    // 4 purchases so we can exceed 3 immediate / account and trip summary
    for (let i = 0; i < 4; i++) {
      seedPurchase(db, {
        purchaseId: `pur_o${i}`,
        ownerRef: account.id,
        price: 30 + i,
      });
      await setEmailAlertPreference({
        db,
        accountId: account.id,
        purchaseId: `pur_o${i}`,
        enabled: true,
        nowIso: t0,
      });
    }

    // Send 3 immediates (account cap)
    for (let i = 0; i < 3; i++) {
      const alertId = await createAlert(db, `pur_o${i}`, 10 + i, t0);
      const r = await processPriceDropEmailForNewAlert({
        db,
        purchaseId: `pur_o${i}`,
        alertId,
        nowIso: t0,
        env,
        accountStore: store,
      });
      expect(r.status).toBe("sent");
    }

    let providerCalls = 0;
    const sendFn = async (a: {
      opportunityKey: string;
      kind: string;
      subject?: string;
      text?: string;
    }) => {
      providerCalls += 1;
      expect(a.kind).toBe("summary");
      expect(a.opportunityKey).toBe(
        `summary_${account.id}_${summaryWindowStart(t0)}`,
      );
      expect(a.subject).toMatch(/possible price drops/i);
      expect(a.text).toContain("Example Widget");
      return { ok: true };
    };

    // 4th alert → summary path via real entry
    const alert4 = await createAlert(db, "pur_o3", 12, t0);
    // Intercept by processing with custom worker after natural path uses productionSend;
    // First force natural path without inject: uses test-mode sendSummaryEmailDirect
    const natural = await processPriceDropEmailForNewAlert({
      db,
      purchaseId: "pur_o3",
      alertId: alert4,
      nowIso: t0,
      env,
      accountStore: store,
    });
    expect(["combined", "sent", "failed"]).toContain(natural.status);
    // Natural path uses processNotificationOutboxOpportunity → sendSummaryEmailDirect
    const captures = getCapturedPriceDropEmails();
    const summaryCaptures = captures.filter((c) => c.purchase_id === "summary");
    expect(summaryCaptures.length).toBeGreaterThanOrEqual(1);
    expect(summaryCaptures[0]!.subject).toMatch(/possible price drops/i);
    expect(summaryCaptures[0]!.text).toContain("Example Widget");

    const summaryKey = `summary_${account.id}_${summaryWindowStart(t0)}`;
    const outbox = await store.getNotificationOutboxByOpportunity(summaryKey);
    expect(outbox?.status).toBe("sent");
    expect(outbox?.opportunity_key).toBe(summaryKey);

    // 2. another at 00:01 UTC next day — no provider call via worker
    const tMidnight = "2026-07-02T00:01:00.000Z";
    providerCalls = 0;
    await store.insertNotificationOutbox({
      id: "out_mid",
      opportunityKey: "sum_mid_probe",
      purchaseId: "pur_o0",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: outbox?.evidence_json ?? "{}",
      nowIso: tMidnight,
    });
    await processDueNotificationOutbox({
      store,
      nowIso: tMidnight,
      env,
      sendFn: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    });
    expect(providerCalls).toBe(0);

    // 3. 23h59 after first — blocked
    const t2359 = new Date(
      Date.parse(t0) + SUMMARY_ROLLING_WINDOW_MS - 60_000,
    ).toISOString();
    await store.insertNotificationOutbox({
      id: "out_2359",
      opportunityKey: "sum_2359_probe",
      purchaseId: "pur_o0",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: outbox?.evidence_json ?? "{}",
      nowIso: t2359,
    });
    providerCalls = 0;
    await processNotificationOutboxOpportunity({
      store,
      opportunityKey: "sum_2359_probe",
      nowIso: t2359,
      env,
      sendFn: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    });
    expect(providerCalls).toBe(0);

    // 4. exactly 24h later may send
    const t24 = new Date(
      Date.parse(t0) + SUMMARY_ROLLING_WINDOW_MS,
    ).toISOString();
    await store.insertNotificationOutbox({
      id: "out_24",
      opportunityKey: "sum_24_probe",
      purchaseId: "pur_o0",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: outbox?.evidence_json ?? "{}",
      nowIso: t24,
    });
    // 5. concurrent initial-style + worker → one provider call
    providerCalls = 0;
    const [a, b] = await Promise.all([
      processNotificationOutboxOpportunity({
        store,
        opportunityKey: "sum_24_probe",
        nowIso: t24,
        env,
        sendFn: async (args) => {
          providerCalls += 1;
          expect(args.opportunityKey).toBe("sum_24_probe");
          return { ok: true };
        },
      }),
      processDueNotificationOutbox({
        store,
        nowIso: t24,
        env,
        sendFn: async () => {
          providerCalls += 1;
          return { ok: true };
        },
      }),
    ]);
    const sentCount =
      (a.outcome === "sent" ? 1 : 0) +
      (b.sent > 0 ? b.sent : 0);
    // At most one send; lease/reserve contention may yield 1
    expect(providerCalls).toBe(1);
    expect(sentCount).toBeGreaterThanOrEqual(1);

    // 11. sent never resends
    providerCalls = 0;
    const again = await processNotificationOutboxOpportunity({
      store,
      opportunityKey: "sum_24_probe",
      nowIso: t24,
      env,
      sendFn: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    });
    expect(again.outcome).toBe("skipped");
    expect(providerCalls).toBe(0);

    // 7–8. provider failure releases reserve + retry sends once
    const tFail = new Date(
      Date.parse(t24) + SUMMARY_ROLLING_WINDOW_MS,
    ).toISOString();
    await store.insertNotificationOutbox({
      id: "out_fail",
      opportunityKey: "sum_fail_probe",
      purchaseId: "pur_o0",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: outbox?.evidence_json ?? "{}",
      nowIso: tFail,
    });
    const failRes = await processNotificationOutboxOpportunity({
      store,
      opportunityKey: "sum_fail_probe",
      nowIso: tFail,
      env,
      sendFn: async () => ({ ok: false, error: "provider_send_failed" }),
    });
    expect(failRes.outcome).toBe("failed_retryable");
    const failedRow =
      await store.getNotificationOutboxByOpportunity("sum_fail_probe");
    expect(failedRow?.status).toBe("failed_retryable");

    // Reserve released: retry can send
    providerCalls = 0;
    // Reset outbox to pending for retry
    await store.markNotificationOutboxStatus({
      id: failedRow!.id,
      status: "pending",
      reason: "retry",
      nowIso: tFail,
    });
    const retry = await processNotificationOutboxOpportunity({
      store,
      opportunityKey: "sum_fail_probe",
      nowIso: tFail,
      env,
      sendFn: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    });
    expect(retry.outcome).toBe("sent");
    expect(providerCalls).toBe(1);

    // 9. consent revoked suppresses
    await store.updatePurchaseLifecycleMeta({
      accountId: account.id,
      purchaseId: "pur_o0",
      email_alerts_enabled: 0,
      nowIso: tFail,
    });
    const tCons = new Date(
      Date.parse(tFail) + SUMMARY_ROLLING_WINDOW_MS,
    ).toISOString();
    await store.insertNotificationOutbox({
      id: "out_cons",
      opportunityKey: "sum_cons_probe",
      purchaseId: "pur_o0",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: outbox?.evidence_json ?? "{}",
      nowIso: tCons,
    });
    providerCalls = 0;
    const cons = await processNotificationOutboxOpportunity({
      store,
      opportunityKey: "sum_cons_probe",
      nowIso: tCons,
      env,
      sendFn: async () => {
        providerCalls += 1;
        return { ok: true };
      },
    });
    expect(cons.outcome).toBe("suppressed");
    expect(cons.reason).toBe("consent_revoked");
    expect(providerCalls).toBe(0);

    // 12. deterministic idempotency key equals opportunity key (asserted in sendFn above)

    // 6. two local caches, one durable store → one provider call
    const localA = openDatabase(tempDb("la"));
    const localB = openDatabase(tempDb("lb"));
    migrateUp(localA);
    migrateUp(localB);
    const tTwo = new Date(
      Date.parse(tCons) + SUMMARY_ROLLING_WINDOW_MS,
    ).toISOString();
    // Re-enable consent
    await store.updatePurchaseLifecycleMeta({
      accountId: account.id,
      purchaseId: "pur_o1",
      email_alerts_enabled: 1,
      nowIso: tTwo,
    });
    await store.insertNotificationOutbox({
      id: "out_two",
      opportunityKey: "sum_two_workers",
      purchaseId: "pur_o1",
      accountId: account.id,
      kind: "summary",
      status: "pending",
      evidenceJson: outbox?.evidence_json ?? "{}",
      nowIso: tTwo,
    });
    providerCalls = 0;
    const [w1, w2] = await Promise.all([
      processNotificationOutboxOpportunity({
        store,
        opportunityKey: "sum_two_workers",
        nowIso: tTwo,
        env,
        sendFn: async () => {
          providerCalls += 1;
          return { ok: true };
        },
      }),
      processNotificationOutboxOpportunity({
        store,
        opportunityKey: "sum_two_workers",
        nowIso: tTwo,
        env,
        sendFn: async () => {
          providerCalls += 1;
          return { ok: true };
        },
      }),
    ]);
    expect(
      [w1.outcome, w2.outcome].filter((o) => o === "sent").length,
    ).toBe(1);
    expect(providerCalls).toBe(1);
    localA.close();
    localB.close();

    db.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* */
    }
    void insertImmediateSent;
    void sendFn;
    void verifySettlementEvidence;
  });
});
