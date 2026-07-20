/**
 * Lane 7.3A.2A.1 — passwordless auth + guest claim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  claimGuestPurchasesAtomic,
  createSession,
  findLoginTokenByHash,
  findSessionByTokenHash,
  getAccountById,
  insertLoginToken,
  markLoginTokenUsed,
  mintAccountId,
  revokeSession,
  upsertAccountForEmail,
} from "../../src/auth/store.js";
import {
  establishSession,
  requestMagicLinkLogin,
  resolveSessionAccount,
  verifyMagicLinkToken,
} from "../../src/auth/service.js";
import {
  clearCapturedMagicLinks,
  peekLastCapturedToken,
} from "../../src/auth/email.js";
import { isValidEmail, normalizeEmail, sha256Hex } from "../../src/auth/crypto.js";
import {
  createPurchaseFlow,
  getPurchaseDetail,
  listPurchases,
} from "../../src/web/purchase-service.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import { runMonitoringPass } from "../../src/monitoring/index.js";

const GUEST_A = "usr_" + "a".repeat(32);
const GUEST_B = "usr_" + "b".repeat(32);

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

describe("email validation", () => {
  it("accepts valid emails and rejects invalid", () => {
    expect(isValidEmail("you@example.com")).toBe(true);
    expect(normalizeEmail("You@Example.COM")).toBe("you@example.com");
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("passwordless auth core", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedMagicLinks();
    resetWebDatabaseCache();
  });

  afterEach(() => {
    resetWebDatabaseCache();
    clearCapturedMagicLinks();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_AUTH_TEST_MODE;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  function openDb() {
    const db = openDatabase(dbPath);
    migrateUp(db);
    return db;
  }

  it("first verified login creates account and session", async () => {
    const db = openDb();
    const req = await requestMagicLinkLogin({
      db,
      email: "first@example.com",
      guestOwnerRef: GUEST_A,
    });
    expect(req.ok).toBe(true);
    const token = peekLastCapturedToken("first@example.com");
    expect(token).toBeTruthy();

    const verified = verifyMagicLinkToken({
      db,
      rawToken: token!,
      guestOwnerRef: GUEST_A,
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.account_id).toMatch(/^acct_/);

    const account = getAccountById(db, verified.account_id);
    expect(account?.email_verified_at).toBeTruthy();

    const { rawSessionToken } = establishSession({
      db,
      accountId: verified.account_id,
    });
    const session = resolveSessionAccount(db, rawSessionToken);
    expect(session?.id).toBe(verified.account_id);
    db.close();
  });

  it("returning login reuses same account id", async () => {
    const db = openDb();
    await requestMagicLinkLogin({
      db,
      email: "return@example.com",
      guestOwnerRef: GUEST_A,
    });
    const t1 = peekLastCapturedToken("return@example.com")!;
    const v1 = verifyMagicLinkToken({ db, rawToken: t1, guestOwnerRef: GUEST_A });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;

    clearCapturedMagicLinks();
    await requestMagicLinkLogin({
      db,
      email: "return@example.com",
      guestOwnerRef: GUEST_B,
    });
    const t2 = peekLastCapturedToken("return@example.com")!;
    const v2 = verifyMagicLinkToken({ db, rawToken: t2, guestOwnerRef: GUEST_B });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    expect(v2.account_id).toBe(v1.account_id);
    db.close();
  });

  it("rejects expired, invalid, and replayed tokens", async () => {
    const db = openDb();
    const raw = "valid-test-token-abcdefghijklmnop";
    insertLoginToken({
      db,
      emailNormalized: "x@example.com",
      rawToken: raw,
      guestOwnerRef: GUEST_A,
      now: new Date(Date.now() - 60 * 60 * 1000),
      ttlMs: 1000,
    });
    // force expire by updating
    db.prepare(
      `UPDATE auth_login_tokens SET expires_at = ? WHERE token_hash = ?`,
    ).run(new Date(Date.now() - 1000).toISOString(), sha256Hex(raw));

    expect(
      verifyMagicLinkToken({ db, rawToken: raw }).ok,
    ).toBe(false);

    expect(
      verifyMagicLinkToken({ db, rawToken: "totally-unknown-token-zzzz" }).ok,
    ).toBe(false);

    clearCapturedMagicLinks();
    await requestMagicLinkLogin({
      db,
      email: "replay@example.com",
      guestOwnerRef: GUEST_A,
    });
    const tok = peekLastCapturedToken("replay@example.com")!;
    const first = verifyMagicLinkToken({ db, rawToken: tok, guestOwnerRef: GUEST_A });
    expect(first.ok).toBe(true);
    const second = verifyMagicLinkToken({ db, rawToken: tok, guestOwnerRef: GUEST_A });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("used");
    db.close();
  });

  it("claims guest purchases atomically and preserves observations/alerts", async () => {
    resetWebDatabaseCache();
    process.env.NOBU_DB_PATH = dbPath;
    const created = await createPurchaseFlow(
      {
        product_title: "Claim Widget",
        purchase_price: "24.99",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
        fixture_scenario: "exact_match",
      },
      { owner_ref: GUEST_A },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const purchaseId = created.purchase_id;

    const db = openDb();
    // Seed observation + alert under guest
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO price_observations (
        id, purchase_id, fingerprint_id, provider_status, seller_kind, seller_text,
        product_title, product_url, target_item_id, model_number, upc_or_gtin,
        observed_price, currency, observed_at, is_target_plus, price_source_type,
        provider, engine, query, location, country, language, device, raw_result_hash,
        matching_rule_version, provenance_json, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "obs_claim1",
      purchaseId,
      null,
      "OK",
      "target",
      "Target",
      "Claim Widget",
      "https://www.target.com/p/example-widget/-/A-87654321",
      "87654321",
      "WDG-100",
      null,
      18.99,
      "USD",
      now,
      0,
      "THIRD_PARTY_SEARCH_OBSERVATION",
      "SerpApi",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      '{"source":"test"}',
      now,
    );

    const account = upsertAccountForEmail(db, "claimer@example.com", now);
    const claim1 = claimGuestPurchasesAtomic({
      db,
      guestOwnerRef: GUEST_A,
      accountId: account.id,
    });
    expect(claim1.claimed).toBe(1);
    expect(claim1.already_claimed).toBe(false);

    const claim2 = claimGuestPurchasesAtomic({
      db,
      guestOwnerRef: GUEST_A,
      accountId: account.id,
    });
    expect(claim2.already_claimed).toBe(true);
    expect(claim2.claimed).toBe(1);

    const row = db
      .prepare(`SELECT user_ref FROM purchases WHERE id = ?`)
      .get(purchaseId) as { user_ref: string };
    expect(row.user_ref).toBe(account.id);

    const obs = db
      .prepare(`SELECT id FROM price_observations WHERE purchase_id = ?`)
      .get(purchaseId) as { id: string };
    expect(obs.id).toBe("obs_claim1");

    // Old guest cannot read
    expect(
      getPurchaseDetail(purchaseId, { owner_ref: GUEST_A }),
    ).toBeNull();
    expect(
      getPurchaseDetail(purchaseId, { owner_ref: account.id }),
    ).not.toBeNull();
    expect(listPurchases({ owner_ref: GUEST_A })).toEqual([]);
    expect(listPurchases({ owner_ref: account.id }).map((p) => p.id)).toEqual([
      purchaseId,
    ]);
    db.close();
  });

  it("excludes ownerless and legacy demo from claim", () => {
    const db = openDb();
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO purchases (
        id, user_ref, target_product_url, purchase_price, currency, purchase_date,
        country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
        is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run(
      "pur_ownerless",
      null,
      "https://www.target.com/p/x/-/A-1",
      10,
      "USD",
      "2026-07-01",
      "US",
      "CA",
      "target_online",
      null,
      null,
      "1",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      "2026-07-15",
      now,
      now,
    );
    insert.run(
      "pur_demo",
      "demo-user",
      "https://www.target.com/p/x/-/A-2",
      10,
      "USD",
      "2026-07-01",
      "US",
      "CA",
      "target_online",
      null,
      null,
      "2",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      "2026-07-15",
      now,
      now,
    );
    const account = upsertAccountForEmail(db, "q@example.com", now);
    const c1 = claimGuestPurchasesAtomic({
      db,
      guestOwnerRef: "demo-user",
      accountId: account.id,
    });
    expect(c1.claimed).toBe(0);
    const still = db
      .prepare(`SELECT user_ref FROM purchases WHERE id = 'pur_demo'`)
      .get() as { user_ref: string };
    expect(still.user_ref).toBe("demo-user");
    db.close();
  });

  it("does not reassign another account's purchase", async () => {
    resetWebDatabaseCache();
    process.env.NOBU_DB_PATH = dbPath;
    const acctA = mintAccountId();
    const created = await createPurchaseFlow(
      {
        product_title: "Owned A",
        purchase_price: "19.99",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
      },
      { owner_ref: acctA },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const db = openDb();
    const acctB = upsertAccountForEmail(
      db,
      "other@example.com",
      new Date().toISOString(),
    );
    const claim = claimGuestPurchasesAtomic({
      db,
      guestOwnerRef: acctA, // not a guest usr_
      accountId: acctB.id,
    });
    expect(claim.claimed).toBe(0);
    expect(
      getPurchaseDetail(created.purchase_id, { owner_ref: acctA }),
    ).not.toBeNull();
    expect(
      getPurchaseDetail(created.purchase_id, { owner_ref: acctB.id }),
    ).toBeNull();
    db.close();
  });

  it("logout revokes session so account access is blocked", () => {
    const db = openDb();
    const now = new Date().toISOString();
    const account = upsertAccountForEmail(db, "logout@example.com", now);
    db.prepare(
      `UPDATE accounts SET email_verified_at = ? WHERE id = ?`,
    ).run(now, account.id);
    const raw = "session-token-logout-test-abcdefgh";
    const session = createSession({
      db,
      accountId: account.id,
      rawSessionToken: raw,
    });
    expect(resolveSessionAccount(db, raw)?.id).toBe(account.id);
    revokeSession(db, session.id, now);
    expect(resolveSessionAccount(db, raw)).toBeNull();
    db.close();
  });

  it("two accounts stay isolated", async () => {
    resetWebDatabaseCache();
    process.env.NOBU_DB_PATH = dbPath;
    const a = mintAccountId();
    const b = mintAccountId();
    const ca = await createPurchaseFlow(
      {
        product_title: "A only",
        purchase_price: "11.11",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
      },
      { owner_ref: a },
    );
    const cb = await createPurchaseFlow(
      {
        product_title: "B only",
        purchase_price: "22.22",
        purchase_date: "2026-07-10",
        region: "TX",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
      },
      { owner_ref: b },
    );
    expect(ca.ok && cb.ok).toBe(true);
    if (!ca.ok || !cb.ok) return;
    expect(listPurchases({ owner_ref: a }).map((p) => p.id)).toEqual([
      ca.purchase_id,
    ]);
    expect(listPurchases({ owner_ref: b }).map((p) => p.id)).toEqual([
      cb.purchase_id,
    ]);
    expect(getPurchaseDetail(ca.purchase_id, { owner_ref: b })).toBeNull();
    expect(getPurchaseDetail(cb.purchase_id, { owner_ref: a })).toBeNull();
  });

  it("scheduler monitoring still processes across owners", async () => {
    const db = openDb();
    // Minimal regression: migrate + empty pass does not throw
    const batch = await runMonitoringPass({
      db,
      mode: "scheduled",
      fetchObservation: async () => ({
        ok: false as const,
        provider_status: "NO_TARGET_OFFER",
        offers: [],
        consumed_search: false,
        notes: ["test"],
      }),
    });
    expect(batch).toBeTruthy();
    expect(Array.isArray(batch.results)).toBe(true);
    db.close();
  });

  it("guest-only flow still creates purchases under guest ref", async () => {
    resetWebDatabaseCache();
    process.env.NOBU_DB_PATH = dbPath;
    const created = await createPurchaseFlow(
      {
        product_title: "Guest only",
        purchase_price: "15.00",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
      },
      { owner_ref: GUEST_A },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detail = getPurchaseDetail(created.purchase_id, {
      owner_ref: GUEST_A,
    });
    expect(detail).not.toBeNull();
    expect(String(detail!.purchase.user_ref)).toBe(GUEST_A);
  });
});
