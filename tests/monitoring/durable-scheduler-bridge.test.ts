/**
 * Lane 7.4F — durable-to-scheduler bridge + shared notification pipeline.
 * Fixture observations + captured test emails only (no live SerpApi/Resend).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase, type NobuDatabase } from "../../src/db/index.js";
import {
  createSqliteAuthStore,
  resetAuthStoreCache,
  type AuthStore,
} from "../../src/auth/auth-store.js";
import { exportPurchaseBlob } from "../../src/auth/purchase-blobs.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import {
  runScheduledMonitoringTickWithDurableBridge,
  hydrateActiveAgentMonitorsFromDurable,
  DEFAULT_DURABLE_HYDRATE_LIMIT,
} from "../../src/monitoring/durable-bridge.js";
import {
  countAlertsForPurchase,
  listPurchaseRows,
  selectActivePurchases,
  DEFAULT_SCHEDULED_BATCH_SIZE,
} from "../../src/monitoring/index.js";
import type { ObservationFetcher } from "../../src/monitoring/types.js";
import {
  clearCapturedPriceDropEmails,
  getCapturedPriceDropEmails,
  setEmailAlertPreference,
  isEmailAlertsEnabled,
} from "../../src/notifications/index.js";
import { newId } from "../../src/auth/crypto.js";

const AS_OF = "2026-07-10T12:00:00.000Z";
const AS_OF_LATER = "2026-07-11T12:00:00.000Z";

function tempPath(prefix: string): string {
  return path.join(
    os.tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function matchingLowerOffer(price: number): MatchableOffer {
  return {
    offer_id: "obs",
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
}

function seedLockedPurchase(
  db: NobuDatabase,
  args: {
    purchaseId: string;
    ownerRef: string | null;
    price?: number;
    stopped?: boolean;
    status?: string;
  },
): { fingerprintId: string } {
  const price = args.price ?? 20;
  const now = "2026-07-02T00:00:00.000Z";
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
    "2026-07-15",
    now,
    now,
  );

  const purchase = {
    purchase_id: args.purchaseId,
    target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
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
  const fp = confirmAndPersistLockedFingerprint({
    db,
    purchase,
    candidate: evaluation.exact_candidate!,
    confirmed_at: now,
  });

  const status = args.status ?? "MONITORING_ACTIVE";
  db.prepare(
    `UPDATE purchases SET status = ?, fingerprint_id = ?, updated_at = ? WHERE id = ?`,
  ).run(status, fp.fingerprint_id, now, args.purchaseId);

  if (args.stopped) {
    db.prepare(
      `UPDATE purchases SET monitoring_stopped_at = ?, monitoring_stop_reason = ? WHERE id = ?`,
    ).run(now, "user_requested", args.purchaseId);
  }

  return { fingerprintId: fp.fingerprint_id };
}

describe("Lane 7.4F durable scheduler bridge", () => {
  let durablePath: string;
  let localPath: string;
  let durableDb: NobuDatabase;
  let store: AuthStore;
  let accountId: string;
  let paths: string[];

  beforeEach(async () => {
    paths = [];
    durablePath = tempPath("nobu-dur");
    localPath = tempPath("nobu-loc");
    paths.push(durablePath, localPath);
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedPriceDropEmails();
    resetAuthStoreCache();

    durableDb = openDatabase(durablePath);
    migrateUp(durableDb);
    store = createSqliteAuthStore(durableDb);
    await store.ensureSchema();

    const now = AS_OF;
    const account = await store.upsertAccountForEmail(
      "agent-sched@example.com",
      now,
    );
    accountId = account.id;
    await store.markAccountVerified(accountId, now);
  });

  afterEach(() => {
    try {
      durableDb.close();
    } catch {
      /* ignore */
    }
    resetAuthStoreCache();
    clearCapturedPriceDropEmails();
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    for (const p of paths) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function openLocal(p: string): NobuDatabase {
    const db = openDatabase(p);
    migrateUp(db);
    return db;
  }

  async function registerAgentActivation(args: {
    localDb: NobuDatabase;
    purchaseId: string;
    fingerprintId: string;
    emailAlerts?: boolean;
  }) {
    const blobJson = exportPurchaseBlob(args.localDb, args.purchaseId)!;
    await store.savePurchaseBlob({
      accountId,
      purchaseId: args.purchaseId,
      blobJson,
      nowIso: AS_OF,
    });
    if (args.emailAlerts) {
      await setEmailAlertPreference({
        db: args.localDb,
        accountId,
        purchaseId: args.purchaseId,
        enabled: true,
        nowIso: AS_OF,
      });
      const refreshed = exportPurchaseBlob(args.localDb, args.purchaseId)!;
      await store.savePurchaseBlob({
        accountId,
        purchaseId: args.purchaseId,
        blobJson: refreshed,
        nowIso: AS_OF,
      });
      await store.updatePurchaseLifecycleMeta({
        accountId,
        purchaseId: args.purchaseId,
        email_alerts_enabled: 1,
        email_alerts_consent_at: AS_OF,
        email_alerts_disabled_at: null,
        nowIso: AS_OF,
      });
    }

    durableDb
      .prepare(
        `INSERT INTO monitor_activations
         (id, quote_id, activation_key, payment_attempt_id, purchase_id,
          fingerprint_id, monitor_id, status, created_at, projected_at)
         VALUES (?,?,?,?,?,?,?,'active',?,?)`,
      )
      .run(
        newId("act"),
        newId("quote"),
        newId("akey"),
        newId("pay"),
        args.purchaseId,
        args.fingerprintId,
        args.purchaseId,
        AS_OF,
        AS_OF,
      );
  }

  function priceDropFetcher(price: number): ObservationFetcher {
    return () => ({
      offers: [matchingLowerOffer(price)],
      provider_status: "LIVE_TARGET_MATCH",
      observed_at: AS_OF,
      consumed_search: true,
      query: "WDG-100",
      raw_result_hash: "a".repeat(64),
    });
  }

  it("1+2. agent + web monitors process in same tick; agent drop emails once", async () => {
    const local = openLocal(localPath);

    // Web-originated (guest/local owner, no durable activation)
    seedLockedPurchase(local, {
      purchaseId: "pur_web",
      ownerRef: "usr_" + "b".repeat(32),
      price: 20,
    });

    // Agent-originated paid (account + activation)
    const { fingerprintId } = seedLockedPurchase(local, {
      purchaseId: "pur_agent",
      ownerRef: accountId,
      price: 20,
    });
    await registerAgentActivation({
      localDb: local,
      purchaseId: "pur_agent",
      fingerprintId,
      emailAlerts: true,
    });

    let providerCalls = 0;
    const fetch: ObservationFetcher = (args) => {
      providerCalls += 1;
      return priceDropFetcher(12)(args);
    };

    const tick = await runScheduledMonitoringTickWithDurableBridge({
      db: local,
      as_of: AS_OF,
      fetchObservation: fetch,
      process_emails: true,
      store,
      use_durable_bridge: true,
    });

    expect(tick.processed).toBeGreaterThanOrEqual(2);
    expect(tick.results.map((r) => r.purchase_id).sort()).toEqual(
      ["pur_agent", "pur_web"].sort(),
    );
    expect(providerCalls).toBe(2);
    expect(countAlertsForPurchase(local, "pur_agent")).toBe(1);
    expect(countAlertsForPurchase(local, "pur_web")).toBe(1);

    const emails = getCapturedPriceDropEmails();
    // Only agent has consent + verified account email
    expect(emails.length).toBe(1);
    expect(emails[0]!.purchase_id).toBe("pur_agent");
    expect(emails[0]!.subject).toMatch(/possible price drop/i);
    expect(JSON.stringify(emails[0])).not.toMatch(
      /agent-sched@example\.com|settlement|PAYMENT/i,
    );

    local.close();
  });

  it("3+4. fresh SQLite instance: no duplicate alert/email; email pref survives", async () => {
    const local1 = openLocal(localPath);
    const { fingerprintId } = seedLockedPurchase(local1, {
      purchaseId: "pur_dup",
      ownerRef: accountId,
      price: 30,
    });
    await registerAgentActivation({
      localDb: local1,
      purchaseId: "pur_dup",
      fingerprintId,
      emailAlerts: true,
    });

    await runScheduledMonitoringTickWithDurableBridge({
      db: local1,
      as_of: AS_OF,
      fetchObservation: priceDropFetcher(15),
      process_emails: true,
      use_durable_bridge: true,
      store,
    });
    expect(countAlertsForPurchase(local1, "pur_dup")).toBe(1);
    expect(getCapturedPriceDropEmails().length).toBe(1);
    local1.close();

    // Fresh local instance — empty purchases DB
    const local2Path = tempPath("nobu-loc2");
    paths.push(local2Path);
    const local2 = openLocal(local2Path);
    expect(
      (local2.prepare(`SELECT COUNT(*) AS c FROM purchases`).get() as { c: number })
        .c,
    ).toBe(0);

    clearCapturedPriceDropEmails();
    await runScheduledMonitoringTickWithDurableBridge({
      db: local2,
      as_of: AS_OF_LATER,
      fetchObservation: priceDropFetcher(15),
      process_emails: true,
      use_durable_bridge: true,
      store,
    });

    expect(isEmailAlertsEnabled(local2, "pur_dup")).toBe(true);
    expect(countAlertsForPurchase(local2, "pur_dup")).toBe(1);
    // No new email for same opportunity
    expect(getCapturedPriceDropEmails().length).toBe(0);
    local2.close();
  });

  it("5. stopped agent monitor is not fetched and gets no provider call/email", async () => {
    const local = openLocal(localPath);
    const { fingerprintId } = seedLockedPurchase(local, {
      purchaseId: "pur_stopped",
      ownerRef: accountId,
      price: 20,
      stopped: true,
    });
    await registerAgentActivation({
      localDb: local,
      purchaseId: "pur_stopped",
      fingerprintId,
      emailAlerts: true,
    });

    let providerCalls = 0;
    const fetch: ObservationFetcher = (args) => {
      providerCalls += 1;
      return priceDropFetcher(10)(args);
    };

    const hydrated = await hydrateActiveAgentMonitorsFromDurable({
      db: local,
      store,
      limit: DEFAULT_DURABLE_HYDRATE_LIMIT,
    });
    expect(hydrated.hydrated).toBe(0);
    expect(hydrated.skipped_ineligible).toBeGreaterThanOrEqual(1);

    const tick = await runScheduledMonitoringTickWithDurableBridge({
      db: local,
      as_of: AS_OF,
      fetchObservation: fetch,
      process_emails: true,
      use_durable_bridge: true,
      store,
    });
    expect(tick.results.find((r) => r.purchase_id === "pur_stopped")).toBeUndefined();
    expect(providerCalls).toBe(0);
    expect(getCapturedPriceDropEmails().length).toBe(0);
    expect(
      selectActivePurchases(listPurchaseRows(local), AS_OF).map((p) => p.id),
    ).not.toContain("pur_stopped");
    local.close();
  });

  it("6. disabled alerts still monitor but suppress email", async () => {
    const local = openLocal(localPath);
    const { fingerprintId } = seedLockedPurchase(local, {
      purchaseId: "pur_noconsent",
      ownerRef: accountId,
      price: 20,
    });
    await registerAgentActivation({
      localDb: local,
      purchaseId: "pur_noconsent",
      fingerprintId,
      emailAlerts: false,
    });

    let providerCalls = 0;
    const tick = await runScheduledMonitoringTickWithDurableBridge({
      db: local,
      as_of: AS_OF,
      fetchObservation: (args) => {
        providerCalls += 1;
        return priceDropFetcher(12)(args);
      },
      process_emails: true,
      use_durable_bridge: true,
      store,
    });

    expect(providerCalls).toBe(1);
    expect(tick.alerts_created).toBe(1);
    expect(countAlertsForPurchase(local, "pur_noconsent")).toBe(1);
    expect(getCapturedPriceDropEmails().length).toBe(0);
    local.close();
  });

  it("7. batch/budget limits remain intact with bridge", async () => {
    const local = openLocal(localPath);
    // Many web monitors due at once
    for (let i = 0; i < DEFAULT_SCHEDULED_BATCH_SIZE + 3; i++) {
      seedLockedPurchase(local, {
        purchaseId: `pur_batch_${i}`,
        ownerRef: "usr_" + "c".repeat(32),
        price: 20,
      });
    }

    let providerCalls = 0;
    const tick = await runScheduledMonitoringTickWithDurableBridge({
      db: local,
      as_of: AS_OF,
      batch_size: DEFAULT_SCHEDULED_BATCH_SIZE,
      fetchObservation: (args) => {
        providerCalls += 1;
        return priceDropFetcher(12)(args);
      },
      process_emails: false,
      use_durable_bridge: true,
      store,
    });

    expect(providerCalls).toBeLessThanOrEqual(DEFAULT_SCHEDULED_BATCH_SIZE);
    expect(tick.processed).toBeLessThanOrEqual(DEFAULT_SCHEDULED_BATCH_SIZE);
    expect(tick.searches_consumed).toBeLessThanOrEqual(DEFAULT_SCHEDULED_BATCH_SIZE);
    local.close();
  });
});
