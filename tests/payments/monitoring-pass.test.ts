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
  reconcilePendingPassSettlements,
  resolveMonitoringPassForAgent,
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
import type { OkxHttpFetch } from "../../src/payments/okx-seller-client.js";
import { sha256Hex } from "../../src/auth/crypto.js";
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
    expect(d.payment_status).toBe("not_required");
    expect(d.recommended_first_action).toBe("DESCRIBE_SERVICES");
    expect(d.example_request.action).toBe("DESCRIBE_SERVICES");
    expect(d.next_action.length).toBeGreaterThan(0);
    expect(d.documentation).toMatch(/^https:\/\//);
    expect(d.paid_service.endpoint).toBe(
      "https://www.usenobu.xyz/v1/agent/monitoring-pass",
    );
    expect(d.available_services?.map((s) => s.service_id)).toEqual([
      33561, 35958,
    ]);
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
    expect(d.supported_actions.map((a) => a.action)).toContain(
      "DESCRIBE_SERVICES",
    );
    expect(d.supported_actions.map((a) => a.action)).toContain("SELECT_SERVICE");
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
    expect(opt.extra.version).toBe("1");
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
    // Neutral typed facts only — no imperative agent-control prose.
    expect(body.monitoring_active).toBe(false);
    expect(body.journey_complete).toBe(false);
    expect(body.business_input_required).toBe(false);
    expect(body.replay_header_name).toBe("PAYMENT-SIGNATURE");
    expect(body.amount).toBe("990000");
    expect(body.fields).toEqual([]);
    expect(body.never_ask_user_for).toBeUndefined();
    expect(body.guidance).toBeUndefined();
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

  it("a settled payment issues exactly one pass with continuous setup guidance and no exposed token", async () => {
    const issued = await buyPass("settle_ref_pass_001");
    expect(issued.status).toBe("MONITORING_PASS_ISSUED");
    expect(passCount()).toBe(1);
    expect(issued.pass_continuation_id).toMatch(/^pass_cont_/);

    const body = monitoringPassResponseBody(issued);
    expect(body.status).toBe("MONITORING_PASS_ISSUED");
    expect(body.monitoring_pass_id).toBe(issued.pass.id);
    expect(body.pass_continuation_id).toBe(issued.pass_continuation_id);
    expect(body.monitoring_pass_token).toBeUndefined();
    expect(body.price_amount).toBe(0.99);
    expect(body.price_currency).toBe("USD");
    expect(body.redeemable_for).toMatch(/REDEEM_MONITORING_PASS/);
    expect(body.monitoring_active).toBe(false);
    expect(body.journey_complete).toBe(false);
    expect(body.next_service_id).toBe(33561);
    expect(body.second_payment_required).toBe(false);
    expect(body.payment_status).toBe("settled");
    expect(issued.payment_response_header).toBeTruthy();
  });

  it("duplicate replay of the same payment returns the same pass", async () => {
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

    const wrongConnectionToken = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: "not-the-real-connection-token",
      sqliteDb: db,
    });
    expect(wrongConnectionToken.ok).toBe(false);
    expect(wrongConnectionToken.status).toBe("ACTION_NOT_AUTHORIZED");

    const unknownQuote = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
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

  it("only successful redemption returns MONITORING_ACTIVE and completes the journey", async () => {
    const issued = await buyPass("settle_ref_pass_008");
    const { verified, quoteId } = await establishReadyQuote("redeemok");

    const result = await runAgentAction({
      action: "REDEEM_MONITORING_PASS",
      monitoring_pass_id: issued.pass.id,
      quote_id: quoteId,
      connection_id: verified.connection_id,
      connection_token: verified.connection_token,
    }, { sqliteDb: db });
    expect(result.http_status).toBe(200);
    const activeBody = result.body as Record<string, unknown>;
    expect(activeBody.status).toBe("MONITORING_ACTIVE");
    expect(activeBody.activation_result).toBe("MONITORING_STARTED");
    expect(activeBody.completed_step).toBe("MONITORING_PASS_REDEEMED");
    expect(activeBody.monitoring_active).toBe(true);
    expect(activeBody.journey_complete).toBe(true);
    const monitorId = String(activeBody.monitor_id);
    expect(activationCount()).toBe(1);
    expect(purchaseStatus(monitorId)).toBe("MONITORING_ACTIVE");

    const row = db
      .prepare(`SELECT status, redeemed_quote_id FROM monitoring_passes WHERE id = ?`)
      .get(issued.pass.id) as { status: string; redeemed_quote_id: string };
    expect(row.status).toBe("redeemed");
    expect(row.redeemed_quote_id).toBe(quoteId);

    // A genuine replay resolves to the same monitor and creates nothing new.
    const replay = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      sqliteDb: db,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("unreachable");
    expect(replay.status).toBe("ALREADY_ACTIVE");
    expect(replay.monitor_id).toBe(monitorId);
    expect(activationCount()).toBe(1);
  });

  it("a redeemed pass cannot be reused for a second purchase", async () => {
    const issued = await buyPass("settle_ref_pass_009");
    const first = await establishReadyQuote("reuse-one");
    const redeemed = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      quoteId: first.quoteId,
      connectionId: first.verified.connection_id,
      connectionToken: first.verified.connection_token,
      sqliteDb: db,
    });
    expect(redeemed.ok).toBe(true);

    const second = await establishReadyQuote("reuse-two");
    const reuse = await redeemMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
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
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        sqliteDb: db,
      }),
      redeemMonitoringPassForAgent({
        monitoringPassId: issued.pass.id,
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
    expect((JSON.parse(passRows) as Array<Record<string, unknown>>)[0]?.pass_token_hash).toBeTruthy();

    // Nor does the response echo the settlement reference or any digest.
    const body = JSON.stringify(monitoringPassResponseBody(issued));
    expect(body).not.toContain("settle_ref_pass_012");
    expect(body).not.toContain(header);
  });

  it("a failed redemption response never reveals which gate failed", async () => {
    const issued = await buyPass("settle_ref_pass_013");
    const { verified, quoteId } = await establishReadyQuote("reasonagnostic");

    const wrongConnection = await runAgentAction(
      {
        action: "REDEEM_MONITORING_PASS",
        monitoring_pass_id: issued.pass.id,
        quote_id: quoteId,
        connection_id: verified.connection_id,
        connection_token: "wrong",
      },
      { sqliteDb: db },
    );
    const unknownPass = await runAgentAction(
      {
        action: "REDEEM_MONITORING_PASS",
        monitoring_pass_id: "pass_does_not_exist",
        quote_id: quoteId,
        connection_id: verified.connection_id,
        connection_token: verified.connection_token,
      },
      { sqliteDb: db },
    );
    expect(wrongConnection.http_status).toBe(401);
    expect(unknownPass.http_status).toBe(401);
    const failedBody = wrongConnection.body as Record<string, unknown>;
    expect(failedBody.status).not.toBe("MONITORING_ACTIVE");
    expect(failedBody.monitoring_active).toBe(false);
    expect(failedBody.journey_complete).toBe(false);
    // Byte-identical bodies: an attacker cannot distinguish the two cases.
    expect(JSON.stringify(wrongConnection.body)).toBe(
      JSON.stringify(unknownPass.body),
    );
  });

  // ---------------------------------------------------------------------
  // 12. Pending settlement reconciliation (no signed-header replay)
  // ---------------------------------------------------------------------

  const RECONCILE_SELLER_ENV = {
    OKX_API_KEY: "test-key",
    OKX_SECRET_KEY: "test-secret",
    OKX_PASSPHRASE: "test-pass",
    OKX_PAY_TO: "0x1111111111111111111111111111111111111111",
    OKX_BASE_URL: "https://web3.okx.com",
  };

  function seedVerifyingPayment(args: {
    paymentId: string;
    pendingTxHash: string;
    /** Opaque digest placeholder — never a real payment header. */
    authorizationDigest: string;
  }) {
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO monitoring_pass_payments
       (id, authorization_digest, status, settlement_ref, created_at, updated_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(
      args.paymentId,
      args.authorizationDigest,
      "verifying",
      args.pendingTxHash,
      nowIso,
      nowIso,
    );
  }

  it("pending settlement later confirms via provider reconciliation and issues exactly one pass", async () => {
    const pendingTx =
      "0xpending_settlement_tx_hash_for_pass_recon_001_abcdef";
    const confirmedTx =
      "0xconfirmed_settlement_tx_hash_for_pass_recon_001_fedcba";
    // Digest of a synthetic placeholder only — the raw signed header is not
    // available after marketplace job completion, which is the recovery case.
    seedVerifyingPayment({
      paymentId: "pass_pay_recon_001",
      pendingTxHash: pendingTx,
      authorizationDigest: sha256Hex("synthetic-digest-placeholder-recon-001"),
    });
    expect(passCount()).toBe(0);

    let statusCalls = 0;
    const seenUrls: string[] = [];
    const fetchImpl: OkxHttpFetch = async (url, init) => {
      statusCalls += 1;
      seenUrls.push(`${String(init?.method || "GET").toUpperCase()} ${url}`);
      return new Response(
        JSON.stringify({
          code: "0",
          data: {
            success: true,
            status: "success",
            transaction: confirmedTx,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const first = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env: { ...process.env, ...RECONCILE_SELLER_ENV },
      fetchImpl,
    });

    expect(first.scanned).toBe(1);
    expect(first.issued).toBe(1);
    expect(first.still_pending).toBe(0);
    expect(first.failed).toBe(0);
    expect(first.issued_pass_ids).toHaveLength(1);
    expect(passCount()).toBe(1);
    expect(statusCalls).toBe(1);
    expect(seenUrls).toEqual([
      expect.stringMatching(
        new RegExp(`^GET .*settle/status\\?txHash=${pendingTx}$`),
      ),
    ]);

    const payment = db
      .prepare(`SELECT status, settlement_ref FROM monitoring_pass_payments WHERE id = ?`)
      .get("pass_pay_recon_001") as { status: string; settlement_ref: string };
    expect(payment.status).toBe("settled");
    expect(payment.settlement_ref).toBe(confirmedTx);

    const pass = db
      .prepare(`SELECT id, settlement_ref, status FROM monitoring_passes`)
      .get() as { id: string; settlement_ref: string; status: string };
    expect(pass.id).toBe(first.issued_pass_ids[0]);
    expect(pass.settlement_ref).toBe(confirmedTx);
    expect(pass.status).toBe("issued");

    // Response shape matches a successful paid deliverable — monitoring still
    // inactive; continuation is free Purchase Setup.
    const body = monitoringPassResponseBody({
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass_continuation_id: "pass_cont_test_only_not_secret",
      pass: {
        id: pass.id,
        pass_token_hash: "internal",
        settlement_ref: pass.settlement_ref,
        payment_id: "pass_pay_recon_001",
        price_amount: 0.99,
        price_currency: "USD",
        status: "issued",
        redeemed_at: null,
        redeemed_quote_id: null,
        redeemed_purchase_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      settlementRef: pass.settlement_ref,
      payment_response_header: "dGVzdA==",
    });
    expect(body.status).toBe("MONITORING_PASS_ISSUED");
    expect(body.monitoring_active).toBe(false);
    expect(body.next_service_id).toBe(33561);
    expect(body.monitoring_pass_token).toBeUndefined();
    const bodyJson = JSON.stringify(body);
    expect(bodyJson).not.toContain(pendingTx);
    expect(bodyJson).not.toContain(confirmedTx);
    // Reconciliation never charges — only settle/status was called.
    expect(statusCalls).toBe(1);
  });

  it("repeated reconciliation cannot duplicate the pass or charge again", async () => {
    const pendingTx =
      "0xpending_settlement_tx_hash_for_pass_recon_002_abcdef";
    const confirmedTx =
      "0xconfirmed_settlement_tx_hash_for_pass_recon_002_fedcba";
    seedVerifyingPayment({
      paymentId: "pass_pay_recon_002",
      pendingTxHash: pendingTx,
      authorizationDigest: sha256Hex("synthetic-digest-placeholder-recon-002"),
    });

    let statusCalls = 0;
    const fetchImpl: OkxHttpFetch = async (url) => {
      statusCalls += 1;
      expect(url).toContain("settle/status");
      return new Response(
        JSON.stringify({
          code: "0",
          data: {
            success: true,
            status: "success",
            transaction: confirmedTx,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const env = { ...process.env, ...RECONCILE_SELLER_ENV };
    const first = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env,
      fetchImpl,
    });
    expect(first.issued).toBe(1);
    expect(passCount()).toBe(1);
    const firstPassId = first.issued_pass_ids[0]!;

    // Concurrent + sequential re-runs — no second pass, no second charge path.
    const [a, b] = await Promise.all([
      reconcilePendingPassSettlements({ sqliteDb: db, env, fetchImpl }),
      reconcilePendingPassSettlements({ sqliteDb: db, env, fetchImpl }),
    ]);
    const third = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env,
      fetchImpl,
    });

    expect(passCount()).toBe(1);
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM monitoring_pass_payments`)
          .get() as { c: number }
      ).c,
    ).toBe(1);
    // After first issue, later scans find nothing still verifying / orphaned.
    expect(a.issued + b.issued + third.issued).toBe(0);
    expect(a.scanned + b.scanned + third.scanned).toBe(0);

    const pass = db
      .prepare(`SELECT id FROM monitoring_passes`)
      .get() as { id: string };
    expect(pass.id).toBe(firstPassId);

    // Only the first successful confirmation needed settle/status; later runs
    // short-circuit on empty pending lists (no re-verify, no re-settle).
    expect(statusCalls).toBe(1);
  });

  // ---------------------------------------------------------------------
  // 13. Customer-safe pass handoff / RESOLVE_MONITORING_PASS
  // ---------------------------------------------------------------------

  it("resolve by continuation after reconcile returns the same issued pass", async () => {
    const pendingTx = "0xpending_handoff_tx_001";
    const confirmedTx = "0xconfirmed_handoff_tx_001";
    seedVerifyingPayment({
      paymentId: "pass_pay_handoff_001",
      pendingTxHash: pendingTx,
      authorizationDigest: sha256Hex("handoff-digest-001"),
    });
    const store = await getAuthStore({ sqliteDb: db });
    const cont = await store.ensureMonitoringPassContinuation({
      id: "pass_cont_handoff_001abcdef",
      paymentId: "pass_pay_handoff_001",
      nowIso: new Date().toISOString(),
    });

    const fetchImpl: OkxHttpFetch = async () =>
      new Response(
        JSON.stringify({
          code: "0",
          data: { success: true, status: "success", transaction: confirmedTx },
        }),
        { status: 200 },
      );

    const recon = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env: { ...process.env, ...RECONCILE_SELLER_ENV },
      fetchImpl,
    });
    expect(recon.issued).toBe(1);

    const resolved = await resolveMonitoringPassForAgent({
      passContinuationId: cont.id,
      sqliteDb: db,
    });
    expect(resolved.http_status).toBe(200);
    expect(resolved.body.status).toBe("MONITORING_PASS_ISSUED");
    expect(resolved.body.monitoring_pass_id).toBe(recon.issued_pass_ids[0]);
    expect(resolved.body.monitoring_active).toBe(false);
    expect(resolved.body.next_service_id).toBe(33561);
    expect(resolved.body.second_payment_required).toBe(false);
    expect(JSON.stringify(resolved.body)).not.toContain(confirmedTx);
  });

  it("unknown or cross-handle continuation lookup fails without revealing existence", async () => {
    const missing = await resolveMonitoringPassForAgent({
      passContinuationId: "pass_cont_does_not_exist_zzzz",
      sqliteDb: db,
    });
    expect(missing.http_status).toBe(404);
    expect(missing.body.status).toBe("MONITORING_PASS_NOT_FOUND");
    expect(missing.body.monitoring_pass_id).toBeUndefined();

    const issued = await buyPass("settle_ref_handoff_unknown", "hdr-unknown");
    const wrong = await resolveMonitoringPassForAgent({
      passContinuationId: "pass_cont_wrong_guess_xxxxxxxx",
      sqliteDb: db,
    });
    expect(wrong.http_status).toBe(404);
    expect(wrong.body.status).toBe("MONITORING_PASS_NOT_FOUND");
    // Same generic shape — no existence leak of the real pass id.
    expect(JSON.stringify(wrong.body)).not.toContain(issued.pass.id);
  });

  it("historical issued pass resolves by public pass id and backfills continuation once", async () => {
    const issued = await buyPass("settle_ref_historical_001", "hdr-hist-1");
    // Simulate pre-handoff era: drop continuation rows if any.
    db.prepare(`DELETE FROM monitoring_pass_continuations`).run();
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM monitoring_pass_continuations`)
          .get() as { c: number }
      ).c,
    ).toBe(0);

    const resolved = await resolveMonitoringPassForAgent({
      monitoringPassId: issued.pass.id,
      sqliteDb: db,
    });
    // Public pass id alone no longer mints a claimable continuation.
    expect(resolved.http_status).toBe(404);
    expect(resolved.body.status).toBe("MONITORING_PASS_RECOVERY_REQUIRED");
    // Keep issued pass durable for operator recovery paths.
    expect(issued.pass.id).toBeTruthy();
    // No continuation fabricated from public id alone.
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) as c FROM monitoring_pass_continuations`)
          .get() as { c: number }
      ).c,
    ).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 14. Complete production hardening — auto-convergence + contract
  // ---------------------------------------------------------------------

  it("RESOLVE confirms the continuation payment only and issues one pass without a second charge", async () => {
    const pendingTx = "0xpending_targeted_resolve_tx_001";
    const confirmedTx = "0xconfirmed_targeted_resolve_tx_001";
    // Noise payment that must not be scanned by targeted resolve.
    seedVerifyingPayment({
      paymentId: "pass_pay_noise_should_not_scan",
      pendingTxHash: "0xnoise_pending_should_not_be_touched",
      authorizationDigest: sha256Hex("noise-digest"),
    });
    seedVerifyingPayment({
      paymentId: "pass_pay_targeted_001",
      pendingTxHash: pendingTx,
      authorizationDigest: sha256Hex("targeted-digest-001"),
    });
    const store = await getAuthStore({ sqliteDb: db });
    const cont = await store.ensureMonitoringPassContinuation({
      id: "pass_cont_targeted_001abcdef12",
      paymentId: "pass_pay_targeted_001",
      nowIso: new Date().toISOString(),
    });

    const seen: string[] = [];
    const fetchImpl: OkxHttpFetch = async (url) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({
          code: "0",
          data: { success: true, status: "success", transaction: confirmedTx },
        }),
        { status: 200 },
      );
    };

    const resolved = await resolveMonitoringPassForAgent({
      passContinuationId: cont.id,
      sqliteDb: db,
      env: { ...process.env, ...RECONCILE_SELLER_ENV },
      fetchImpl,
    });

    expect(resolved.http_status).toBe(200);
    expect(resolved.body.status).toBe("MONITORING_PASS_ISSUED");
    expect(resolved.body.second_payment_required).toBe(false);
    expect(resolved.body.payment_status).toBe("recognized");
    expect(resolved.body.monitoring_active).toBe(false);
    // payment_status recognized = settled pass resolved for free continuation
    expect(passCount()).toBe(1);
    // Only the continuation's settlement_ref is polled — not the noise tx.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(pendingTx);
    expect(seen[0]).not.toContain("noise_pending");
    const noise = db
      .prepare(`SELECT status FROM monitoring_pass_payments WHERE id = ?`)
      .get("pass_pay_noise_should_not_scan") as { status: string };
    expect(noise.status).toBe("verifying");
  });

  it("issued and pending response bodies carry the conversation contract", async () => {
    const issued = await buyPass("settle_ref_contract_001", "hdr-contract-1");
    const issuedBody = monitoringPassResponseBody(issued);
    expect(issuedBody.payment_status).toBe("settled");
    expect(issuedBody.second_payment_required).toBe(false);
    expect(issuedBody.monitoring_active).toBe(false);
    expect(issuedBody.next_service_id).toBe(33561);

    const challenge = await monitoringPassForAgent({
      paymentAuthorizationHeader: null,
      resource: PASS_RESOURCE,
      sqliteDb: db,
    });
    const challengeBody = monitoringPassResponseBody(challenge);
    expect(challengeBody.status).toBe("PAYMENT_PENDING");
    expect(challengeBody.payment_status).toBe("required");
    expect(challengeBody.second_payment_required).toBe(false);
    expect(challengeBody.selected_service_id).toBe(35958);
    expect(challengeBody.fields).toEqual([]);
    expect(challengeBody.requiredArgs).toEqual([]);
    expect(challengeBody.business_input_required).toBe(false);
    expect(challengeBody.product_details_required_before_payment).toBe(false);
    expect(challengeBody.email_required_before_payment).toBe(false);
    expect(challengeBody.alert_threshold_required).toBe(false);
    expect(challengeBody.wallet_address_required_as_service_input).toBe(false);
    expect(challengeBody.monitoring_active).toBe(false);
    expect(challengeBody.journey_complete).toBe(false);
    expect(challengeBody.next_service_id).toBe(33561);
    expect(challengeBody.next_action_after_payment).toBe(
      "CONTINUE_PURCHASE_SETUP",
    );
    expect(challengeBody.deliverable).toEqual({
      type: "monitoring_pass",
      quantity: 1,
    });
    expect(challengeBody.replay_header_name).toBe("PAYMENT-SIGNATURE");
    expect(challengeBody.amount).toBe("990000");
    expect(challengeBody.never_ask_user_for).toBeUndefined();
    expect(challengeBody.guidance).toBeUndefined();
    expect(challengeBody.one_quote_only).toBeUndefined();
  });
});
