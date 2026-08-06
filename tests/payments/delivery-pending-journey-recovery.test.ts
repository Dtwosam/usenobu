/**
 * Delivery-pending journey recovery repair.
 *
 * When finalizeIssuedPassResult creates payment + pass + continuation but
 * journey ensure fails, reconcile must discover settled+pass(+continuation)
 * without journey and create exactly one journey — without payment replay.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import { getAuthStore, resetAuthStoreCache } from "../../src/auth/auth-store.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import { derivePassClaimCredential } from "../../src/payments/claim-credential.js";
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
  reconcilePendingPassSettlements,
} from "../../src/payments/monitoring-pass-service.js";
import { runMarketplaceJourney } from "../../src/a2mcp/marketplace-journey.js";
import type { X402Verifier } from "../../src/payments/x402.js";

const PASS_RESOURCE = "https://www.usenobu.xyz/v1/agent/monitoring-pass";
const baseEnv = {
  NOBU_AUTH_TEST_MODE: "1",
  NOBU_FIXTURE_MODE: "1",
  NOBU_PASS_CLAIM_SECRET: "test-pass-claim-secret-delivery-recovery",
  SESSION_SECRET: "nobu-test-session-secret-do-not-use-in-prod",
};

function failEnv() {
  return {
    ...baseEnv,
    NOBU_TEST_FORCE_JOURNEY_ENSURE_FAIL: "1",
  };
}

function okEnv() {
  return { ...baseEnv };
}

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-delivery-pending-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function acceptingVerifier(settlementRef: string): X402Verifier {
  return {
    label: "test-fake-accept-delivery-pending",
    async verifyPayment() {
      return { ok: true, settlementRef, verifiedVia: "test-fake" };
    },
  };
}

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

describe("delivery-pending missing-journey recovery", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    process.env.NOBU_PASS_CLAIM_SECRET = baseEnv.NOBU_PASS_CLAIM_SECRET;
    delete process.env.NOBU_TEST_FORCE_JOURNEY_ENSURE_FAIL;
    resetAuthStoreCache();
    db = openDatabase(dbPath);
    migrateUp(db);
    await getAuthStore({ sqliteDb: db, env: baseEnv });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    resetAuthStoreCache();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    delete process.env.NOBU_PASS_CLAIM_SECRET;
    delete process.env.NOBU_TEST_FORCE_JOURNEY_ENSURE_FAIL;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("DELIVERY_PENDING → reconcile discovers missing journey → one journey; concurrent reconcile is noop", async () => {
    const header = "signed-header-delivery-pending-1";
    const settlementRef = "0xtx_delivery_pending_journey_1";
    const paid = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: failEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });

    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.status).toBe("MONITORING_PASS_DELIVERY_PENDING");
    if (paid.status !== "MONITORING_PASS_DELIVERY_PENDING") return;

    const body = monitoringPassResponseBody(paid, failEnv());
    expect(body.status).toBe("MONITORING_PASS_DELIVERY_PENDING");
    expect(body.second_payment_required).toBe(false);
    expect(body.payment_status).toBe("recognized");
    expect(JSON.stringify(body)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );
    expect(body.protocol_continuation).toBeNull();

    expect(count(db, "monitoring_pass_payments")).toBe(1);
    expect(count(db, "monitoring_passes")).toBe(1);
    expect(count(db, "monitoring_pass_continuations")).toBe(1);
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    const payment = db
      .prepare(`SELECT status FROM monitoring_pass_payments`)
      .get() as { status: string };
    expect(payment.status).toBe("settled");
    const pass = db
      .prepare(`SELECT id, status FROM monitoring_passes`)
      .get() as { id: string; status: string };
    expect(pass.status).toBe("issued");
    const cont = db
      .prepare(
        `SELECT claim_credential_hash, claim_credential_consumed_at, monitoring_pass_id
         FROM monitoring_pass_continuations`,
      )
      .get() as {
      claim_credential_hash: string | null;
      claim_credential_consumed_at: string | null;
      monitoring_pass_id: string | null;
    };
    expect(cont.claim_credential_hash).toBeNull();
    expect(cont.claim_credential_consumed_at).toBeNull();
    expect(cont.monitoring_pass_id).toBe(pass.id);

    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    // Authoritative store query finds this state even though continuation exists.
    const missing = await store.listSettledMonitoringPassPaymentsMissingJourney();
    expect(missing).toHaveLength(1);

    // Reconciliation without payment replay (env without force-fail).
    const first = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env: okEnv(),
    });
    expect(first.journeys_backfilled).toBeGreaterThanOrEqual(1);
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);
    expect(count(db, "monitoring_passes")).toBe(1);
    expect(count(db, "monitoring_pass_payments")).toBe(1);
    expect(count(db, "monitoring_pass_continuations")).toBe(1);

    const journey = db
      .prepare(
        `SELECT id, stage, monitoring_pass_id FROM marketplace_purchase_journeys`,
      )
      .get() as { id: string; stage: string; monitoring_pass_id: string };
    expect(journey.stage).toBe("confirm_use_pass");
    expect(journey.monitoring_pass_id).toBe(pass.id);

    // Second + concurrent reconciliation create nothing additional.
    const [second, third] = await Promise.all([
      reconcilePendingPassSettlements({ sqliteDb: db, env: okEnv() }),
      reconcilePendingPassSettlements({ sqliteDb: db, env: okEnv() }),
    ]);
    expect(second.journeys_backfilled).toBe(0);
    expect(third.journeys_backfilled).toBe(0);
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);
    expect(count(db, "monitoring_passes")).toBe(1);
    expect(count(db, "monitoring_pass_payments")).toBe(1);
    expect(count(db, "monitoring_pass_continuations")).toBe(1);

    // Replay of original settled request returns same pass + journey.
    const replay = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(replay.ok && replay.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!replay.ok || replay.status !== "MONITORING_PASS_ISSUED") return;
    expect(replay.pass.id).toBe(pass.id);
    expect(replay.journey_id).toBe(journey.id);
    expect(replay.journey_stage).toBe("confirm_use_pass");
    const replayBody = monitoringPassResponseBody(replay, okEnv());
    expect(JSON.stringify(replayBody)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );
    expect(replayBody.second_payment_required).toBe(false);
    expect(replayBody.required_fields).toEqual(["confirm_use_pass"]);
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);
  });

  it("advanced journey is never reset by reconciliation or settled replay", async () => {
    const header = "signed-header-advanced-journey";
    const settlementRef = "0xtx_advanced_journey_1";
    const paid = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(paid.ok && paid.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!paid.ok || paid.status !== "MONITORING_PASS_ISSUED") return;

    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    await store.updateMarketplacePurchaseJourney({
      id: paid.journey_id,
      stage: "purchase_description",
      nowIso: new Date().toISOString(),
    });

    await reconcilePendingPassSettlements({ sqliteDb: db, env: okEnv() });
    const afterRecon = await store.getMarketplacePurchaseJourneyById(
      paid.journey_id,
    );
    expect(afterRecon?.stage).toBe("purchase_description");

    const replay = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(replay.ok && replay.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!replay.ok || replay.status !== "MONITORING_PASS_ISSUED") return;
    expect(replay.journey_id).toBe(paid.journey_id);
    expect(replay.journey_stage).toBe("purchase_description");
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);
  });

  it("new continuations have no claim hash; historical claim-hash recovery still works", async () => {
    const paid = await monitoringPassForAgent({
      paymentAuthorizationHeader: "signed-header-new-no-claim",
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
      testVerifier: acceptingVerifier("0xtx_new_no_claim"),
    });
    expect(paid.ok && paid.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!paid.ok || paid.status !== "MONITORING_PASS_ISSUED") return;

    const newCont = db
      .prepare(
        `SELECT claim_credential_hash FROM monitoring_pass_continuations WHERE id = ?`,
      )
      .get(paid.pass_continuation_id) as {
      claim_credential_hash: string | null;
    };
    expect(newCont.claim_credential_hash).toBeNull();
    const paidBody = monitoringPassResponseBody(paid, okEnv());
    expect(JSON.stringify(paidBody)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );

    // Historical pre-repair continuation with claim hash, no journey.
    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    const nowIso = new Date().toISOString();
    const histSettlement = `settle_hist_claim_${Date.now().toString(16)}`;
    const histPayment = await store.upsertMonitoringPassPayment({
      id: `pass_pay_hist_${Date.now().toString(16)}`,
      authorizationDigest: sha256Hex(`hist-digest-${Date.now()}`),
      status: "settled",
      nowIso,
    });
    await store.updateMonitoringPassPayment({
      id: histPayment.id,
      status: "settled",
      settlementRef: histSettlement,
      nowIso,
    });
    const histPass = await store.issueMonitoringPass({
      id: `pass_hist_${Date.now().toString(16)}`,
      passTokenHash: sha256Hex("hist-token"),
      settlementRef: histSettlement,
      paymentId: histPayment.id,
      priceAmount: 0.99,
      priceCurrency: "USD",
      nowIso,
    });
    const autoJ = await store.getMarketplacePurchaseJourneyByPassId(
      histPass.pass.id,
    );
    if (autoJ) {
      db.prepare(`DELETE FROM marketplace_purchase_journeys WHERE id = ?`).run(
        autoJ.id,
      );
    }
    const contId = `pass_cont_hist_${Date.now().toString(16)}`;
    const derived = derivePassClaimCredential({
      paymentId: histPayment.id,
      continuationId: contId,
      env: okEnv(),
    })!;
    await store.ensureMonitoringPassContinuation({
      id: contId,
      paymentId: histPayment.id,
      monitoringPassId: histPass.pass.id,
      status: "issued",
      claimCredentialHash: derived.hash,
      nowIso,
    });
    const stored = db
      .prepare(
        `SELECT claim_credential_hash FROM monitoring_pass_continuations WHERE id = ?`,
      )
      .get(contId) as { claim_credential_hash: string };
    expect(stored.claim_credential_hash).toBe(derived.hash);

    const claimed = await runMarketplaceJourney(
      {
        pass_continuation_id: contId,
        pass_claim_credential: derived.raw,
      },
      { sqliteDb: db, env: okEnv() },
    );
    expect(claimed.http_status).toBe(200);
    expect(claimed.body.required_fields).toEqual(["confirm_use_pass"]);
    expect(String(claimed.body.journey_id)).toMatch(/^journey_/);

    // ensure with null claim hash must not clear a historical hash (COALESCE write path).
    await store.ensureMonitoringPassContinuation({
      id: contId,
      paymentId: histPayment.id,
      monitoringPassId: histPass.pass.id,
      status: "issued",
      claimCredentialHash: null,
      nowIso,
    });
    const after = db
      .prepare(
        `SELECT claim_credential_hash FROM monitoring_pass_continuations WHERE id = ?`,
      )
      .get(contId) as { claim_credential_hash: string | null };
    expect(after.claim_credential_hash).toBe(derived.hash);
  });

  it("no second-payment challenge after settlement when delivery pending or recovered", async () => {
    const header = "signed-header-no-second-pay";
    const settlementRef = "0xtx_no_second_pay";
    const pending = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: failEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(pending.ok && pending.status === "MONITORING_PASS_DELIVERY_PENDING").toBe(
      true,
    );

    // Replay while still delivery-pending: must not 402.
    const midReplay = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: failEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(midReplay.ok).toBe(true);
    if (midReplay.ok) {
      expect(midReplay.http_status).toBe(200);
      expect(midReplay.status).not.toBe("PAYMENT_PENDING");
    }

    await reconcilePendingPassSettlements({ sqliteDb: db, env: okEnv() });

    const after = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(after.ok && after.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (after.ok && after.status === "MONITORING_PASS_ISSUED") {
      expect(after.http_status).toBe(200);
    }
    // Unpaid contact still 402; settled replay never re-challenges.
    const unpaid = await monitoringPassForAgent({
      paymentAuthorizationHeader: null,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
    });
    expect(unpaid.ok).toBe(false);
    if (!unpaid.ok) expect(unpaid.http_status).toBe(402);
  });
});
