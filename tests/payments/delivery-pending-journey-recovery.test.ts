/**
 * Delivery-pending journey recovery + historical claim boundary + concurrent accounting.
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

async function seedHistoricalClaimContinuation(args: {
  db: ReturnType<typeof openDatabase>;
  seed: string;
  consumed?: boolean;
}): Promise<{
  passId: string;
  contId: string;
  claimRaw: string;
  paymentId: string;
}> {
  const store = await getAuthStore({ sqliteDb: args.db, env: okEnv() });
  const nowIso = new Date().toISOString();
  const histSettlement = `settle_hist_${args.seed}`;
  const histPayment = await store.upsertMonitoringPassPayment({
    id: `pass_pay_hist_${args.seed}`,
    authorizationDigest: sha256Hex(`hist-digest-${args.seed}`),
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
    id: `pass_hist_${args.seed}`,
    passTokenHash: sha256Hex(`hist-token-${args.seed}`),
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
    args.db
      .prepare(`DELETE FROM marketplace_purchase_journeys WHERE id = ?`)
      .run(autoJ.id);
  }
  // Remove any null-hash continuation ensure might have created for payment.
  args.db
    .prepare(`DELETE FROM monitoring_pass_continuations WHERE payment_id = ?`)
    .run(histPayment.id);

  const contId = `pass_cont_hist_${args.seed}`;
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
  if (args.consumed) {
    args.db
      .prepare(
        `UPDATE monitoring_pass_continuations
         SET claim_credential_consumed_at = ?, status = 'claimed', updated_at = ?
         WHERE id = ?`,
      )
      .run(nowIso, nowIso, contId);
  }
  return {
    passId: histPass.pass.id,
    contId,
    claimRaw: derived.raw,
    paymentId: histPayment.id,
  };
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

  it("null-hash DELIVERY_PENDING is recovered; concurrent recon accounts created once", async () => {
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
    expect(JSON.stringify(body)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );

    expect(count(db, "monitoring_pass_payments")).toBe(1);
    expect(count(db, "monitoring_passes")).toBe(1);
    expect(count(db, "monitoring_pass_continuations")).toBe(1);
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    const cont = db
      .prepare(
        `SELECT claim_credential_hash, claim_credential_consumed_at FROM monitoring_pass_continuations`,
      )
      .get() as {
      claim_credential_hash: string | null;
      claim_credential_consumed_at: string | null;
    };
    expect(cont.claim_credential_hash).toBeNull();
    expect(cont.claim_credential_consumed_at).toBeNull();

    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    const missing =
      await store.listSettledMonitoringPassPaymentsMissingJourney();
    expect(missing).toHaveLength(1);

    // Two workers recover the same row concurrently.
    const [a, b] = await Promise.all([
      reconcilePendingPassSettlements({ sqliteDb: db, env: okEnv() }),
      reconcilePendingPassSettlements({ sqliteDb: db, env: okEnv() }),
    ]);
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);
    expect(a.journeys_backfilled + b.journeys_backfilled).toBe(1);
    expect([a.journeys_backfilled, b.journeys_backfilled].sort()).toEqual([
      0, 1,
    ]);

    const journey = db
      .prepare(
        `SELECT id, stage, monitoring_pass_id FROM marketplace_purchase_journeys`,
      )
      .get() as { id: string; stage: string; monitoring_pass_id: string };
    expect(journey.stage).toBe("confirm_use_pass");

    // Repeated reconciliation returns zero.
    const again = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env: okEnv(),
    });
    expect(again.journeys_backfilled).toBe(0);
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);
    expect(count(db, "monitoring_passes")).toBe(1);
    expect(count(db, "monitoring_pass_payments")).toBe(1);

    // Settled replay: same pass + journey, no claim secret, no second payment.
    const replay = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env: okEnv(),
      testVerifier: acceptingVerifier(settlementRef),
    });
    expect(replay.ok && replay.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!replay.ok || replay.status !== "MONITORING_PASS_ISSUED") return;
    expect(replay.journey_id).toBe(journey.id);
    const replayBody = monitoringPassResponseBody(replay, okEnv());
    expect(JSON.stringify(replayBody)).not.toMatch(
      /pass_claim_credential|claim_credential/,
    );
    expect(replayBody.second_payment_required).toBe(false);
  });

  it("historical unconsumed claim-hash is not auto-recovered; credential path works", async () => {
    const hist = await seedHistoricalClaimContinuation({
      db,
      seed: "unconsumed_claim",
    });
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    // Query must exclude claim-hash rows.
    const missing =
      await store.listSettledMonitoringPassPaymentsMissingJourney();
    expect(missing.every((p) => p.id !== hist.paymentId)).toBe(true);
    expect(
      missing.some((p) => p.id === hist.paymentId),
    ).toBe(false);

    // Recon must not create a journey.
    const recon = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env: okEnv(),
    });
    expect(recon.journeys_backfilled).toBe(0);
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    // Public ID alone remains unauthorized.
    const publicOnly = await runMarketplaceJourney(
      {
        monitoring_pass_id: hist.passId,
        pass_continuation_id: hist.contId,
      },
      { sqliteDb: db, env: okEnv() },
    );
    expect(publicOnly.http_status).toBe(401);
    expect(publicOnly.body.status).toBe("CLAIM_NOT_AUTHORIZED");
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    // Invalid credential remains unauthorized.
    const invalid = await runMarketplaceJourney(
      {
        pass_continuation_id: hist.contId,
        pass_claim_credential: "pass_claim_not_valid_xxx",
      },
      { sqliteDb: db, env: okEnv() },
    );
    expect(invalid.http_status).toBe(401);
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    // Valid historical credential creates exactly one journey and consumes claim.
    const claimed = await runMarketplaceJourney(
      {
        pass_continuation_id: hist.contId,
        pass_claim_credential: hist.claimRaw,
      },
      { sqliteDb: db, env: okEnv() },
    );
    expect(claimed.http_status).toBe(200);
    expect(claimed.body.required_fields).toEqual(["confirm_use_pass"]);
    expect(String(claimed.body.journey_id)).toMatch(/^journey_/);
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);

    const contAfter = db
      .prepare(
        `SELECT claim_credential_consumed_at, claim_credential_hash FROM monitoring_pass_continuations WHERE id = ?`,
      )
      .get(hist.contId) as {
      claim_credential_consumed_at: string | null;
      claim_credential_hash: string | null;
    };
    expect(contAfter.claim_credential_hash).toBeTruthy();
    expect(contAfter.claim_credential_consumed_at).toBeTruthy();

    // Replay recovers same journey.
    const recover = await runMarketplaceJourney(
      {
        pass_continuation_id: hist.contId,
        pass_claim_credential: hist.claimRaw,
      },
      { sqliteDb: db, env: okEnv() },
    );
    expect(String(recover.body.journey_id)).toBe(String(claimed.body.journey_id));
    expect(count(db, "marketplace_purchase_journeys")).toBe(1);

    // Credential not exposed in public body.
    expect(JSON.stringify(claimed.body)).not.toContain(hist.claimRaw);
  });

  it("consumed claim-hash without journey fails closed for automatic recovery", async () => {
    const hist = await seedHistoricalClaimContinuation({
      db,
      seed: "consumed_orphan",
      consumed: true,
    });
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    const missing =
      await store.listSettledMonitoringPassPaymentsMissingJourney();
    expect(missing.some((p) => p.id === hist.paymentId)).toBe(false);

    const recon = await reconcilePendingPassSettlements({
      sqliteDb: db,
      env: okEnv(),
    });
    expect(recon.journeys_backfilled).toBe(0);
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);

    // Valid raw credential after consume cannot invent a new journey via claim
    // (already_existed requires journey; claim_invalid if none).
    const attempted = await runMarketplaceJourney(
      {
        pass_continuation_id: hist.contId,
        pass_claim_credential: hist.claimRaw,
      },
      { sqliteDb: db, env: okEnv() },
    );
    // Fail closed: no automatic journey; claim path without existing journey after consume is invalid.
    expect(count(db, "marketplace_purchase_journeys")).toBe(0);
    expect([401, 400]).toContain(attempted.http_status);
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

  it("new continuations have no claim hash in storage or public responses", async () => {
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

    // ensure with null must not invent a hash on historical rows either.
    const hist = await seedHistoricalClaimContinuation({
      db,
      seed: "preserve_hash",
    });
    const store = await getAuthStore({ sqliteDb: db, env: okEnv() });
    await store.ensureMonitoringPassContinuation({
      id: hist.contId,
      paymentId: hist.paymentId,
      monitoringPassId: hist.passId,
      status: "issued",
      claimCredentialHash: null,
      nowIso: new Date().toISOString(),
    });
    const after = db
      .prepare(
        `SELECT claim_credential_hash FROM monitoring_pass_continuations WHERE id = ?`,
      )
      .get(hist.contId) as { claim_credential_hash: string | null };
    expect(after.claim_credential_hash).toBeTruthy();
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
    expect(
      pending.ok && pending.status === "MONITORING_PASS_DELIVERY_PENDING",
    ).toBe(true);

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
