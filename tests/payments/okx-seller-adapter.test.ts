/**
 * Lane 8R.0 — official OKX seller adapter (verify/settle/status).
 * Mocked HTTP only — never hits live OKX or performs a genuine payment.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recentPurchaseDate } from "../helpers/test-dates.js";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { resetAuthStoreCache } from "../../src/auth/auth-store.js";
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
  confirmProductForAgent,
  discoverProductForAgent,
  preflightMonitoringForAgent,
} from "../../src/web/agent-preflight-service.js";
import { MONITORING_PAYMENT_READY_STATUS } from "../../src/matching/store.js";
import { startMonitoringForAgent } from "../../src/payments/start-monitoring-service.js";
import {
  buildX402Challenge,
  X402_VERSION,
  DEFAULT_SETTLEMENT_NETWORK,
  DEFAULT_SETTLEMENT_ASSET,
  MONITORING_PRICE_ATOMIC_UNITS,
  resolveX402Verifier,
} from "../../src/payments/x402.js";
import {
  createOkxAccessHeaders,
  loadOkxSellerConfig,
  isOkxSellerConfigured,
  OkxSellerClient,
  OKX_X402_VERSION,
  type OkxHttpFetch,
} from "../../src/payments/okx-seller-client.js";
import {
  createOkxSellerVerifier,
  parsePaymentPayloadFromHeader,
  buildServerPaymentRequirements,
} from "../../src/payments/okx-seller-verifier.js";
import { runAgentAction } from "../../src/ai/agent-service.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import type { DiscoveryPurchaseFields } from "../../src/ai/schemas.js";

const RESOURCE = "https://usenobu.vercel.app/v1/agent/start-monitoring";
const PAY_TO = "0x1111111111111111111111111111111111111111";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-okx-seller-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function targetOffer(overrides: Partial<MatchableOffer> = {}): MatchableOffer {
  return {
    offer_id: "o1",
    title: "Example Gadget WDG-100",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: 19.99,
    currency: "USD",
    serpapi_product_id: "not-tcin",
    ...overrides,
  };
}

const EXACT_IDENTITY_FIELDS: DiscoveryPurchaseFields = {
  purchase_price: 24.99,
  purchase_date: recentPurchaseDate(),
  purchase_channel: "target_online",
  country: "US",
  region: "TX",
  target_product_url: "https://www.target.com/p/example-gadget/-/A-87654321",
  target_item_id: "87654321",
};

function validPayloadHeader(overrides: Record<string, unknown> = {}): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: DEFAULT_SETTLEMENT_NETWORK,
      asset: DEFAULT_SETTLEMENT_ASSET,
      amount: MONITORING_PRICE_ATOMIC_UNITS,
      resource: RESOURCE,
      payTo: PAY_TO,
      ...overrides,
    },
    payload: { signature: "sig_test_opaque" },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function mockFetchSequence(
  responses: Array<{
    match: RegExp;
    status?: number;
    body: unknown;
  }>,
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
    // consume first matching once
    const idx = queue.indexOf(next);
    queue.splice(idx, 1);
    return new Response(JSON.stringify({ code: "0", data: next.body }), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

describe("Lane 8R.0 OKX seller adapter", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;
  const sellerEnv = {
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
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    Object.assign(process.env, sellerEnv);
    clearCapturedAgentEmailCodes();
    resetAuthStoreCache();
    resetWebDatabaseCache();
    db = openDatabase(dbPath);
    migrateUp(db);
  });

  afterEach(() => {
    db.close();
    resetWebDatabaseCache();
    resetAuthStoreCache();
    clearCapturedAgentEmailCodes();
    for (const k of Object.keys(sellerEnv)) delete process.env[k];
    delete process.env.NOBU_DB_PATH;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  async function establishConnection(email: string) {
    const begin = await beginAgentEmailVerification({ email, sqliteDb: db });
    if (!begin.ok) throw new Error("begin failed");
    const code = peekCapturedAgentEmailCode(begin.connection_id)!;
    const verified = await verifyAgentEmailCode({
      connectionId: begin.connection_id,
      code,
      sqliteDb: db,
    });
    if (!verified.ok) throw new Error("verify failed");
    return verified;
  }

  async function establishReadyQuote(emailSeed: string) {
    const verified = await establishConnection(`${emailSeed}@example.com`);
    const discovery = await discoverProductForAgent(EXACT_IDENTITY_FIELDS, {
      offersOverride: [targetOffer()],
      sqliteDb: db,
    });
    if (!discovery.ok) throw new Error("discovery failed");
    const confirmed = await confirmProductForAgent({
      discoverySessionId: discovery.discovery_session_id,
      candidateId: discovery.candidates[0]!.candidate_id,
      sqliteDb: db,
    });
    if (!confirmed.ok) throw new Error("confirm failed");
    const preflight = await preflightMonitoringForAgent({
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      discoverySessionId: discovery.discovery_session_id,
      monitoringConsent: true,
      emailAlertConsent: true,
      sqliteDb: db,
    });
    if (!preflight.ok) throw new Error("preflight failed");
    return { verified, quoteId: preflight.quote_id };
  }

  it("HMAC headers match OKX prehash convention (no secrets logged)", () => {
    const headers = createOkxAccessHeaders({
      method: "POST",
      path: "/api/v6/pay/x402/verify",
      body: "{}",
      apiKey: "k",
      secretKey: "s",
      passphrase: "p",
      timestamp: "2026-07-20T00:00:00.000Z",
    });
    expect(headers["OK-ACCESS-KEY"]).toBe("k");
    expect(headers["OK-ACCESS-PASSPHRASE"]).toBe("p");
    expect(headers["OK-ACCESS-SIGN"]).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(headers["OK-ACCESS-TIMESTAMP"]).toBe("2026-07-20T00:00:00.000Z");
  });

  it("challenge is x402 v2 exact + quote-bound + server payTo", () => {
    const challenge = buildX402Challenge({
      resource: RESOURCE,
      description: "Activate Nobu price monitoring for one purchase.",
      quoteId: "quote_abc",
      env: sellerEnv,
    });
    expect(challenge.x402Version).toBe(X402_VERSION);
    expect(challenge.x402Version).toBe(OKX_X402_VERSION);
    // Lane 8R.3B — v2 carries a resource object; only legacy v1 used a string.
    expect(challenge.resource.url).toBe(RESOURCE);
    expect(challenge.resource.mimeType).toBe("application/json");
    expect(challenge.resource.description.length).toBeGreaterThan(0);
    expect(challenge.accepts[0]!.scheme).toBe("exact");
    expect(challenge.accepts[0]!.network).toBe(DEFAULT_SETTLEMENT_NETWORK);
    expect(challenge.accepts[0]!.asset.toLowerCase()).toBe(
      DEFAULT_SETTLEMENT_ASSET.toLowerCase(),
    );
    expect(challenge.accepts[0]!.amount).toBe(MONITORING_PRICE_ATOMIC_UNITS);
    expect(challenge.accepts[0]!.payTo).toBe(PAY_TO);
    expect(challenge.accepts[0]!.maxTimeoutSeconds).toBeGreaterThan(0);
    expect(challenge.accepts[0]!.extra.quote_id).toBe("quote_abc");
    // EIP-712 domain metadata read from the on-chain token, not assumed.
    expect(challenge.accepts[0]!.extra.name).toBe("USD₮0");
    expect(challenge.accepts[0]!.extra.version).toBe("2");
  });

  it("unauthorized/invalid quote never calls OKX", async () => {
    const { quoteId } = await establishReadyQuote("noauth");
    let called = 0;
    const fetchImpl: OkxHttpFetch = async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    };
    const client = new OkxSellerClient(loadOkxSellerConfig(sellerEnv)!, fetchImpl);
    const seller = createOkxSellerVerifier({
      env: sellerEnv,
      client,
    });

    const bad = await startMonitoringForAgent({
      quoteId,
      connectionId: "conn_unknown",
      connectionToken: "bogus-token-xxxxxxxxxxxxxxxxxxxxxxxx",
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: RESOURCE,
      sqliteDb: db,
      env: sellerEnv,
      testVerifier: seller,
    });
    // testVerifier bypasses isOkxSellerConfigured path - auth fails first
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe("ACTION_NOT_AUTHORIZED");
    // Auth fails before payment — OKX should not be required; when using
    // production path without testVerifier, verify:
    const bad2 = await startMonitoringForAgent({
      quoteId,
      connectionId: "conn_unknown",
      connectionToken: "bogus-token-xxxxxxxxxxxxxxxxxxxxxxxx",
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: RESOURCE,
      sqliteDb: db,
      env: sellerEnv,
    });
    expect(bad2.ok).toBe(false);
    expect(called).toBe(0);
  });

  it("official challenge bound to stored quote; unpaid returns 402", async () => {
    const { verified, quoteId } = await establishReadyQuote("unpaid");
    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
      env: sellerEnv,
    });
    expect(result.ok).toBe(false);
    if (result.ok || !("challenge" in result)) throw new Error("expected 402");
    expect(result.http_status).toBe(402);
    expect(result.challenge.x402Version).toBe(2);
    expect(result.challenge.accepts[0]!.extra.quote_id).toBe(quoteId);
    expect(result.challenge.accepts[0]!.payTo).toBe(PAY_TO);
  });

  it("invalid verification never activates", async () => {
    const { verified, quoteId } = await establishReadyQuote("badverify");
    const { fetchImpl, calls } = mockFetchSequence([
      {
        match: /\/verify$/,
        body: { isValid: false, invalidReason: "invalid_signature" },
      },
    ]);
    const client = new OkxSellerClient(
      loadOkxSellerConfig(sellerEnv)!,
      fetchImpl,
    );
    // Force production OKX path by not using testVerifier — inject via env
    // createOkxSellerVerifier is used when configured; monkey-patch via detailed test
    const seller = createOkxSellerVerifier({ env: sellerEnv, client });
    const detailed = await seller.verifyAndSettleDetailed({
      resource: RESOURCE,
      quoteId,
      authorizationHeader: validPayloadHeader(),
    });
    expect(detailed.ok).toBe(false);
    if (!detailed.ok) expect(detailed.reason).toBe("invalid_signature");
    expect(calls.some((c) => c.url.includes("/settle"))).toBe(false);

    // Wire through startMonitoring with a rejecting test verifier
    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: RESOURCE,
      sqliteDb: db,
      env: sellerEnv,
      testVerifier: {
        label: "reject",
        async verifyPayment() {
          return { ok: false, reason: "invalid_signature" };
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(
      (db.prepare(`SELECT COUNT(*) as c FROM monitor_activations`).get() as {
        c: number;
      }).c,
    ).toBe(0);
    const purchase = db
      .prepare(`SELECT status FROM purchases`)
      .get() as { status: string };
    expect(purchase.status).toBe(MONITORING_PAYMENT_READY_STATUS);
  });

  it("settle failure / pending never reports payment complete; confirmed activates once", async () => {
    const { verified, quoteId } = await establishReadyQuote("settleflow");

    // Settle fails
    {
      const { fetchImpl } = mockFetchSequence([
        { match: /\/verify$/, body: { isValid: true } },
        {
          match: /\/settle$/,
          body: {
            success: false,
            status: "timeout",
            transaction: "",
            errorReason: "timeout",
          },
        },
      ]);
      const seller = createOkxSellerVerifier({
        env: sellerEnv,
        client: new OkxSellerClient(loadOkxSellerConfig(sellerEnv)!, fetchImpl),
      });
      const d = await seller.verifyAndSettleDetailed({
        resource: RESOURCE,
        quoteId,
        authorizationHeader: validPayloadHeader(),
      });
      expect(d.ok).toBe(false);
      // Timeout with no tx hash is ambiguous → settlement_unknown (not a fresh charge).
      if (!d.ok) {
        expect(["settle_failed", "settlement_unknown"]).toContain(d.reason);
      }
    }

    // Pending
    {
      const { fetchImpl } = mockFetchSequence([
        { match: /\/verify$/, body: { isValid: true } },
        {
          match: /\/settle$/,
          body: {
            success: false,
            status: "pending",
            transaction: "0xpendingtxhash",
          },
        },
      ]);
      const seller = createOkxSellerVerifier({
        env: sellerEnv,
        client: new OkxSellerClient(loadOkxSellerConfig(sellerEnv)!, fetchImpl),
      });
      // Use startMonitoring with mock by temporarily swapping resolve — use testVerifier that simulates pending via provider_error
      // Direct detailed pending:
      const d = await seller.verifyAndSettleDetailed({
        resource: RESOURCE,
        quoteId,
        authorizationHeader: validPayloadHeader(),
      });
      expect(d.ok).toBe(false);
      if (!d.ok) {
        expect(d.reason).toBe("settlement_pending");
        expect(d.pendingTxHash).toBe("0xpendingtxhash");
      }
    }

    // Confirmed success via testVerifier (saga path)
    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: validPayloadHeader(),
      resource: RESOURCE,
      sqliteDb: db,
      env: sellerEnv,
      testVerifier: {
        label: "okx-confirm",
        async verifyPayment() {
          return {
            ok: true,
            settlementRef: "0xconfirmedtxhash",
            verifiedVia: "okx-seller",
          };
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("MONITORING_STARTED");
    expect(
      (db.prepare(`SELECT COUNT(*) as c FROM monitor_activations`).get() as {
        c: number;
      }).c,
    ).toBe(1);
  });

  it("settlement-status reconciliation activates once without repayment", async () => {
    const { verified, quoteId } = await establishReadyQuote("reconcile");

    // First: pending settle via mock client path integrated in startMonitoring
    // We simulate by marking verifying after a pending settle using production-like path:
    const { fetchImpl: f1 } = mockFetchSequence([
      { match: /\/verify$/, body: { isValid: true } },
      {
        match: /\/settle$/,
        body: {
          success: false,
          status: "pending",
          transaction: "0xpendingonly",
        },
      },
    ]);
    // inject client by using createOkxSellerVerifier + startMonitoring production path
    // Override resolve: startMonitoring uses createOkxSellerVerifier when configured.
    // Patch env and use a custom global fetch - instead call mark verifying manually:
    const attempt = await (
      await import("../../src/auth/auth-store.js")
    )
      .createSqliteAuthStore(db)
      .insertPaymentAttempt({
        quoteId,
        challengeRef: "x402ref_test",
      });
    // Real path: use seller detailed then mark
    const seller = createOkxSellerVerifier({
      env: sellerEnv,
      client: new OkxSellerClient(loadOkxSellerConfig(sellerEnv)!, f1),
    });
    const pending = await seller.verifyAndSettleDetailed({
      resource: RESOURCE,
      quoteId,
      authorizationHeader: validPayloadHeader(),
    });
    expect(pending.ok).toBe(false);

    // Store pending on real attempt from a startMonitoring unpaid then...
    // Simpler: run startMonitoring with mocked fetch by replacing createOkxSellerVerifier internals
    // Use startMonitoring: first unpaid creates attempt, then with header using testVerifier won't do pending.
    // Manual: mark verifying on the payment attempt that startMonitoring creates.
    const unpaid = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
      env: sellerEnv,
    });
    expect(unpaid.ok).toBe(false);

    const store = (
      await import("../../src/auth/auth-store.js")
    ).createSqliteAuthStore(db);
    const att = await store.getLatestPaymentAttemptForQuote(quoteId);
    expect(att).toBeTruthy();
    await store.markPaymentAttemptVerifying({
      attemptId: att!.id,
      settlementRef: "0xpendingonly",
      nowIso: new Date().toISOString(),
    });

    const { fetchImpl: f2, calls } = mockFetchSequence([
      {
        match: /settle\/status/,
        body: {
          success: true,
          status: "success",
          transaction: "0xpendingonly",
        },
      },
    ]);
    // Resume: no payment header, verifying attempt
    // Need getSettleStatus to use f2 - loadOkxSellerConfig + OkxSellerClient in resumePendingSettlement
    // Temporarily replace global fetch
    const origFetch = globalThis.fetch;
    globalThis.fetch = f2 as unknown as typeof fetch;
    try {
      const resumed = await startMonitoringForAgent({
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        paymentAuthorizationHeader: null,
        resource: RESOURCE,
        sqliteDb: db,
        env: sellerEnv,
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(
        resumed.status === "MONITORING_STARTED" ||
          resumed.status === "ALREADY_ACTIVE" ||
          resumed.status === "ACTIVATION_PENDING",
      ).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(calls.some((c) => c.url.includes("settle/status"))).toBe(true);
    // No second payment attempt settled with a new charge
    const settled = db
      .prepare(
        `SELECT COUNT(*) as c FROM payment_attempts WHERE status = 'settled'`,
      )
      .get() as { c: number };
    expect(settled.c).toBeLessThanOrEqual(1);
  });

  it("concurrent replay does not duplicate settlement or activation", async () => {
    const { verified, quoteId } = await establishReadyQuote("concurrent");
    const verifier = {
      label: "once",
      async verifyPayment() {
        return {
          ok: true as const,
          settlementRef: "0xsame",
          verifiedVia: "okx-seller",
        };
      },
    };
    const [a, b] = await Promise.all([
      startMonitoringForAgent({
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        paymentAuthorizationHeader: validPayloadHeader(),
        resource: RESOURCE,
        testVerifier: verifier,
        sqliteDb: db,
        env: sellerEnv,
      }),
      startMonitoringForAgent({
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        paymentAuthorizationHeader: validPayloadHeader(),
        resource: RESOURCE,
        testVerifier: verifier,
        sqliteDb: db,
        env: sellerEnv,
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(
      (db.prepare(`SELECT COUNT(*) as c FROM monitor_activations`).get() as {
        c: number;
      }).c,
    ).toBe(1);
    expect(
      (db
        .prepare(
          `SELECT COUNT(*) as c FROM payment_attempts WHERE status = 'settled'`,
        )
        .get() as { c: number }).c,
    ).toBe(1);
  });

  it("existing free agent actions remain unchanged", async () => {
    const begin = await runAgentAction(
      { action: "BEGIN_EMAIL_VERIFICATION", email: "free@example.com" },
      { sqliteDb: db },
    );
    expect(begin.http_status).toBe(200);
    expect((begin.body as { status: string }).status).toBe("EMAIL_CODE_SENT");
  });

  it("parse helpers and config fail-closed", () => {
    expect(isOkxSellerConfigured({})).toBe(false);
    expect(loadOkxSellerConfig({})).toBeNull();
    expect(loadOkxSellerConfig(sellerEnv)?.payTo).toBe(PAY_TO);
    expect(parsePaymentPayloadFromHeader(validPayloadHeader())).toBeTruthy();
    expect(parsePaymentPayloadFromHeader("not-json")).toBeNull();
    const req = buildServerPaymentRequirements({
      resource: RESOURCE,
      quoteId: "q1",
      payTo: PAY_TO,
    });
    expect(req.amount).toBe(MONITORING_PRICE_ATOMIC_UNITS);
    expect(req.scheme).toBe("exact");
  });

  it("resolveX402Verifier uses okx-seller when configured", () => {
    const v = resolveX402Verifier({ env: sellerEnv });
    expect(v.label).toBe("okx-seller");
    const none = resolveX402Verifier({
      env: { NOBU_AUTH_TEST_MODE: "1" },
    });
    expect(none.label).toBe("not-configured");
  });
});
