/**
 * Lane 7.3A.2B — lifecycle mapper + durable archive/outcome/delete.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  mapPurchaseLifecycle,
  UserOutcome,
} from "../../src/web/purchase-lifecycle.js";
import {
  archivePurchase,
  deletePurchasePermanently,
  listPurchasesForLifecycle,
  restorePurchase,
  setPurchaseOutcome,
} from "../../src/web/purchase-lifecycle-service.js";
import { createPurchaseFlow } from "../../src/web/purchase-service.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import {
  mintAccountId,
  resetAuthStoreCache,
  getAuthStore,
} from "../../src/auth/auth-store.js";
import { exportPurchaseBlob } from "../../src/auth/purchase-blobs.js";

const GUEST = "usr_" + "c".repeat(32);

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-life-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

describe("mapPurchaseLifecycle", () => {
  it("maps active statuses", () => {
    expect(
      mapPurchaseLifecycle({ status: "MONITORING_ACTIVE" }),
    ).toBe("active");
    expect(
      mapPurchaseLifecycle({ status: "MATCH_REVIEW_REQUIRED" }),
    ).toBe("active");
    expect(
      mapPurchaseLifecycle({ status: "PRICE_DROP_DETECTED" }),
    ).toBe("active");
    expect(
      mapPurchaseLifecycle({ status: "NO_RELIABLE_PRICE" }),
    ).toBe("active");
  });

  it("maps history statuses", () => {
    expect(mapPurchaseLifecycle({ status: "WINDOW_EXPIRED" })).toBe("history");
    expect(
      mapPurchaseLifecycle({ status: "UNSUPPORTED_PURCHASE" }),
    ).toBe("history");
    expect(mapPurchaseLifecycle({ status: "POLICY_EXCLUSION" })).toBe(
      "history",
    );
  });

  it("archive wins over status", () => {
    expect(
      mapPurchaseLifecycle({
        status: "MONITORING_ACTIVE",
        archived_at: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe("archived");
    expect(
      mapPurchaseLifecycle({
        status: "WINDOW_EXPIRED",
        archived_at: "2026-07-01T00:00:00.000Z",
      }),
    ).toBe("archived");
  });

  it("past deadline with active status → history", () => {
    expect(
      mapPurchaseLifecycle({
        status: "MONITORING_ACTIVE",
        monitoring_deadline: "2020-01-01",
        now: new Date("2026-07-20"),
      }),
    ).toBe("history");
  });
});

describe("lifecycle service (account durable)", () => {
  let dbPath: string;
  let accountId: string;

  beforeEach(() => {
    dbPath = tempDb();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_AUTH_TEST_MODE = "1";
    process.env.NOBU_FIXTURE_MODE = "1";
    resetWebDatabaseCache();
    resetAuthStoreCache();
    accountId = mintAccountId();
  });

  afterEach(() => {
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

  async function seedPurchase(status = "MATCH_REVIEW_REQUIRED") {
    const created = await createPurchaseFlow(
      {
        product_title: "Lifecycle Widget",
        purchase_price: "29.99",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
        fixture_scenario: "exact_match",
      },
      { owner_ref: accountId },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    const db = openDatabase(dbPath);
    migrateUp(db);
    if (status !== "MATCH_REVIEW_REQUIRED") {
      db.prepare(`UPDATE purchases SET status = ? WHERE id = ?`).run(
        status,
        created.purchase_id,
      );
    }
    const store = await getAuthStore({ sqliteDb: db });
    const blob = exportPurchaseBlob(db, created.purchase_id);
    if (blob) {
      await store.savePurchaseBlob({
        accountId,
        purchaseId: created.purchase_id,
        blobJson: blob,
        nowIso: new Date().toISOString(),
      });
    }
    db.close();
    return created.purchase_id;
  }

  it("expired purchase stays in History", async () => {
    const id = await seedPurchase("WINDOW_EXPIRED");
    resetWebDatabaseCache();
    const db = openDatabase(dbPath);
    migrateUp(db);
    const list = await listPurchasesForLifecycle({
      owner_ref: accountId,
      kind: "account",
      db,
    });
    expect(list.by_tab.history.some((p) => p.id === id)).toBe(true);
    expect(list.by_tab.active.some((p) => p.id === id)).toBe(false);
    db.close();
  });

  it("archive and restore return correct tabs", async () => {
    const id = await seedPurchase("MONITORING_ACTIVE");
    resetWebDatabaseCache();
    const db = openDatabase(dbPath);
    migrateUp(db);

    const arch = await archivePurchase({ accountId, purchaseId: id, db });
    expect(arch.ok).toBe(true);
    let list = await listPurchasesForLifecycle({
      owner_ref: accountId,
      kind: "account",
      db,
    });
    expect(list.by_tab.archived.some((p) => p.id === id)).toBe(true);
    expect(list.by_tab.active.some((p) => p.id === id)).toBe(false);

    const rest = await restorePurchase({ accountId, purchaseId: id, db });
    expect(rest.ok).toBe(true);
    list = await listPurchasesForLifecycle({
      owner_ref: accountId,
      kind: "account",
      db,
    });
    expect(list.by_tab.active.some((p) => p.id === id)).toBe(true);
    expect(list.by_tab.archived.some((p) => p.id === id)).toBe(false);
    db.close();
  });

  it("user outcome is separate from deterministic status", async () => {
    const id = await seedPurchase("MONITORING_ACTIVE");
    resetWebDatabaseCache();
    const db = openDatabase(dbPath);
    migrateUp(db);
    const before = db
      .prepare(`SELECT status FROM purchases WHERE id = ?`)
      .get(id) as { status: string };

    const r = await setPurchaseOutcome({
      accountId,
      purchaseId: id,
      outcome: UserOutcome.TARGET_APPROVED,
      db,
    });
    expect(r.ok).toBe(true);

    const after = db
      .prepare(`SELECT status FROM purchases WHERE id = ?`)
      .get(id) as { status: string };
    expect(after.status).toBe(before.status);

    const list = await listPurchasesForLifecycle({
      owner_ref: accountId,
      kind: "account",
      db,
    });
    const item = list.items.find((p) => p.id === id);
    expect(item?.user_outcome).toBe(UserOutcome.TARGET_APPROVED);
    expect(item?.status).toBe("MONITORING_ACTIVE");
    db.close();
  });

  it("account B cannot mutate account A", async () => {
    const id = await seedPurchase("MONITORING_ACTIVE");
    const other = mintAccountId();
    resetWebDatabaseCache();
    const db = openDatabase(dbPath);
    migrateUp(db);
    const arch = await archivePurchase({
      accountId: other,
      purchaseId: id,
      db,
    });
    expect(arch.ok).toBe(false);
    const del = await deletePurchasePermanently({
      accountId: other,
      purchaseId: id,
      db,
    });
    expect(del.ok).toBe(false);
    const still = db
      .prepare(`SELECT id FROM purchases WHERE id = ?`)
      .get(id);
    expect(still).toBeTruthy();
    db.close();
  });

  it("delete removes only authorized purchase", async () => {
    const id = await seedPurchase("WINDOW_EXPIRED");
    const id2 = await seedPurchase("MONITORING_ACTIVE");
    resetWebDatabaseCache();
    const db = openDatabase(dbPath);
    migrateUp(db);
    const del = await deletePurchasePermanently({
      accountId,
      purchaseId: id,
      db,
    });
    expect(del.ok).toBe(true);
    expect(
      db.prepare(`SELECT id FROM purchases WHERE id = ?`).get(id),
    ).toBeUndefined();
    expect(
      db.prepare(`SELECT id FROM purchases WHERE id = ?`).get(id2),
    ).toBeTruthy();
    const store = await getAuthStore({ sqliteDb: db });
    expect(await store.getPurchaseBlob(accountId, id)).toBeNull();
    db.close();
  });

  it("guest list still works without archive meta", async () => {
    process.env.NOBU_DB_PATH = dbPath;
    resetWebDatabaseCache();
    const created = await createPurchaseFlow(
      {
        product_title: "Guest life",
        purchase_price: "12.00",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
      },
      { owner_ref: GUEST },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const db = openDatabase(dbPath);
    migrateUp(db);
    const list = await listPurchasesForLifecycle({
      owner_ref: GUEST,
      kind: "guest",
      db,
    });
    expect(list.items.some((p) => p.id === created.purchase_id)).toBe(true);
    db.close();
  });
});
