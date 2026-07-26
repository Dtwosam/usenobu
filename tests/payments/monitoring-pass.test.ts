/**
 * Lane 8R.3B — A2MCP first contact + Nobu Monitoring Pass.
 *
 * Covers the twelve focused proof points for the repair: the free service
 * answers first contact usefully, the paid service always challenges before
 * business execution, one verified settlement issues exactly one pass,
 * replays are idempotent, a failed redemption never consumes a pass, a valid
 * redemption activates exactly once, and projection recovery never charges
 * again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recentPurchaseDate } from "../helpers/test-dates.js";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { getAuthStore, resetAuthStoreCache } from "../../src/auth/auth-store.js";
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
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
} from "../../src/payments/monitoring-pass-service.js";
import { redeemMonitoringPassForAgent } from "../../src/payments/redeem-monitoring-pass.js";
import { reconcilePendingActivations } from "../../src/payments/start-monitoring-service.js";
import {
  encodeX402ChallengeHeader,
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_VERSION,
  type X402Verifier,
  type X402VerifyResult,
} from "../../src/payments/x402.js";
import {
  buildFreeServiceDescriptor,
  isFirstContactRequest,
  FREE_AGENT_ACTION_NAMES,
} from "../../src/a2mcp/service-descriptor.js";
import { runAgentAction } from "../../src/ai/agent-service.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import type { DiscoveryPurchaseFields } from "../../src/ai/schemas.js";

const PASS_RESOURCE = "https://usenobu.vercel.app/v1/agent/monitoring-pass";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-monitoring-pass-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
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

function acceptingVerifier(settlementRef: string): X402Verifier {
  return {
    label: "test-fake-accept",
    async verifyPayment(): Promise<X402VerifyResult> {
      return { ok: true, settlementRef, verifiedVia: "test-fake" };
    },
  };
}

function rejectingVerifier(): X402Verifier {
  return {
    label: "test-fake-reject",
    async verifyPayment(): Promise<X402VerifyResult> {
      return { ok: false, reason: "invalid_signature" };
    },
  };
}

describe("Lane 8R.3B A2MCP first contact + Monitoring Pass", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedAgentEmailCodes();
    resetAuthStoreCache();
    resetWebDatabaseCache();
    db = openDatabase(dbPath);
    migrateUp(db);
    // The durable auth schema is created lazily on first store use; force it
    // so pass/payment tables are queryable even in cases that never pay.
    await getAuthStore({ sqliteDb: db });
  });

  afterEach(() => {
    db.close();
    resetWebDatabaseCache();
    resetAuthStoreCache();
    clearCapturedAgentEmailCodes();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  function passCount(): number {
    return (
      db.prepare(`SELECT COUNT(*) as c FROM monitoring_passes`).get() as {
        c: number;
      }
    ).c;
  }

  function activationCount(): number {
    return (
      db.prepare(`SELECT COUNT(*) as c FROM monitor_activations`).get() as {
        c: number;
      }
    ).c;
  }

  function purchaseStatus(purchaseId: string): string {
    return (
      db.prepare(`SELECT status FROM purchases WHERE id = ?`).get(purchaseId) as {
        status: string;
      }
    ).status;
  }

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

  /** Buys a pass with a test-mode-gated fake settlement. */
  async function buyPass(settlementRef: string, header = "signed-header-a") {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      testVerifier: acceptingVerifier(settlementRef),
    });
    if (!result.ok || result.status !== "MONITORING_PASS_ISSUED") {
      throw new Error(`expected a pass, got ${result.status}`);
    }
    return result;
  }

  // ---------------------------------------------------------------------
  // 1-3. Free service first contact
  // ---------------------------------------------------------------------

  it("treats a bodyless call, {}, and common natural-language envelopes as first contact", () => {
    expect(isFirstContactRequest(null)).toBe(true);
    expect(isFirstContactRequest(undefined)).toBe(true);
    expect(isFirstContactRequest({})).toBe(true);
    expect(isFirstContactRequest({ message: "I would like to use agent 5541" })).toBe(true);
    expect(isFirstContactRequest({ query: "monitor my Target purchase" })).toBe(true);
    expect(isFirstContactRequest({ prompt: "help" })).toBe(true);
    expect(isFirstContactRequest({ action: "NOT_A_REAL_ACTION" })).toBe(true);
    expect(isFirstContactRequest("plain text")).toBe(true);
  });

  it("never treats a recognised action as first contact, so existing actions are unchanged", () => {
    for (const action of FREE_AGENT_ACTION_NAMES) {
      expect(isFirstContactRequest({ action })).toBe(false);
    }
  });

  it("descriptor is READY, self-describing, and lists every dispatcher action", () => {
    const d = buildFreeServiceDescriptor();
    expect(d.status).toBe("READY");
    expect(d.recommended_first_action).toBe("UNDERSTAND_PURCHASE");
    expect(d.example_request.action).toBe("UNDERSTAND_PURCHASE");
    expect(d.next_action.length).toBeGreaterThan(0);
    expect(d.documentation).toMatch(/^https:\/\//);
    // Every advertised action really is dispatchable, and each declares its
    // required fields — a caller can construct a valid request from this alone.
    for (const entry of d.supported_actions) {
      expect(FREE_AGENT_ACTION_NAMES).toContain(entry.action);
      expect(entry.required_fields[0]).toBe("action");
      expect(entry.required_fields.length).toBeGreaterThan(0);
    }
    expect(d.supported_actions.map((a) => a.action)).toContain(
      "REDEEM_MONITORING_PASS",
    );
  });

  it("descriptor is pure — it performs no AI, search, email, or database work", () => {
    // Building it with no database configured at all must still succeed.
    const saved = process.env.NOBU_DB_PATH;
    delete process.env.NOBU_DB_PATH;
    try {
      expect(buildFreeServiceDescriptor().status).toBe("READY");
    } finally {
      if (saved) process.env.NOBU_DB_PATH = saved;
    }
  });

  it("existing valid free actions still validate and dispatch unchanged", async () => {
    const bad = await runAgentAction(
      { action: "UNDERSTAND_PURCHASE" },
      { sqliteDb: db },
    );
    // A recognised action with missing fields is still a 400 — not a descriptor.
    expect(bad.http_status).toBe(400);
    expect((bad.body as { error?: string }).error).toBe("invalid_input");

    const ok = await runAgentAction(
      {
        action: "UNDERSTAND_PURCHASE",
        purchase_text: "Bought an Example Gadget at Target for $24.99 on 2026-07-10",
      },
      { sqliteDb: db, forceDeterministic: true },
    );
    expect(ok.http_status).toBe(200);
    expect((ok.body as { agent_state?: string }).agent_state).toBe(
      "CONFIRMATION_REQUIRED",
    );
  });

  // ---------------------------------------------------------------------
  // 4. Paid service always challenges before business execution
  // ---------------------------------------------------------------------

  it("first contact with no payment returns a valid x402 v2 challenge with no prerequisites", async () => {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: null,
      resource: PASS_RESOURCE,
      sqliteDb: db,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.http_status).toBe(402);
    expect(result.status).toBe("PAYMENT_PENDING");

    const c = result.challenge;
    expect(c.x402Version).toBe(X402_VERSION);
    expect(c.x402Version).toBe(2);
    expect(c.resource.url).toBe(PASS_RESOURCE);
    expect(c.resource.mimeType).toBe("application/json");
    expect(c.resource.description).toMatch(/Monitoring Pass/);
    const opt = c.accepts[0]!;
    expect(opt.scheme).toBe("exact");
    expect(opt.network).toBe(DEFAULT_SETTLEMENT_NETWORK);
    expect(opt.network).toBe("eip155:196");
    expect(opt.asset.toLowerCase()).toBe(DEFAULT_SETTLEMENT_ASSET.toLowerCase());
    expect(opt.amount).toBe(MONITORING_PRICE_ATOMIC_UNITS);
    expect(opt.amount).toBe("990000");
    expect(opt.maxTimeoutSeconds).toBeGreaterThan(0);
    expect(opt.extra.name).toBe("USD₮0");
    expect(opt.extra.version).toBe("2");
    // No quote binding — the pass is sold with no prerequisites.
    expect(opt.extra.quote_id).toBeUndefined();

    // The header value must be plain base64 of the challenge JSON, because
    // the official buyer decodes it with atob().
    const header = encodeX402ChallengeHeader(c);
    expect(header).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(JSON.parse(Buffer.from(header, "base64").toString("utf8"))).toEqual(c);

    // No prerequisite state was created just to issue a challenge.
    expect(passCount()).toBe(0);
  });

  it("the 402 body carries the challenge and a clear next step", async () => {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: null,
      resource: PASS_RESOURCE,
      sqliteDb: db,
    });
    const body = monitoringPassResponseBody(result);
    expect(body.status).toBe("PAYMENT_PENDING");
    expect(body.x402Version).toBe(2);
    expect(body.next_action).toMatch(/PAYMENT-SIGNATURE/);
  });

  // ---------------------------------------------------------------------
  // 5-7. Settlement and issuance idempotency
  // ---------------------------------------------------------------------

  it("a rejected payment issues no pass and re-challenges", async () => {
    const result = await monitoringPassForAgent({
      paymentAuthorizationHeader: "bogus-header",
      resource: PASS_RESOURCE,
      sqliteDb: db,
      testVerifier: rejectingVerifier(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.http_status).toBe(402);
    expect(passCount()).toBe(0);
  });

  it("a settled payment issues exactly one pass and returns the token once", async () => {
    const issued = await buyPass("settle_ref_pass_001");
    expect(issued.status).toBe("MONITORING_PASS_ISSUED");
    expect(issued.passToken).toBeTruthy();
    expect(passCount()).toBe(1);

    const body = monitoringPassResponseBody(issued);
    expect(body.agent_state).toBe("MONITORING_PASS");
    expect(body.status).toBe("MONITORING_PASS_ISSUED");
    expect(body.monitoring_pass_id).toBe(issued.pass.id);
    expect(body.monitoring_pass_token).toBe(issued.passToken);
    expect(body.price_amount).toBe(0.99);
    expect(body.price_currency).toBe("USD");
    expect(body.redeemable_for).toMatch(/REDEEM_MONITORING_PASS/);
    expect(body.next_action).toMatch(/PREFLIGHT_MONITORING/);
  });

  it("duplicate replay of the same payment returns the same pass and never a second token", async () => {
    const first = await buyPass("settle_ref_pass_002", "same-signed-header");
    const second = await monitoringPassForAgent({
      paymentAuthorizationHeader: "same-signed-header",
      resource: PASS_RESOURCE,
      sqliteDb: db,
      testVerifier: acceptingVerifier("settle_ref_pass_002"),
    });
    if (!second.ok || second.status !== "MONITORING_PASS_ISSUED") {
      throw new Error("expected the same pass");
    }
    expect(second.pass.id).toBe(first.pass.id);
    expect(second.passToken).toBeNull();
    expect(passCount()).toBe(1);
  });

  it("concurrent replay of the same settlement still yields exactly one pass", async () => {
    const [a, b] = await Promise.all([
      monitoringPassForAgent({
        paymentAuthorizationHeader: "concurrent-header",
        resource: PASS_RESOURCE,
        sqliteDb: db,
        testVerifier: acceptingVerifier("settle_ref_pass_003"),
      }),
      monitoringPassForAgent({
        paymentAuthorizationHeader: "concurrent-header",
        resource: PASS_RESOURCE,
        sqliteDb: db,
        testVerifier: acceptingVerifier("settle_ref_pass_003"),
      }),
    ]);
    expect(a.ok && a.status === "MONITORING_PASS_ISSUED").toBe(true);
    expect(b.ok && b.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (
      !a.ok || a.status !== "MONITORING_PASS_ISSUED" ||
      !b.ok || b.status !== "MONITORING_PASS_ISSUED"
    ) {
      throw new Error("unreachable");
    }
    expect(a.pass.id).toBe(b.pass.id);
    expect(passCount()).toBe(1);
    // Exactly one caller ever learns the one-time token.
    expect([a.passToken, b.passToken].filter(Boolean).length).toBe(1);
  });

  it("a different settlement issues a genuinely different pass", async () => {
    const first = await buyPass("settle_ref_pass_004", "header-one");
    const second = await buyPass("settle_ref_pass_005", "header-two");
    expect(second.pass.id).not.toBe(first.pass.id);
    expect(passCount()).toBe(2);
  });

  // ---------------------------------------------------------------------
  // 8-9. Redemption gates and exactly-once activation
  // ---------------------------------------------------------------------

  it("invalid redemption attempts never consume the pass", async () => {
    const issued = await buyPass("settle_ref_pass_006");
    const { verified, quoteId } = await establishReadyQuote("redeemgates");

    const wrongToken = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: "not-the-real-token",
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(wrongToken.ok).toBe(false);
    expect(wrongToken.status).toBe("ACTION_NOT_AUTHORIZED");

    const wrongConnectionToken = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: "not-the-real-connection-token",
      sqliteDb: db,
    });
    expect(wrongConnectionToken.ok).toBe(false);
    expect(wrongConnectionToken.status).toBe("ACTION_NOT_AUTHORIZED");

    const unknownQuote = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId: "quote_does_not_exist",
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(unknownQuote.ok).toBe(false);
    expect(unknownQuote.status).toBe("ACTION_NOT_AUTHORIZED");

    // The pass is still unused and still redeemable.
    const row = db
      .prepare(`SELECT status FROM monitoring_passes WHERE id = ?`)
      .get(issued.pass.id) as { status: string };
    expect(row.status).toBe("issued");
    expect(activationCount()).toBe(0);
  });

  it("an expired quote fails closed without consuming the pass", async () => {
    const issued = await buyPass("settle_ref_pass_007");
    const { verified, quoteId } = await establishReadyQuote("expiredquote");
    db.prepare(
      `UPDATE monitoring_enrollment_quotes SET expires_at = ? WHERE id = ?`,
    ).run(new Date(Date.now() - 60_000).toISOString(), quoteId);

    const result = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("CONNECTION_EXPIRED");
    const row = db
      .prepare(`SELECT status FROM monitoring_passes WHERE id = ?`)
      .get(issued.pass.id) as { status: string };
    expect(row.status).toBe("issued");
    expect(activationCount()).toBe(0);
  });

  it("a valid redemption consumes the pass exactly once and activates exactly one monitor", async () => {
    const issued = await buyPass("settle_ref_pass_008");
    const { verified, quoteId } = await establishReadyQuote("redeemok");

    const result = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.status).toBe("MONITORING_STARTED");
    expect(activationCount()).toBe(1);
    expect(purchaseStatus(result.monitor_id)).toBe("MONITORING_ACTIVE");

    const row = db
      .prepare(`SELECT status, redeemed_quote_id FROM monitoring_passes WHERE id = ?`)
      .get(issued.pass.id) as { status: string; redeemed_quote_id: string };
    expect(row.status).toBe("redeemed");
    expect(row.redeemed_quote_id).toBe(quoteId);

    // A genuine replay resolves to the same monitor and creates nothing new.
    const replay = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("unreachable");
    expect(replay.status).toBe("ALREADY_ACTIVE");
    expect(replay.monitor_id).toBe(result.monitor_id);
    expect(activationCount()).toBe(1);
  });

  it("a redeemed pass cannot be reused for a second purchase", async () => {
    const issued = await buyPass("settle_ref_pass_009");
    const first = await establishReadyQuote("reuse-one");
    const redeemed = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId: first.quoteId,
      connectionId: first.verified.connection_id,
      connectionToken: first.verified.connection_token,
      sqliteDb: db,
    });
    expect(redeemed.ok).toBe(true);

    const second = await establishReadyQuote("reuse-two");
    const reuse = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId: second.quoteId,
      connectionId: second.verified.connection_id,
      connectionToken: second.verified.connection_token,
      sqliteDb: db,
    });
    expect(reuse.ok).toBe(false);
    expect(reuse.status).toBe("PASS_NOT_REDEEMABLE");
    expect(activationCount()).toBe(1);
    // The second quote was never consumed by the rejected attempt.
    const q = db
      .prepare(`SELECT status FROM monitoring_enrollment_quotes WHERE id = ?`)
      .get(second.quoteId) as { status: string };
    expect(q.status).toBe("issued");
  });

  it("concurrent redemption of one pass activates exactly once", async () => {
    const issued = await buyPass("settle_ref_pass_010");
    const { verified, quoteId } = await establishReadyQuote("concurrentredeem");

    const [a, b] = await Promise.all([
      redeemMonitoringPassForAgent({
        monitoringPassId: issued.pass.id,
        monitoringPassToken: issued.passToken!,
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        sqliteDb: db,
      }),
      redeemMonitoringPassForAgent({
        monitoringPassId: issued.pass.id,
        monitoringPassToken: issued.passToken!,
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        sqliteDb: db,
      }),
    ]);
    const successes = [a, b].filter((r) => r.ok);
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(activationCount()).toBe(1);
  });

  // ---------------------------------------------------------------------
  // 10. Projection recovery never re-charges
  // ---------------------------------------------------------------------

  it("a stuck projection recovers later without any new payment or pass", async () => {
    const issued = await buyPass("settle_ref_pass_011");
    const { verified, quoteId } = await establishReadyQuote("projection");

    const purchaseId = (
      db
        .prepare(`SELECT purchase_id FROM monitoring_enrollment_quotes WHERE id = ?`)
        .get(quoteId) as { purchase_id: string }
    ).purchase_id;

    const result = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      monitoringPassToken: issued.passToken!,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(result.ok).toBe(true);

    // Simulate a projection that never completed.
    db.prepare(
      `UPDATE monitor_activations SET status = 'pending_projection', projected_at = NULL
       WHERE quote_id = ?`,
    ).run(quoteId);
    db.prepare(`UPDATE purchases SET status = ? WHERE id = ?`).run(
      MONITORING_PAYMENT_READY_STATUS,
      purchaseId,
    );

    const reconciled = await reconcilePendingActivations({ sqliteDb: db });
    expect(reconciled.activated).toBe(1);
    expect(purchaseStatus(purchaseId)).toBe("MONITORING_ACTIVE");
    // No second pass, no second activation, no second payment.
    expect(passCount()).toBe(1);
    expect(activationCount()).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM monitoring_pass_payments`)
          .get() as { c: number }
      ).c,
    ).toBe(1);
  });

  // ---------------------------------------------------------------------
  // 11. No sensitive data leakage
  // ---------------------------------------------------------------------

  it("never persists or returns the raw payment header, and stores only a token hash", async () => {
    const header = "PAYMENT-SIGNATURE-RAW-VALUE-THAT-MUST-NEVER-PERSIST";
    const issued = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      testVerifier: acceptingVerifier("settle_ref_pass_012"),
    });
    if (!issued.ok || issued.status !== "MONITORING_PASS_ISSUED") {
      throw new Error("expected a pass");
    }

    const paymentRows = JSON.stringify(
      db.prepare(`SELECT * FROM monitoring_pass_payments`).all(),
    );
    const passRows = JSON.stringify(
      db.prepare(`SELECT * FROM monitoring_passes`).all(),
    );
    expect(paymentRows).not.toContain(header);
    expect(passRows).not.toContain(header);
    // The one-time token is never stored in plaintext either.
    expect(passRows).not.toContain(issued.passToken!);

    // Nor does the response echo the settlement reference or any digest.
    const body = JSON.stringify(monitoringPassResponseBody(issued));
    expect(body).not.toContain("settle_ref_pass_012");
    expect(body).not.toContain(header);
  });

  it("a failed redemption response never reveals which gate failed", async () => {
    const issued = await buyPass("settle_ref_pass_013");
    const { verified, quoteId } = await establishReadyQuote("reasonagnostic");

    const wrongToken = await runAgentAction(
      {
        action: "REDEEM_MONITORING_PASS",
        monitoring_pass_id: issued.pass.id,
        monitoring_pass_token: "wrong",
        quote_id: quoteId,
        connection_id: verified.connection_id,
        connection_token: verified.connection_token,
      },
      { sqliteDb: db },
    );
    const unknownPass = await runAgentAction(
      {
        action: "REDEEM_MONITORING_PASS",
        monitoring_pass_id: "pass_does_not_exist",
        monitoring_pass_token: issued.passToken!,
        quote_id: quoteId,
        connection_id: verified.connection_id,
        connection_token: verified.connection_token,
      },
      { sqliteDb: db },
    );
    expect(wrongToken.http_status).toBe(401);
    expect(unknownPass.http_status).toBe(401);
    // Byte-identical bodies: an attacker cannot distinguish the two cases.
    expect(JSON.stringify(wrongToken.body)).toBe(
      JSON.stringify(unknownPass.body),
    );
  });
});
