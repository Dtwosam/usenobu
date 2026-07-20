/**
 * Lane 7.3A.2A.1R — durable auth, GET peek, POST consume, guest claim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  createSqliteAuthStore,
  mintAccountId,
  resetAuthStoreCache,
} from "../../src/auth/auth-store.js";
import {
  establishSession,
  peekMagicLinkToken,
  requestMagicLinkLogin,
  resolveSessionAccount,
  verifyMagicLinkToken,
} from "../../src/auth/service.js";
import {
  clearCapturedMagicLinks,
  peekLastCapturedToken,
} from "../../src/auth/email.js";
import { sha256Hex } from "../../src/auth/crypto.js";
import {
  createPurchaseFlow,
  getPurchaseDetail,
  listPurchases,
} from "../../src/web/purchase-service.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";

const GUEST_A = "usr_" + "a".repeat(32);

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-auth-r-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

describe("magic link peek vs consume (1R)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    clearCapturedMagicLinks();
    resetAuthStoreCache();
    resetWebDatabaseCache();
  });

  afterEach(() => {
    resetWebDatabaseCache();
    resetAuthStoreCache();
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

  it("GET peek does not consume the token", async () => {
    const db = openDb();
    await requestMagicLinkLogin({
      email: "peek@example.com",
      guestOwnerRef: GUEST_A,
      sqliteDb: db,
    });
    const raw = peekLastCapturedToken("peek@example.com")!;
    const p1 = await peekMagicLinkToken({ rawToken: raw, sqliteDb: db });
    expect(p1.ok).toBe(true);
    const p2 = await peekMagicLinkToken({ rawToken: raw, sqliteDb: db });
    expect(p2.ok).toBe(true);

    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const row = await store.findLoginTokenByHash(sha256Hex(raw));
    expect(row?.used_at).toBeNull();
    db.close();
  });

  it("email-preview GET then real POST succeeds once", async () => {
    const db = openDb();
    await requestMagicLinkLogin({
      email: "preview@example.com",
      guestOwnerRef: GUEST_A,
      sqliteDb: db,
    });
    const raw = peekLastCapturedToken("preview@example.com")!;

    // Scanner GETs
    expect((await peekMagicLinkToken({ rawToken: raw, sqliteDb: db })).ok).toBe(
      true,
    );
    expect((await peekMagicLinkToken({ rawToken: raw, sqliteDb: db })).ok).toBe(
      true,
    );

    const verified = await verifyMagicLinkToken({
      rawToken: raw,
      guestOwnerRef: GUEST_A,
      purchaseDb: db,
      sqliteDb: db,
    });
    expect(verified.ok).toBe(true);

    const replay = await verifyMagicLinkToken({
      rawToken: raw,
      guestOwnerRef: GUEST_A,
      purchaseDb: db,
      sqliteDb: db,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toBe("used");
    db.close();
  });

  it("POST consumes once; replay fails", async () => {
    const db = openDb();
    await requestMagicLinkLogin({
      email: "once@example.com",
      guestOwnerRef: GUEST_A,
      sqliteDb: db,
    });
    const raw = peekLastCapturedToken("once@example.com")!;
    expect(
      (
        await verifyMagicLinkToken({
          rawToken: raw,
          purchaseDb: db,
          sqliteDb: db,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await verifyMagicLinkToken({
          rawToken: raw,
          purchaseDb: db,
          sqliteDb: db,
        })
      ).ok,
    ).toBe(false);
    db.close();
  });

  it("session works after establish (cross-instance ready via durable store)", async () => {
    const db = openDb();
    await requestMagicLinkLogin({
      email: "sess@example.com",
      guestOwnerRef: GUEST_A,
      sqliteDb: db,
    });
    const raw = peekLastCapturedToken("sess@example.com")!;
    const v = await verifyMagicLinkToken({
      rawToken: raw,
      purchaseDb: db,
      sqliteDb: db,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const { rawSessionToken } = await establishSession({
      accountId: v.account_id,
      sqliteDb: db,
    });
    const account = await resolveSessionAccount(rawSessionToken, undefined, db);
    expect(account?.id).toBe(v.account_id);

    // Fresh connection simulating another server instance on shared durable store
    const db2 = openDatabase(dbPath);
    migrateUp(db2);
    const again = await resolveSessionAccount(rawSessionToken, undefined, db2);
    expect(again?.id).toBe(v.account_id);
    db.close();
    db2.close();
  });

  it("guest claim is atomic and idempotent; blobs preserved", async () => {
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

    const db = openDb();
    await requestMagicLinkLogin({
      email: "claim@example.com",
      guestOwnerRef: GUEST_A,
      sqliteDb: db,
    });
    const raw = peekLastCapturedToken("claim@example.com")!;
    const v1 = await verifyMagicLinkToken({
      rawToken: raw,
      guestOwnerRef: GUEST_A,
      purchaseDb: db,
      sqliteDb: db,
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(v1.claimed).toBe(1);

    // Second login token claim is idempotent for same guest
    clearCapturedMagicLinks();
    await requestMagicLinkLogin({
      email: "claim@example.com",
      guestOwnerRef: GUEST_A,
      sqliteDb: db,
    });
    const raw2 = peekLastCapturedToken("claim@example.com")!;
    const v2 = await verifyMagicLinkToken({
      rawToken: raw2,
      guestOwnerRef: GUEST_A,
      purchaseDb: db,
      sqliteDb: db,
    });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    expect(v2.already_claimed).toBe(true);

    expect(
      getPurchaseDetail(created.purchase_id, { owner_ref: GUEST_A }),
    ).toBeNull();
    expect(
      getPurchaseDetail(created.purchase_id, { owner_ref: v1.account_id }),
    ).not.toBeNull();
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
    expect(getPurchaseDetail(ca.purchase_id, { owner_ref: b })).toBeNull();
  });

  it("logout revokes session", async () => {
    const db = openDb();
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const now = new Date().toISOString();
    const account = await store.upsertAccountForEmail("out@example.com", now);
    await store.markAccountVerified(account.id, now);
    const raw = "session-token-logout-repair-abcdefgh";
    const session = await store.createSession({
      accountId: account.id,
      rawSessionToken: raw,
    });
    expect(
      (await resolveSessionAccount(raw, undefined, db))?.id,
    ).toBe(account.id);
    await store.revokeSession(session.id, now);
    expect(await resolveSessionAccount(raw, undefined, db)).toBeNull();
    db.close();
  });

  it("rejects expired tokens on peek and consume", async () => {
    const db = openDb();
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const raw = "expired-token-value-abcdefghijklmn";
    await store.insertLoginToken({
      emailNormalized: "exp@example.com",
      rawToken: raw,
      guestOwnerRef: GUEST_A,
      now: new Date(Date.now() - 60_000),
      ttlMs: 1,
    });
    expect((await peekMagicLinkToken({ rawToken: raw, sqliteDb: db })).ok).toBe(
      false,
    );
    expect(
      (
        await verifyMagicLinkToken({
          rawToken: raw,
          purchaseDb: db,
          sqliteDb: db,
        })
      ).ok,
    ).toBe(false);
    db.close();
  });
});
