/**
 * Lane 7.4D — $0.99 paid monitoring activation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import {
  reconcilePendingActivations,
  startMonitoringForAgent,
} from "../../src/payments/start-monitoring-service.js";
import type { X402Verifier, X402VerifyResult } from "../../src/payments/x402.js";
import { runAgentAction } from "../../src/ai/agent-service.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import type { DiscoveryPurchaseFields } from "../../src/ai/schemas.js";

const RESOURCE = "https://usenobu.vercel.app/v1/agent/start-monitoring";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-start-monitoring-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
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
  purchase_date: "2026-07-10",
  purchase_channel: "target_online",
  country: "US",
  region: "TX",
  target_product_url: "https://www.target.com/p/example-gadget/-/A-87654321",
  target_item_id: "87654321",
};

function acceptingVerifier(settlementRef = "settle_ref_fake_test_001"): X402Verifier {
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

describe("Lane 7.4D $0.99 paid monitoring activation", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
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
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  function purchaseStatus(purchaseId: string): string {
    return (
      db.prepare(`SELECT status FROM purchases WHERE id = ?`).get(purchaseId) as {
        status: string;
      }
    ).status;
  }

  function paymentAttemptCount(): number {
    return (
      db.prepare(`SELECT COUNT(*) as c FROM payment_attempts`).get() as {
        c: number;
      }
    ).c;
  }

  function settledPaymentAttemptCount(): number {
    return (
      db
        .prepare(`SELECT COUNT(*) as c FROM payment_attempts WHERE status = 'settled'`)
        .get() as { c: number }
    ).c;
  }

  function activationCount(): number {
    return (
      db.prepare(`SELECT COUNT(*) as c FROM monitor_activations`).get() as {
        c: number;
      }
    ).c;
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

  /** Full path to a MONITORING_PAYMENT_READY quote, ready for start-monitoring. */
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

  it("invalid auth/quote receives no payment challenge", async () => {
    const { quoteId } = await establishReadyQuote("badauth");

    const badToken = await startMonitoringForAgent({
      quoteId,
      connectionId: "conn_unknown",
      connectionToken: "bogus-token-xxxxxxxxxxxxxxxxxxxxxxxx",
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
    });
    expect(badToken.ok).toBe(false);
    if (!badToken.ok) {
      expect(badToken.status).toBe("ACTION_NOT_AUTHORIZED");
      expect(badToken.http_status).toBe(401);
      expect("challenge" in badToken).toBe(false);
    }

    // Valid connection, but a quote that belongs to someone else.
    const otherVerified = await establishConnection("otherowner@example.com");
    const crossOwner = await startMonitoringForAgent({
      quoteId,
      connectionId: otherVerified.connection_id,
      connectionToken: otherVerified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
    });
    expect(crossOwner.ok).toBe(false);
    if (!crossOwner.ok) {
      expect(crossOwner.status).toBe("ACTION_NOT_AUTHORIZED");
      expect("challenge" in crossOwner).toBe(false);
    }

    expect(paymentAttemptCount()).toBe(0);
    expect(activationCount()).toBe(0);
  });

  it("unpaid request receives a correctly bound 402 challenge", async () => {
    const { verified, quoteId } = await establishReadyQuote("unpaid");

    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
    });

    expect(result.ok).toBe(false);
    if (result.ok || !("challenge" in result)) throw new Error("expected a 402 challenge");
    expect(result.http_status).toBe(402);
    expect(result.challenge.resource).toBe(RESOURCE);
    expect(result.challenge.accepts[0]!.extra.quote_id).toBe(quoteId);
    expect(result.challenge.accepts[0]!.amount).toBe("990000");
    expect(result.challengeHeaderValue.length).toBeGreaterThan(0);

    expect(paymentAttemptCount()).toBe(1);
    expect(activationCount()).toBe(0);
  });

  it("invalid/altered payment never activates monitoring", async () => {
    const { verified, quoteId } = await establishReadyQuote("badpayment");

    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: "forged-authorization-value",
      resource: RESOURCE,
      testVerifier: rejectingVerifier(),
      sqliteDb: db,
    });

    expect(result.ok).toBe(false);
    if (result.ok || !("challenge" in result)) throw new Error("expected a 402 challenge");
    expect(result.http_status).toBe(402);

    expect(activationCount()).toBe(0);
    const purchaseRow = db
      .prepare(`SELECT status FROM purchases`)
      .get() as { status: string };
    expect(purchaseRow.status).toBe(MONITORING_PAYMENT_READY_STATUS);
    expect(purchaseRow.status).not.toBe("MONITORING_ACTIVE");
  });

  it("first verified settlement creates exactly one payment and one activation", async () => {
    const { verified, quoteId } = await establishReadyQuote("firstsettle");

    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: "genuine-looking-authorization-value",
      resource: RESOURCE,
      testVerifier: acceptingVerifier(),
      sqliteDb: db,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("MONITORING_STARTED");
    if (!("monitor_id" in result)) throw new Error("expected monitor_id");
    expect(result.monitor_id).toBeTruthy();

    expect(paymentAttemptCount()).toBe(1);
    expect(activationCount()).toBe(1);

    const purchaseRow = db
      .prepare(`SELECT id, status FROM purchases`)
      .get() as { id: string; status: string };
    expect(purchaseRow.status).toBe("MONITORING_ACTIVE");
    expect(result.monitor_id).toBe(purchaseRow.id);

    const activation = db
      .prepare(`SELECT status, monitor_id FROM monitor_activations`)
      .get() as { status: string; monitor_id: string };
    expect(activation.status).toBe("active");
    expect(activation.monitor_id).toBe(purchaseRow.id);

    const payment = db
      .prepare(`SELECT status, settlement_ref FROM payment_attempts`)
      .get() as { status: string; settlement_ref: string };
    expect(payment.status).toBe("settled");
    expect(payment.settlement_ref).toBeTruthy();
  });

  it("concurrent/duplicate replay creates one monitor and returns ALREADY_ACTIVE", async () => {
    const { verified, quoteId } = await establishReadyQuote("concurrent");
    const verifier = acceptingVerifier();

    const callOnce = () =>
      startMonitoringForAgent({
        quoteId,
        connectionId: verified.connection_id,
        connectionToken: verified.connection_token,
        paymentAuthorizationHeader: "genuine-looking-authorization-value",
        resource: RESOURCE,
        testVerifier: verifier,
        sqliteDb: db,
      });

    const [first, second] = await Promise.all([callOnce(), callOnce()]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["ALREADY_ACTIVE", "MONITORING_STARTED"]);
    if (!("monitor_id" in first) || !("monitor_id" in second)) {
      throw new Error("expected monitor_id on both results");
    }
    expect(first.monitor_id).toBe(second.monitor_id);

    // A later sequential replay must also report ALREADY_ACTIVE.
    const third = await callOnce();
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.status).toBe("ALREADY_ACTIVE");

    // Exactly one settlement is ever recorded and exactly one activation
    // exists — no duplicate charge, no second monitor. (A concurrent racer
    // may mint its own never-settled 'challenged' payment_attempts row
    // before losing the race; that is not a charge, so it is not counted.)
    expect(settledPaymentAttemptCount()).toBe(1);
    expect(activationCount()).toBe(1);
    const purchaseCount = (
      db.prepare(`SELECT COUNT(*) as c FROM purchases`).get() as { c: number }
    ).c;
    expect(purchaseCount).toBe(1);
  });

  it("projection failure returns ACTIVATION_PENDING and never requests repayment; reconciliation activates exactly once", async () => {
    const { verified, quoteId } = await establishReadyQuote("projectionfail");

    // Snapshot the purchase row, then have the (test-only) verifier delete
    // it as a side effect right before reporting settlement — simulating
    // the purchases store being unavailable at the moment of projection,
    // strictly after the payment has already been recorded as settled.
    const purchaseRowBefore = db.prepare(`SELECT * FROM purchases`).get() as Record<
      string,
      unknown
    >;
    const purchaseId = String(purchaseRowBefore.id);
    const columns = Object.keys(purchaseRowBefore);

    const flakyVerifier: X402Verifier = {
      label: "test-fake-flaky-projection",
      async verifyPayment(): Promise<X402VerifyResult> {
        // Other durable rows (fingerprints etc.) FK-reference this purchase;
        // dropping FK enforcement for the delete/reinsert pair below is the
        // simplest way to simulate "purchases store briefly unavailable"
        // without also fabricating cascade deletes across unrelated tables.
        db.exec("PRAGMA foreign_keys = OFF");
        db.prepare(`DELETE FROM purchases WHERE id = ?`).run(purchaseId);
        return { ok: true, settlementRef: "settle_ref_flaky_001", verifiedVia: "test-fake" };
      },
    };

    const pending = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: "genuine-looking-authorization-value",
      resource: RESOURCE,
      testVerifier: flakyVerifier,
      sqliteDb: db,
    });

    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.status).toBe("ACTIVATION_PENDING");
    expect("monitoring_deadline" in pending).toBe(false);

    // The settled payment is never discarded, and no second payment is ever
    // solicited — the quote stays consumed, the activation stays durable.
    expect(paymentAttemptCount()).toBe(1);
    expect(activationCount()).toBe(1);
    const payment = db
      .prepare(`SELECT status FROM payment_attempts`)
      .get() as { status: string };
    expect(payment.status).toBe("settled");
    const activationRow = db
      .prepare(`SELECT status FROM monitor_activations`)
      .get() as { status: string };
    expect(activationRow.status).toBe("pending_projection");

    // A replay while still stuck must report ACTIVATION_PENDING again, not
    // re-issue a payment challenge and not create a duplicate anything.
    const replayWhilePending = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
    });
    expect(replayWhilePending.ok).toBe(true);
    if (replayWhilePending.ok) {
      expect(replayWhilePending.status).toBe("ACTIVATION_PENDING");
    }
    expect(paymentAttemptCount()).toBe(1);
    expect(activationCount()).toBe(1);

    // The transient issue resolves — the purchase row becomes available
    // again — and reconciliation retries projection from the durable
    // activation record alone, never touching payment.
    const placeholders = columns.map(() => "?").join(",");
    db.prepare(
      `INSERT INTO purchases (${columns.join(",")}) VALUES (${placeholders})`,
    ).run(...(columns.map((c) => purchaseRowBefore[c]) as never[]));
    db.exec("PRAGMA foreign_keys = ON");

    const reconciled = await reconcilePendingActivations({ sqliteDb: db });
    expect(reconciled.scanned).toBe(1);
    expect(reconciled.activated).toBe(1);
    expect(reconciled.still_pending).toBe(0);

    expect(purchaseStatus(purchaseId)).toBe("MONITORING_ACTIVE");
    const activationAfter = db
      .prepare(`SELECT status FROM monitor_activations`)
      .get() as { status: string };
    expect(activationAfter.status).toBe("active");

    // Reconciliation is idempotent — nothing left to activate a second time.
    const reconciledAgain = await reconcilePendingActivations({ sqliteDb: db });
    expect(reconciledAgain.scanned).toBe(0);
    expect(reconciledAgain.activated).toBe(0);
    expect(paymentAttemptCount()).toBe(1);
    expect(activationCount()).toBe(1);
  });

  it("expired quote fails closed and issues no payment challenge", async () => {
    const { verified, quoteId } = await establishReadyQuote("expiredquote");

    db.prepare(
      `UPDATE monitoring_enrollment_quotes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`,
    ).run(quoteId);

    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("challenge" in result).toBe(false);
    }
    expect(paymentAttemptCount()).toBe(0);
    expect(activationCount()).toBe(0);
  });

  it("altered quote (tampered price) fails closed and issues no payment challenge", async () => {
    const { verified, quoteId } = await establishReadyQuote("alteredquote");

    db.prepare(
      `UPDATE monitoring_enrollment_quotes SET price_amount = 0.01 WHERE id = ?`,
    ).run(quoteId);

    const result = await startMonitoringForAgent({
      quoteId,
      connectionId: verified.connection_id,
      connectionToken: verified.connection_token,
      paymentAuthorizationHeader: null,
      resource: RESOURCE,
      sqliteDb: db,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("challenge" in result).toBe(false);
    }
    expect(paymentAttemptCount()).toBe(0);
    expect(activationCount()).toBe(0);
  });

  it("existing free /v1/agent actions remain unchanged", async () => {
    const invalid = await runAgentAction({ action: "HACK_THE_PLANET" });
    expect(invalid.http_status).toBe(400);

    const check = await runAgentAction(
      {
        action: "CHECK_CONFIRMED_PURCHASE",
        target_product_url: "https://www.target.com/p/x/-/A-12345",
        purchase_price: 10,
        currency: "USD",
        purchase_date: "2026-07-10",
        country: "US",
        region: "TX",
        purchase_channel: "target_online",
      },
      { offersOverride: [], skipPolicyFreshness: true },
    );
    expect(check.http_status).toBe(200);
    expect(check.body).toHaveProperty("final_decision_by", "Target");
  });
});
