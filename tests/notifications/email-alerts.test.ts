/**
 * Lane 7.3B — consented price-drop email alerts: consent, eligibility,
 * idempotency, authorization, verified-email recipient.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import {
  runMonitoringPass,
  type ObservationFetcher,
} from "../../src/monitoring/index.js";
import {
  clearCapturedPriceDropEmails,
  getCapturedPriceDropEmails,
  maskEmail,
  processPriceDropEmailForNewAlert,
  setEmailAlertPreference,
  isEmailAlertsEnabled,
  PRICE_DROP_EMAIL_SUBJECT,
  PRICE_DROP_EMAIL_DISCLOSURE,
} from "../../src/notifications/index.js";
import {
  createSqliteAuthStore,
  mintAccountId,
  resetAuthStoreCache,
} from "../../src/auth/auth-store.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import { getPurchaseDetail } from "../../src/web/purchase-service.js";

const AS_OF = "2026-07-10T12:00:00.000Z";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-email-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

function seedConfirmedPurchase(
  db: ReturnType<typeof openDatabase>,
  args: {
    purchaseId: string;
    ownerRef: string;
    price?: number;
  },
): { purchaseId: string; fingerprintId: string } {
  const price = args.price ?? 20;
  const purchaseId = args.purchaseId;

  db.prepare(
    `INSERT INTO purchases (
      id, user_ref, target_product_url, purchase_price, currency, purchase_date,
      country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
      is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    purchaseId,
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
    purchase_id: purchaseId,
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
    confirmed_at: "2026-07-02T00:00:00.000Z",
  });

  return { purchaseId, fingerprintId: fp.fingerprint_id };
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

function ambiguousOffers(): MatchableOffer[] {
  return [
    {
      ...matchingLowerOffer(10),
      offer_id: "a",
      target_item_id: "11111111",
      model_number: "WDG-100",
    },
    {
      ...matchingLowerOffer(11),
      offer_id: "b",
      target_item_id: "22222222",
      model_number: "WDG-100",
      title: "Other Widget",
    },
  ];
}

describe("Lane 7.3B email alerts", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedPriceDropEmails();
    resetAuthStoreCache();
    resetWebDatabaseCache();
  });

  afterEach(() => {
    clearCapturedPriceDropEmails();
    resetWebDatabaseCache();
    resetAuthStoreCache();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  async function setupAccount(db: ReturnType<typeof openDatabase>, email: string) {
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const account = await store.upsertAccountForEmail(email, AS_OF);
    await store.markAccountVerified(account.id, AS_OF);
    return account;
  }

  it("masks verified email without requiring a second address field", () => {
    expect(maskEmail("demo@example.com")).toBe("d***@example.com");
    expect(maskEmail("ab@x.co")).toBe("a***@x.co");
  });

  it("does not send without consent; consent is off by default", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const account = await setupAccount(db, "alerts@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-nc",
      ownerRef: account.id,
    });

    expect(isEmailAlertsEnabled(db, purchaseId)).toBe(false);

    const fetch: ObservationFetcher = () => ({
      offers: [matchingLowerOffer(12)],
      provider_status: "LIVE_TARGET_MATCH",
      observed_at: AS_OF,
      consumed_search: true,
    });

    const batch = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: AS_OF,
      purchase_id: purchaseId,
      fetchObservation: fetch,
    });
    expect(batch.alerts_created).toBe(1);
    const alertId = batch.results[0]!.alert_id!;

    const notify = await processPriceDropEmailForNewAlert({
      db,
      purchaseId,
      alertId,
      nowIso: AS_OF,
    });
    expect(notify.status).toBe("suppressed");
    expect(notify.reason).toBe("no_consent");
    expect(getCapturedPriceDropEmails()).toHaveLength(0);
  });

  it("sends one email for one new valid opportunity to verified account email", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const account = await setupAccount(db, "owner@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-ok",
      ownerRef: account.id,
    });

    const pref = await setEmailAlertPreference({
      db,
      accountId: account.id,
      purchaseId,
      enabled: true,
      nowIso: AS_OF,
    });
    expect(pref.ok).toBe(true);
    expect(isEmailAlertsEnabled(db, purchaseId)).toBe(true);

    const batch = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: AS_OF,
      purchase_id: purchaseId,
      fetchObservation: () => ({
        offers: [matchingLowerOffer(12)],
        provider_status: "LIVE_TARGET_MATCH",
        observed_at: AS_OF,
        consumed_search: true,
      }),
    });
    expect(batch.alerts_created).toBe(1);
    const alertId = batch.results[0]!.alert_id!;

    const notify = await processPriceDropEmailForNewAlert({
      db,
      purchaseId,
      alertId,
      nowIso: AS_OF,
    });
    expect(notify.status).toBe("sent");
    expect(notify.reason).toBe("sent_immediate");
    expect(notify.attempted).toBe(true);

    const captured = getCapturedPriceDropEmails();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.subject).toBe(PRICE_DROP_EMAIL_SUBJECT);
    expect(captured[0]!.text).toContain(PRICE_DROP_EMAIL_DISCLOSURE);
    expect(captured[0]!.text).toContain("Example Widget");
    expect(captured[0]!.text).toContain("Review opportunity");
    // No full email address in body
    expect(captured[0]!.text.toLowerCase()).not.toContain("owner@example.com");
    // Link has no auth token
    expect(captured[0]!.text).not.toMatch(/token=/i);
  });

  it("retries and repeated checks do not duplicate email", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const account = await setupAccount(db, "dup@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-dup",
      ownerRef: account.id,
    });
    await setEmailAlertPreference({
      db,
      accountId: account.id,
      purchaseId,
      enabled: true,
      nowIso: AS_OF,
    });

    const fetch: ObservationFetcher = () => ({
      offers: [matchingLowerOffer(12)],
      provider_status: "LIVE_TARGET_MATCH",
      observed_at: AS_OF,
      consumed_search: true,
    });

    const first = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: AS_OF,
      purchase_id: purchaseId,
      fetchObservation: fetch,
    });
    const alertId = first.results[0]!.alert_id!;
    await processPriceDropEmailForNewAlert({
      db,
      purchaseId,
      alertId,
      nowIso: AS_OF,
    });
    expect(getCapturedPriceDropEmails()).toHaveLength(1);

    // Replay same alert processing
    const again = await processPriceDropEmailForNewAlert({
      db,
      purchaseId,
      alertId,
      nowIso: AS_OF,
    });
    expect(again.reason).toBe("duplicate_opportunity");
    expect(getCapturedPriceDropEmails()).toHaveLength(1);

    // Monitoring replay (idempotent alert)
    const second = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: "2026-07-11T12:00:00.000Z",
      purchase_id: purchaseId,
      fetchObservation: fetch,
    });
    expect(second.alerts_created).toBe(0);
    if (second.results[0]?.alert_id) {
      await processPriceDropEmailForNewAlert({
        db,
        purchaseId,
        alertId: second.results[0].alert_id,
        nowIso: "2026-07-11T12:00:00.000Z",
      });
    }
    expect(getCapturedPriceDropEmails()).toHaveLength(1);
  });

  it("disabling alerts prevents future sends", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const account = await setupAccount(db, "off@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-off",
      ownerRef: account.id,
      price: 30,
    });
    await setEmailAlertPreference({
      db,
      accountId: account.id,
      purchaseId,
      enabled: true,
      nowIso: AS_OF,
    });
    await setEmailAlertPreference({
      db,
      accountId: account.id,
      purchaseId,
      enabled: false,
      nowIso: AS_OF,
    });
    expect(isEmailAlertsEnabled(db, purchaseId)).toBe(false);

    const batch = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: AS_OF,
      purchase_id: purchaseId,
      fetchObservation: () => ({
        offers: [matchingLowerOffer(15)],
        provider_status: "LIVE_TARGET_MATCH",
        observed_at: AS_OF,
        consumed_search: true,
      }),
    });
    const alertId = batch.results[0]!.alert_id!;
    const notify = await processPriceDropEmailForNewAlert({
      db,
      purchaseId,
      alertId,
      nowIso: AS_OF,
    });
    expect(notify.reason).toBe("no_consent");
    expect(getCapturedPriceDropEmails()).toHaveLength(0);
  });

  it("does not send for ambiguous / unreliable / non-drop results", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const account = await setupAccount(db, "bad@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-bad",
      ownerRef: account.id,
    });
    await setEmailAlertPreference({
      db,
      accountId: account.id,
      purchaseId,
      enabled: true,
      nowIso: AS_OF,
    });

    // Ambiguous matches → no alert
    const amb = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: AS_OF,
      purchase_id: purchaseId,
      fetchObservation: () => ({
        offers: ambiguousOffers(),
        provider_status: "AMBIGUOUS_TARGET_RESULTS",
        observed_at: AS_OF,
        consumed_search: true,
      }),
    });
    expect(amb.alerts_created).toBe(0);

    // Price not lower → no alert
    const same = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: "2026-07-11T12:00:00.000Z",
      purchase_id: purchaseId,
      fetchObservation: () => ({
        offers: [matchingLowerOffer(20)],
        provider_status: "LIVE_TARGET_MATCH",
        observed_at: "2026-07-11T12:00:00.000Z",
        consumed_search: true,
      }),
    });
    expect(same.alerts_created).toBe(0);
    expect(getCapturedPriceDropEmails()).toHaveLength(0);
  });

  it("account A cannot change account B preference", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const a = await setupAccount(db, "a@example.com");
    const b = await setupAccount(db, "b@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-a",
      ownerRef: a.id,
    });

    const denied = await setEmailAlertPreference({
      db,
      accountId: b.id,
      purchaseId,
      enabled: true,
      nowIso: AS_OF,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("not_found");
    expect(isEmailAlertsEnabled(db, purchaseId)).toBe(false);
  });

  it("purchase detail is owner-scoped (cross-account not found)", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    process.env.NOBU_DB_PATH = dbPath;
    resetWebDatabaseCache();

    const a = await setupAccount(db, "owner-a@example.com");
    const b = await setupAccount(db, "owner-b@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-priv",
      ownerRef: a.id,
    });

    // getPurchaseDetail uses getWebDatabase — ensure path
    resetWebDatabaseCache();
    process.env.NOBU_DB_PATH = dbPath;
    const own = getPurchaseDetail(purchaseId, { owner_ref: a.id });
    expect(own).not.toBeNull();
    const cross = getPurchaseDetail(purchaseId, { owner_ref: b.id });
    expect(cross).toBeNull();
  });

  it("guests cannot enable email alerts", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const guest = "usr_" + "g".repeat(32);
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-guest",
      ownerRef: guest,
    });
    const result = await setEmailAlertPreference({
      db,
      accountId: guest,
      purchaseId,
      enabled: true,
      nowIso: AS_OF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("guest_must_sign_in");
  });

  it("scheduled cadence skips second check within 24h", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
    const account = await setupAccount(db, "sched@example.com");
    const { purchaseId } = seedConfirmedPurchase(db, {
      purchaseId: "pur-sched",
      ownerRef: account.id,
    });

    let fetches = 0;
    const fetch: ObservationFetcher = () => {
      fetches += 1;
      return {
        offers: [matchingLowerOffer(12)],
        provider_status: "LIVE_TARGET_MATCH",
        observed_at: AS_OF,
        consumed_search: true,
      };
    };

    const first = await runMonitoringPass({
      db,
      mode: "scheduled",
      as_of: AS_OF,
      purchase_id: purchaseId,
      fetchObservation: fetch,
    });
    expect(first.searches_consumed).toBe(1);
    expect(fetches).toBe(1);

    const second = await runMonitoringPass({
      db,
      mode: "scheduled",
      as_of: "2026-07-10T18:00:00.000Z",
      purchase_id: purchaseId,
      fetchObservation: fetch,
    });
    expect(second.searches_consumed).toBe(0);
    expect(second.results[0]?.skip_reason).toBe("not_due");
    expect(fetches).toBe(1);

    // Manual still allowed
    const manual = await runMonitoringPass({
      db,
      mode: "manual",
      as_of: "2026-07-10T18:00:00.000Z",
      purchase_id: purchaseId,
      fetchObservation: fetch,
    });
    expect(manual.searches_consumed).toBe(1);
    expect(fetches).toBe(2);
  });
});
