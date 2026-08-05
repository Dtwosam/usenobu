/**
 * Paid-to-active transactional repair — focused proof suite.
 *
 * Covers payment, pass handoff, quote/activation, scheduler lease, and
 * notification outbox. No genuine payment. Mocked OKX only.
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
  beginAgentEmailVerification,
  verifyAgentEmailCode,
} from "../../src/auth/agent-connections.js";
import {
  clearCapturedAgentEmailCodes,
  peekCapturedAgentEmailCode,
} from "../../src/auth/email.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import {
  buildX402Challenge,
  encodeX402ChallengeHeader,
  encodeX402PaymentResponseHeader,
  decodePaymentSignatureHeaderSafe,
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_VERSION,
  X402_PAYMENT_HEADER_NAME,
  type X402Verifier,
  type X402VerifyResult,
} from "../../src/payments/x402.js";
import {
  createOkxAccessHeaders,
  loadOkxSellerConfig,
  OkxSellerClient,
  parseOkxEnvelope,
  OkxSellerBusinessError,
  type OkxHttpFetch,
} from "../../src/payments/okx-seller-client.js";
import {
  createOkxSellerVerifier,
  buildServerPaymentRequirements,
  parsePaymentPayloadFromHeader,
  assertPayloadDoesNotOverrideServerTerms,
} from "../../src/payments/okx-seller-verifier.js";
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
  reconcilePendingPassSettlements,
  resolveMonitoringPassForAgent,
} from "../../src/payments/monitoring-pass-service.js";
import { runScheduledMonitoringTickWithDurableBridge } from "../../src/monitoring/durable-bridge.js";
import { processPriceDropEmailForNewAlert } from "../../src/notifications/process.js";
import { recentPurchaseDate } from "../helpers/test-dates.js";

const PASS_RESOURCE = "https://www.usenobu.xyz/v1/agent/monitoring-pass";
const PAY_TO = "0x1111111111111111111111111111111111111111";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-paid-active-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function validPayloadHeader(
  resource = PASS_RESOURCE,
  overrides: Record<string, unknown> = {},
): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: DEFAULT_SETTLEMENT_NETWORK,
      asset: DEFAULT_SETTLEMENT_ASSET,
      amount: MONITORING_PRICE_ATOMIC_UNITS,
      resource,
      payTo: PAY_TO,
      ...overrides,
    },
    payload: { signature: "sig_test_opaque_never_logged" },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function acceptingVerifier(settlementRef: string): X402Verifier {
  return {
    label: "test-fake-accept",
    async verifyPayment(): Promise<X402VerifyResult> {
      return { ok: true, settlementRef, verifiedVia: "test" };
    },
  };
}

function mockFetchSequence(
  responses: Array<{ match: RegExp; status?: number; body: unknown; raw?: unknown }>,
): { fetchImpl: OkxHttpFetch; calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  const queue = [...responses];
  const fetchImpl: OkxHttpFetch = async (url, init) => {
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ url, method });
    const next = queue.find((r) => r.match.test(url));
    if (!next) {
      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 500,
      });
    }
    const idx = queue.indexOf(next);
    queue.splice(idx, 1);
    const payload =
      next.raw !== undefined
        ? next.raw
        : { code: "0", data: next.body };
    return new Response(JSON.stringify(payload), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

describe("Paid-to-active transaction repair", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;
  const testEnv = {
    NOBU_AUTH_TEST_MODE: "1",
    NOBU_FIXTURE_MODE: "1",
    OKX_API_KEY: "test-key",
    OKX_SECRET_KEY: "test-secret",
    OKX_PASSPHRASE: "test-pass",
    OKX_PAY_TO: PAY_TO,
    OKX_BASE_URL: "https://web3.okx.com",
  };

  beforeEach(() => {
    dbPath = tempDb();
    db = openDatabase(dbPath);
    migrateUp(db);
    resetAuthStoreCache();
    resetWebDatabaseCache();
    clearCapturedAgentEmailCodes();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
    resetAuthStoreCache();
    resetWebDatabaseCache();
  });

  // ---------- Payment ----------

  it("builds official-compatible challenge with locked terms", () => {
    const challenge = buildX402Challenge({
      resource: PASS_RESOURCE,
      description: "Nobu Monitoring Pass",
      env: testEnv,
    });
    expect(challenge.x402Version).toBe(X402_VERSION);
    expect(challenge.accepts[0]!.scheme).toBe("exact");
    expect(challenge.accepts[0]!.network).toBe(DEFAULT_SETTLEMENT_NETWORK);
    expect(challenge.accepts[0]!.asset).toBe(DEFAULT_SETTLEMENT_ASSET);
    expect(challenge.accepts[0]!.amount).toBe(MONITORING_PRICE_ATOMIC_UNITS);
    expect(challenge.accepts[0]!.payTo).toBe(PAY_TO);
    const header = encodeX402ChallengeHeader(challenge);
    expect(header.length).toBeGreaterThan(20);
    // Header must not embed raw secrets
    expect(header).not.toMatch(/test-secret/);
  });

  it("challenge and verify requirements are identical for locked fields", () => {
    const challenge = buildX402Challenge({
      resource: PASS_RESOURCE,
      description: "pass",
      env: testEnv,
    });
    const req = buildServerPaymentRequirements({
      resource: PASS_RESOURCE,
      payTo: PAY_TO,
    });
    expect(req.scheme).toBe(challenge.accepts[0]!.scheme);
    expect(req.network).toBe(challenge.accepts[0]!.network);
    expect(req.asset).toBe(challenge.accepts[0]!.asset);
    expect(req.amount).toBe(challenge.accepts[0]!.amount);
    expect(req.payTo).toBe(challenge.accepts[0]!.payTo);
    expect(req.resource).toBe(PASS_RESOURCE);
  });

  it("successful verify/settle returns receipt and one pass", async () => {
    const { fetchImpl } = mockFetchSequence([
      {
        match: /supported/,
        body: {
          kinds: [
            {
              x402Version: 2,
              scheme: "exact",
              network: DEFAULT_SETTLEMENT_NETWORK,
              extra: { name: "USD₮0", version: "2" },
            },
          ],
        },
      },
      {
        match: /verify/,
        body: { isValid: true, payer: "0xbuyer0000000000000000000000000000000001" },
      },
      {
        match: /settle$/,
        body: {
          success: true,
          status: "success",
          transaction: "0xtx_success_abcdef",
          payer: "0xbuyer0000000000000000000000000000000001",
          network: DEFAULT_SETTLEMENT_NETWORK,
        },
      },
    ]);
    const seller = createOkxSellerVerifier({ env: testEnv, fetchImpl });
    const detailed = await seller.verifyAndSettleDetailed({
      resource: PASS_RESOURCE,
      authorizationHeader: validPayloadHeader(),
    });
    expect(detailed.ok).toBe(true);
    if (!detailed.ok) return;
    expect(detailed.settlementRef).toBe("0xtx_success_abcdef");
    const receipt = encodeX402PaymentResponseHeader({
      success: true,
      transaction: detailed.settlementRef,
      status: "success",
      payer: detailed.payer,
    });
    expect(receipt.length).toBeGreaterThan(10);
    expect(receipt).not.toMatch(/sig_test/);
  });

  it("malformed and mismatched replay classified safely", async () => {
    expect(parsePaymentPayloadFromHeader("not-valid")).toBeNull();
    expect(decodePaymentSignatureHeaderSafe("!!!")).toBeNull();

    const req = buildServerPaymentRequirements({
      resource: PASS_RESOURCE,
      payTo: PAY_TO,
    });
    const payload = parsePaymentPayloadFromHeader(
      validPayloadHeader(PASS_RESOURCE, { amount: "1" }),
    )!;
    expect(assertPayloadDoesNotOverrideServerTerms(payload, req)).toBe(
      "amount_mismatch",
    );
  });

  it("top-level OKX business errors handled without reading data", () => {
    expect(() =>
      parseOkxEnvelope({ code: "50011", msg: "Invalid OK-ACCESS-KEY" }, "verify"),
    ).toThrow(OkxSellerBusinessError);
    const data = parseOkxEnvelope(
      { code: "0", data: { isValid: true } },
      "verify",
    ) as { isValid: boolean };
    expect(data.isValid).toBe(true);
  });

  it("pending and timeout poll correctly; lost settle becomes settlement_unknown", async () => {
    // Pending then success on status poll
    const pending = mockFetchSequence([
      { match: /supported/, body: { kinds: [] } },
      { match: /verify/, body: { isValid: true, payer: "0xbuyer" } },
      {
        match: /settle$/,
        body: {
          success: true,
          status: "pending",
          transaction: "0xtx_pending_1",
        },
      },
      {
        match: /settle\/status/,
        body: { success: true, status: "success", transaction: "0xtx_pending_1" },
      },
    ]);
    const seller1 = createOkxSellerVerifier({
      env: testEnv,
      fetchImpl: pending.fetchImpl,
    });
    const r1 = await seller1.verifyAndSettleDetailed({
      resource: PASS_RESOURCE,
      authorizationHeader: validPayloadHeader(),
    });
    expect(r1.ok).toBe(true);

    // Transport error on settle → settlement_unknown
    const failFetch: OkxHttpFetch = async (url) => {
      if (/supported/.test(url)) {
        return new Response(JSON.stringify({ code: "0", data: { kinds: [] } }), {
          status: 200,
        });
      }
      if (/verify/.test(url)) {
        return new Response(
          JSON.stringify({ code: "0", data: { isValid: true } }),
          { status: 200 },
        );
      }
      throw new Error("network_reset");
    };
    const seller2 = createOkxSellerVerifier({ env: testEnv, fetchImpl: failFetch });
    const r2 = await seller2.verifyAndSettleDetailed({
      resource: PASS_RESOURCE,
      authorizationHeader: validPayloadHeader(),
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    // No tx hash after transport loss → review required (not auto-reconcile claim).
    expect(["settlement_unknown", "settlement_review_required"]).toContain(
      r2.reason,
    );
  });

  it("settlement_unknown does not create a second challenge", async () => {
    const failFetch: OkxHttpFetch = async (url) => {
      if (/supported/.test(url)) {
        return new Response(JSON.stringify({ code: "0", data: { kinds: [] } }), {
          status: 200,
        });
      }
      if (/verify/.test(url)) {
        return new Response(
          JSON.stringify({ code: "0", data: { isValid: true } }),
          { status: 200 },
        );
      }
      throw new Error("network_reset");
    };
    // Inject via testVerifier that returns settlement_unknown
    const unknownVerifier: X402Verifier = {
      label: "unknown",
      async verifyPayment() {
        return {
          ok: false,
          reason: "settlement_unknown",
          pendingTxHash: "0xunknown_tx",
        };
      },
    };
    const first = await monitoringPassForAgent({
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: testEnv,
      testVerifier: unknownVerifier,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.status).toBe("PAYMENT_SETTLEMENT_UNKNOWN");
    expect(first.http_status).toBe(200);

    // Replay same signature — still unknown, not a fresh 402 challenge
    const second = await monitoringPassForAgent({
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: testEnv,
      testVerifier: unknownVerifier,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("PAYMENT_SETTLEMENT_UNKNOWN");
    expect(second.http_status).toBe(200);
  });

  it("exactly one pass across concurrent settlement replays", async () => {
    const ref = "0xtx_once_only_abcdef012345";
    const header = validPayloadHeader();
    const results = await Promise.all(
      [0, 1, 2, 3, 4].map(() =>
        monitoringPassForAgent({
          paymentAuthorizationHeader: header,
          resource: PASS_RESOURCE,
          sqliteDb: db,
          env: testEnv,
          testVerifier: acceptingVerifier(ref),
        }),
      ),
    );
    const issued = results.filter(
      (r) => r.ok && r.status === "MONITORING_PASS_ISSUED",
    );
    expect(issued.length).toBe(5);
    const passIds = new Set(
      issued.map((r) =>
        r.ok && r.status === "MONITORING_PASS_ISSUED" ? r.pass.id : "",
      ),
    );
    expect(passIds.size).toBe(1);
    const rows = db
      .prepare(`SELECT id FROM monitoring_passes`)
      .all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
  });

  it("no raw signature in logs database or response body", async () => {
    const header = validPayloadHeader();
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: testEnv,
      testVerifier: acceptingVerifier("0xtx_nosig"),
    });
    expect(result.ok).toBe(true);
    const body = monitoringPassResponseBody(result);
    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/sig_test_opaque/);
    expect(blob).not.toMatch(header);
    const digests = db
      .prepare(`SELECT authorization_digest FROM monitoring_pass_payments`)
      .all() as Array<{ authorization_digest: string }>;
    expect(digests[0]!.authorization_digest).toBe(sha256Hex(header));
    expect(digests[0]!.authorization_digest).not.toBe(header);
  });

  it("unpaid body is neutral facts without agent-control prose", async () => {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: null,
      resource: PASS_RESOURCE,
      env: testEnv,
    });
    expect(result.ok).toBe(false);
    const body = monitoringPassResponseBody(result);
    expect(body.never_ask_user_for).toBeUndefined();
    expect(body.guidance).toBeUndefined();
    expect(body.wallet_preflight_blocker).toBeUndefined();
    expect(body.replay_header_name).toBe(X402_PAYMENT_HEADER_NAME);
    expect(body.business_input_required).toBe(false);
    expect(body.monitoring_active).toBe(false);
    expect(body.amount).toBe(MONITORING_PRICE_ATOMIC_UNITS);
  });

  // ---------- Pass and setup ----------

  it("public ids alone cannot claim a pass; valid credential can once", async () => {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: testEnv,
      testVerifier: acceptingVerifier("0xtx_claim_1"),
    });
    expect(result.ok && result.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!result.ok || result.status !== "MONITORING_PASS_ISSUED") return;

    const passId = result.pass.id;
    const contId = result.pass_continuation_id;
    const claim = result.pass_claim_credential;
    expect(claim).toBeTruthy();

    // Resolve is read-only: public id status works; never authorizes claim.
    const status = await resolveMonitoringPassForAgent({
      monitoringPassId: passId,
      sqliteDb: db,
      env: testEnv,
    });
    expect(status.http_status).toBe(200);
    expect(status.body.claim_required).toBe(true);
    expect(status.body.claim_authorized).toBe(false);

    // Wrong credential on resolve does not consume and does not authorize.
    const bad = await resolveMonitoringPassForAgent({
      passContinuationId: contId,
      passClaimCredential: "pass_claim_wrong",
      sqliteDb: db,
      env: testEnv,
    });
    expect(bad.http_status).toBe(200);
    expect(bad.body.claim_authorized).toBe(false);
    expect(bad.body.claim_required).toBe(true);

    // Valid credential on resolve also does not consume (claim_authorized false).
    const good = await resolveMonitoringPassForAgent({
      passContinuationId: contId,
      passClaimCredential: claim,
      sqliteDb: db,
      env: testEnv,
    });
    expect(good.http_status).toBe(200);
    expect(good.body.claim_authorized).toBe(false);
    expect(good.body.claim_required).toBe(true);

    // Atomic claim via store still requires matching hash.
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    const { sha256Hex } = await import("../../src/auth/crypto.js");
    const claimed = await store.claimPassAndCreateJourney({
      continuationId: contId!,
      claimCredentialHash: sha256Hex(claim!),
      journeyId: "journey_claim_once",
      monitoringPassId: passId,
      nowIso: new Date().toISOString(),
    });
    expect(claimed.outcome).toBe("created");

    // Invalid credential cannot recover journey after consumption.
    const invalid = await store.claimPassAndCreateJourney({
      continuationId: contId!,
      claimCredentialHash: sha256Hex("pass_claim_wrong"),
      journeyId: "journey_claim_bad",
      monitoringPassId: passId,
      nowIso: new Date().toISOString(),
    });
    expect(invalid.outcome).toBe("claim_invalid");

    // Matching credential recovers same journey (lost response recovery).
    const recover = await store.claimPassAndCreateJourney({
      continuationId: contId!,
      claimCredentialHash: sha256Hex(claim!),
      journeyId: "journey_claim_recover",
      monitoringPassId: passId,
      nowIso: new Date().toISOString(),
    });
    expect(recover.outcome).toBe("already_existed");
    if (recover.outcome === "already_existed" || recover.outcome === "created") {
      expect(recover.journey.id).toBe("journey_claim_once");
    }
  });

  // ---------- Quote lifecycle ----------

  it("expired quote is replaced; only one usable issued quote", async () => {
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    await store.ensureSchema();
    const account = await store.upsertAccountForEmail(
      "quote-test@example.com",
      new Date().toISOString(),
    );
    const nowIso = new Date().toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    // Insert a stale issued quote that still blocks the partial unique index.
    db.prepare(
      `INSERT INTO monitoring_enrollment_quotes
       (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
        price_currency, settlement_asset, settlement_network, monitoring_deadline,
        consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
       VALUES (?,?,?,?,?,0.99,'USD',NULL,NULL,NULL,?,?, 'issued',?,?)`,
    ).run(
      "quote_stale_001",
      "conn_q1",
      account.id,
      "pur_q1",
      "fp_q1",
      nowIso,
      nowIso,
      past,
      past,
    );

    const replaced = await store.replaceIssuedEnrollmentQuote({
      id: "quote_fresh_001",
      connectionId: "conn_q1",
      accountId: account.id,
      purchaseId: "pur_q1",
      fingerprintId: "fp_q1",
      priceAmount: 0.99,
      priceCurrency: "USD",
      settlementAsset: null,
      settlementNetwork: null,
      monitoringDeadline: null,
      consentMonitoringAt: nowIso,
      consentEmailAlertsAt: nowIso,
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      nowIso,
    });
    expect(replaced.outcome).toBe("issued");
    expect(replaced.quote.id).toBe("quote_fresh_001");

    const issued = db
      .prepare(
        `SELECT id, status FROM monitoring_enrollment_quotes WHERE purchase_id = ?`,
      )
      .all("pur_q1") as Array<{ id: string; status: string }>;
    const active = issued.filter((q) => q.status === "issued");
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe("quote_fresh_001");
    const expired = issued.find((q) => q.id === "quote_stale_001");
    expect(expired?.status).toBe("expired");
  });

  it("concurrent replaceIssuedEnrollmentQuote yields one usable quote", async () => {
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    await store.ensureSchema();
    const account = await store.upsertAccountForEmail(
      "quote-race@example.com",
      new Date().toISOString(),
    );
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    const results = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        store.replaceIssuedEnrollmentQuote({
          id: `quote_race_${i}`,
          connectionId: "conn_race",
          accountId: account.id,
          purchaseId: "pur_race",
          fingerprintId: "fp_race",
          priceAmount: 0.99,
          priceCurrency: "USD",
          settlementAsset: null,
          settlementNetwork: null,
          monitoringDeadline: null,
          consentMonitoringAt: nowIso,
          consentEmailAlertsAt: nowIso,
          expiresAt,
          nowIso,
        }),
      ),
    );
    const issued = results.filter((r) => r.outcome === "issued");
    // At least one wins; all resolve to a valid quote
    expect(results.every((r) => r.quote.status === "issued")).toBe(true);
    const ids = new Set(results.map((r) => r.quote.id));
    // Partial unique index ensures only one issued row remains
    const rows = db
      .prepare(
        `SELECT id FROM monitoring_enrollment_quotes
         WHERE purchase_id = 'pur_race' AND status = 'issued'`,
      )
      .all() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(ids.has(rows[0]!.id)).toBe(true);
    expect(issued.length).toBeGreaterThanOrEqual(1);
  });

  // ---------- Scheduler lease + fairness ----------

  it("two concurrent workers acquire one global lease", async () => {
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const expires = new Date(Date.now() + 60_000).toISOString();
    const [a, b] = await Promise.all([
      store.tryAcquireGlobalLease({
        leaseKey: "test_lease",
        holderId: "worker_a",
        expiresAt: expires,
        nowIso,
      }),
      store.tryAcquireGlobalLease({
        leaseKey: "test_lease",
        holderId: "worker_b",
        expiresAt: expires,
        nowIso,
      }),
    ]);
    // Exactly one holder
    expect(Number(a) + Number(b)).toBe(1);
    const winner = a ? "worker_a" : "worker_b";
    const again = await store.tryAcquireGlobalLease({
      leaseKey: "test_lease",
      holderId: winner,
      expiresAt: expires,
      nowIso,
    });
    expect(again).toBe(true);
  });

  it("search budget reserved once under concurrency", async () => {
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.tryReserveSearchBudget({
          periodKey: "2026-08",
          limitCount: 3,
          nowIso,
        }),
      ),
    );
    const reserved = results.filter((r) => r.reserved).length;
    expect(reserved).toBe(3);
  });

  it("75+ activations paginate fairly without starving later monitors", async () => {
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const account = await store.upsertAccountForEmail(
      "fair@example.com",
      nowIso,
    );
    // Insert 80 active activations with ordered purchase ids
    for (let i = 0; i < 80; i += 1) {
      const pid = `pur_fair_${String(i).padStart(4, "0")}`;
      const aid = `act_fair_${String(i).padStart(4, "0")}`;
      const qid = `quote_fair_${String(i).padStart(4, "0")}`;
      db.prepare(
        `INSERT INTO monitor_activations
         (id, quote_id, activation_key, payment_attempt_id, purchase_id,
          fingerprint_id, monitor_id, status, created_at, projected_at)
         VALUES (?,?,?,?,?,?,?,'active',?,?)`,
      ).run(
        aid,
        qid,
        `key_${i}`,
        `pay_${i}`,
        pid,
        `fp_${i}`,
        pid,
        nowIso,
        nowIso,
      );
    }
    const page1 = await store.listActiveMonitorActivations({ limit: 50 });
    expect(page1).toHaveLength(50);
    const after = page1[page1.length - 1]!.purchase_id;
    const page2 = await store.listActiveMonitorActivations({
      limit: 50,
      afterPurchaseId: after,
    });
    expect(page2.length).toBeGreaterThanOrEqual(30);
    const ids = new Set([
      ...page1.map((a) => a.purchase_id),
      ...page2.map((a) => a.purchase_id),
    ]);
    expect(ids.size).toBe(page1.length + page2.length);
    // Later monitors (high ids) appear on page 2
    expect(page2.some((a) => a.purchase_id >= "pur_fair_0050")).toBe(true);
    void account;
  });

  // ---------- Notifications outbox ----------

  it("concurrent opportunity creates one outbox entry; crash before send stays retryable", async () => {
    const store = await getAuthStore({ sqliteDb: db, env: testEnv });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const key = "opp_unique_1";
    const [a, b] = await Promise.all([
      store.tryReserveAlertOpportunity({
        opportunityKey: key,
        purchaseId: "pur_n1",
        alertId: "alert_1",
        nowIso,
      }),
      store.tryReserveAlertOpportunity({
        opportunityKey: key,
        purchaseId: "pur_n1",
        alertId: "alert_1",
        nowIso,
      }),
    ]);
    expect(Number(a) + Number(b)).toBe(1);

    const out = await store.insertNotificationOutbox({
      id: "outbox_1",
      opportunityKey: key,
      purchaseId: "pur_n1",
      accountId: "acct_test",
      kind: "immediate",
      status: "pending",
      nowIso,
    });
    expect(out.created).toBe(true);
    const dup = await store.insertNotificationOutbox({
      id: "outbox_2",
      opportunityKey: key,
      purchaseId: "pur_n1",
      accountId: "acct_test",
      kind: "immediate",
      status: "pending",
      nowIso,
    });
    expect(dup.created).toBe(false);

    const leased = await store.tryLeaseNotificationOutbox({
      opportunityKey: key,
      holderId: "w1",
      leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      nowIso,
    });
    expect(leased?.status).toBe("sending");

    // Crash before send: mark failed_retryable, not sent
    await store.markNotificationOutboxStatus({
      id: leased!.id,
      status: "failed_retryable",
      reason: "crash_before_send",
      nowIso,
    });
    const row = await store.getNotificationOutboxByOpportunity(key);
    expect(row?.status).toBe("failed_retryable");
    expect(row?.sent_at).toBeNull();

    // Retry lease + send success
    const leased2 = await store.tryLeaseNotificationOutbox({
      opportunityKey: key,
      holderId: "w2",
      leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      nowIso,
    });
    expect(leased2).toBeTruthy();
    await store.markNotificationOutboxStatus({
      id: leased2!.id,
      status: "sent",
      reason: "sent_immediate",
      nowIso,
      sentAt: nowIso,
    });
    const sent = await store.getNotificationOutboxByOpportunity(key);
    expect(sent?.status).toBe("sent");
    expect(sent?.sent_at).toBeTruthy();
  });

  it("HMAC headers constructed without logging secrets", () => {
    const headers = createOkxAccessHeaders({
      method: "POST",
      path: "/api/v6/pay/x402/verify",
      body: "{}",
      apiKey: "k",
      secretKey: "s",
      passphrase: "p",
    });
    expect(headers["OK-ACCESS-KEY"]).toBe("k");
    expect(headers["OK-ACCESS-SIGN"]).toBeTruthy();
    expect(loadOkxSellerConfig(testEnv)?.payTo).toBe(PAY_TO);
  });
});
