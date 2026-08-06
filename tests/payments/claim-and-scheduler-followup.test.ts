/**
 * Follow-up proofs: recoverable claim, multi-page scheduler, durable outbox.
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
import { derivePassClaimCredential } from "../../src/payments/claim-credential.js";
import {
  monitoringPassForAgent,
  monitoringPassResponseBody,
  resolveMonitoringPassForAgent,
} from "../../src/payments/monitoring-pass-service.js";
import type { X402Verifier, X402VerifyResult } from "../../src/payments/x402.js";
import { runScheduledMonitoringTickWithDurableBridge } from "../../src/monitoring/durable-bridge.js";
import { processPriceDropEmailForNewAlert } from "../../src/notifications/process.js";

const PASS_RESOURCE = "https://www.usenobu.xyz/v1/agent/monitoring-pass";
const env = {
  NOBU_AUTH_TEST_MODE: "1",
  NOBU_FIXTURE_MODE: "1",
  SESSION_SECRET: "nobu-test-session-secret-do-not-use-in-prod",
};

function tempDb(label: string): string {
  return path.join(
    os.tmpdir(),
    `nobu-followup-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function acceptingVerifier(ref: string): X402Verifier {
  return {
    label: "test",
    async verifyPayment(): Promise<X402VerifyResult> {
      return { ok: true, settlementRef: ref, verifiedVia: "test" };
    },
  };
}

describe("claim credential recovery", () => {
  let dbPath: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    dbPath = tempDb("claim");
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

  it("lost successful response then replay still returns same pass and journey", async () => {
    const header = "signed-header-claim-recover-1";
    const first = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env,
      testVerifier: acceptingVerifier("0xtx_claim_recover"),
    });
    expect(first.ok && first.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!first.ok || first.status !== "MONITORING_PASS_ISSUED") return;
    expect(first.journey_id).toBeTruthy();
    expect(first.journey_stage).toBe("confirm_use_pass");
    const body1 = monitoringPassResponseBody(first);
    expect(JSON.stringify(body1)).not.toMatch(/pass_claim_credential|claim_credential/);

    // Replay same payment (lost HTTP response recovery)
    const second = await monitoringPassForAgent({
      paymentAuthorizationHeader: header,
      resource: PASS_RESOURCE,
      sqliteDb: db,
      env,
      testVerifier: acceptingVerifier("0xtx_claim_recover"),
    });
    expect(second.ok && second.status === "MONITORING_PASS_ISSUED").toBe(true);
    if (!second.ok || second.status !== "MONITORING_PASS_ISSUED") return;
    expect(second.pass.id).toBe(first.pass.id);
    expect(second.journey_id).toBe(first.journey_id);
    expect(second.journey_stage).toBe(first.journey_stage);
  });

  it("atomic claim+journey: concurrent claims create one journey", async () => {
    const store = await getAuthStore({ sqliteDb: db, env });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const payment = await store.upsertMonitoringPassPayment({
      id: "pass_pay_claim_race",
      authorizationDigest: sha256Hex("hdr-claim-race"),
      nowIso,
      status: "settled",
    });
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "settled",
      settlementRef: "0xtx_claim_race",
      nowIso,
    });
    const issued = await store.issueMonitoringPass({
      id: "pass_claim_race_001",
      passTokenHash: sha256Hex("internal"),
      settlementRef: "0xtx_claim_race",
      paymentId: payment.id,
      priceAmount: 0.99,
      priceCurrency: "USD",
      nowIso,
    });
    const contId = "pass_cont_claim_race";
    const derived = derivePassClaimCredential({
      paymentId: payment.id,
      continuationId: contId,
      env,
    })!;
    await store.ensureMonitoringPassContinuation({
      id: contId,
      paymentId: payment.id,
      monitoringPassId: issued.pass.id,
      status: "issued",
      claimCredentialHash: derived.hash,
      nowIso,
    });

    const results = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        store.claimPassAndCreateJourney({
          continuationId: contId,
          claimCredentialHash: derived.hash,
          journeyId: `journey_race_${i}`,
          monitoringPassId: issued.pass.id,
          nowIso,
        }),
      ),
    );
    const ok = results.filter(
      (r) => r.outcome === "created" || r.outcome === "already_existed",
    );
    expect(ok.length).toBe(4);
    const journeys = db
      .prepare(`SELECT id FROM marketplace_purchase_journeys`)
      .all() as Array<{ id: string }>;
    expect(journeys).toHaveLength(1);
    const cont = await store.getMonitoringPassContinuationById(contId);
    expect(cont?.claim_credential_consumed_at).toBeTruthy();
  });

  it("historical pass without continuation cannot be claimed by public id", async () => {
    const store = await getAuthStore({ sqliteDb: db, env });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    await store.upsertMonitoringPassPayment({
      id: "pass_pay_hist",
      authorizationDigest: sha256Hex("hist"),
      nowIso,
      status: "settled",
    });
    await store.updateMonitoringPassPayment({
      id: "pass_pay_hist",
      status: "settled",
      settlementRef: "0xtx_hist",
      nowIso,
    });
    await store.issueMonitoringPass({
      id: "pass_historical_only",
      passTokenHash: sha256Hex("x"),
      settlementRef: "0xtx_hist",
      paymentId: "pass_pay_hist",
      priceAmount: 0.99,
      priceCurrency: "USD",
      nowIso,
    });
    const res = await resolveMonitoringPassForAgent({
      monitoringPassId: "pass_historical_only",
      sqliteDb: db,
      env,
    });
    expect(res.http_status).toBe(404);
    expect(res.body.status).toBe("INTERNAL_CONTINUATION_STATE_MISSING");
    expect(res.body.second_payment_required).toBe(false);
    expect(res.body.required_fields).toEqual([]);
  });
});

describe("durable scheduler multi-page + budget", () => {
  let durablePath: string;
  let durableDb: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    durablePath = tempDb("dur");
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

  it(
    "processes pages beyond 50 activations and durable budget is shared",
    async () => {
    const store = await getAuthStore({
      sqliteDb: durableDb,
      env,
      forceSqlite: true,
    });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const account = await store.upsertAccountForEmail(
      "sched@example.com",
      nowIso,
    );

    for (let i = 0; i < 80; i += 1) {
      const pid = `pur_page_${String(i).padStart(4, "0")}`;
      const aid = `act_page_${String(i).padStart(4, "0")}`;
      const qid = `quote_page_${String(i).padStart(4, "0")}`;
      await store.ensureSchema();
      // Use store's issue path via raw SQL on the store's sqlite
      durableDb
        .prepare(
          `INSERT INTO monitor_activations
           (id, quote_id, activation_key, payment_attempt_id, purchase_id,
            fingerprint_id, monitor_id, status, created_at, projected_at)
           VALUES (?,?,?,?,?,?,?,'active',?,?)`,
        )
        .run(aid, qid, `k${i}`, `p${i}`, pid, `fp${i}`, pid, nowIso, nowIso);
      const blob = JSON.stringify({
        purchase: {
          id: pid,
          status: "MONITORING_ACTIVE",
          fingerprint_id: `fp${i}`,
          user_ref: account.id,
          purchase_price: 10,
          currency: "USD",
          purchase_date: "2026-07-01",
          purchase_channel: "target_online",
          country: "US",
          region: "TX",
        },
        fingerprint: { fingerprint_id: `fp${i}`, product_title: "T" },
      });
      await store.savePurchaseBlob({
        accountId: account.id,
        purchaseId: pid,
        blobJson: blob,
        nowIso,
      });
    }

    const listed = await store.listActiveMonitorActivations({ limit: 100 });
    expect(listed.length).toBe(80);

    // Multi-page listActiveMonitorActivations keyset
    const page1 = await store.listActiveMonitorActivations({ limit: 50 });
    const page2 = await store.listActiveMonitorActivations({
      limit: 50,
      afterPurchaseId: page1[page1.length - 1]!.purchase_id,
    });
    expect(page1.length).toBe(50);
    expect(page2.length).toBe(30);
    expect(
      new Set([...page1, ...page2].map((a) => a.purchase_id)).size,
    ).toBe(80);

    // Durable budget shared across two "workers"
    const period = nowIso.slice(0, 7);
    const reserves = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.tryReserveSearchBudget({
          periodKey: period,
          limitCount: 5,
          nowIso,
        }),
      ),
    );
    expect(reserves.filter((r) => r.reserved).length).toBe(5);

    // Full bridge multi-page with separate local caches
    const localA = openDatabase(tempDb("localA"));
    migrateUp(localA);
    const r1 = await runScheduledMonitoringTickWithDurableBridge({
      db: localA,
      as_of: nowIso,
      store,
      env,
      max_pages: 3,
      durable_hydrate_limit: 50,
      durable_monthly_search_limit: 100,
      monthly_search_limit: 100,
      fetchObservation: (async () => ({
        ok: false as const,
        status: "PROVIDER_ERROR" as const,
        notes: ["fixture"],
      })) as never,
      process_emails: false,
      use_durable_bridge: true,
      lease_holder_id: "worker_a",
    });
    expect(r1.pages_processed).toBeGreaterThanOrEqual(2);
    expect(r1.lease_acquired).toBe(true);
    // At least first page of activations considered
    expect(
      r1.durable_hydrated + r1.durable_skipped_ineligible + r1.durable_hydration_blocked,
    ).toBeGreaterThan(0);

    localA.close();
  },
  30_000,
  );
});

describe("durable outbox authoritative", () => {
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

  it("concurrent durable lease yields one send authorization", async () => {
    const store = await getAuthStore({ sqliteDb: durableDb, env });
    await store.ensureSchema();
    const nowIso = new Date().toISOString();
    const key = "opp_auth_1";
    await store.insertNotificationOutbox({
      id: "outbox_auth_1",
      opportunityKey: key,
      purchaseId: "pur_o1",
      accountId: "acct_o1",
      kind: "immediate",
      status: "pending",
      nowIso,
    });
    const expires = new Date(Date.now() + 30_000).toISOString();
    const [a, b] = await Promise.all([
      store.tryLeaseNotificationOutbox({
        opportunityKey: key,
        holderId: "w1",
        leaseExpiresAt: expires,
        nowIso,
      }),
      store.tryLeaseNotificationOutbox({
        opportunityKey: key,
        holderId: "w2",
        leaseExpiresAt: expires,
        nowIso,
      }),
    ]);
    const won = [a, b].filter(Boolean);
    expect(won).toHaveLength(1);
  });
});
