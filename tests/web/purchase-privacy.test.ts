/**
 * Lane 7.3A.2A — account-private purchases and fixture isolation.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  confirmPurchaseCandidate,
  createPurchaseFlow,
  getAlert,
  getPurchaseDetail,
  getQuarantinedPurchaseCount,
  listPurchases,
} from "../../src/web/purchase-service.js";
import { runBoundedManualCheck } from "../../src/web/manual-check.js";
import {
  consumerOwnsPurchase,
  countQuarantinedPurchases,
  isOwnerlessUserRef,
  isQuarantinedUserRef,
  isValidSessionOwner,
  LEGACY_SHARED_DEMO_OWNER,
  newSessionOwnerId,
} from "../../src/web/session-owner.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import { isFixtureCheckAllowed } from "../../src/web/manual-check-mode.js";
import { resolveDiscoveryDataSource } from "../../src/web/live-discovery.js";

const USER_A = "test_user_a_privacy";
const USER_B = "test_user_b_privacy";

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `nobu-privacy-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

describe("session owner helpers", () => {
  it("mints valid usr_ session owners", () => {
    const id = newSessionOwnerId();
    expect(isValidSessionOwner(id)).toBe(true);
    expect(id).not.toBe(LEGACY_SHARED_DEMO_OWNER);
  });

  it("ownerless and legacy shared are quarantined from normal accounts", () => {
    expect(isOwnerlessUserRef(null)).toBe(true);
    expect(isOwnerlessUserRef("")).toBe(true);
    expect(isQuarantinedUserRef(null)).toBe(true);
    expect(isQuarantinedUserRef(LEGACY_SHARED_DEMO_OWNER)).toBe(true);
    expect(isQuarantinedUserRef("usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      false,
    );
  });

  it("ownership is exact match; ownerless never matches", () => {
    expect(consumerOwnsPurchase(USER_A, USER_A)).toBe(true);
    expect(consumerOwnsPurchase(USER_A, USER_B)).toBe(false);
    expect(consumerOwnsPurchase(null, USER_A)).toBe(false);
    expect(consumerOwnsPurchase("", USER_A)).toBe(false);
  });
});

describe("purchase privacy (shared DB, two owners)", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tempDbPath();
    process.env.NOBU_DB_PATH = dbPath;
    process.env.NOBU_FIXTURE_MODE = "1";
    delete process.env.NOBU_FORCE_LIVE_CHECKS;
    resetWebDatabaseCache();
  });

  afterEach(() => {
    resetWebDatabaseCache();
    delete process.env.NOBU_DB_PATH;
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  async function createFor(owner: string, title: string) {
    const created = await createPurchaseFlow(
      {
        product_title: title,
        purchase_price: "29.99",
        purchase_date: "2026-07-10",
        region: "CA",
        target_item_id: "87654321",
        target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
        model_number: "WDG-100",
        fixture_scenario: "exact_match",
      },
      { owner_ref: owner },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    return created.purchase_id;
  }

  it("each owner lists only their purchases", async () => {
    const idA = await createFor(USER_A, "User A Widget");
    const idB = await createFor(USER_B, "User B Widget");

    const listA = listPurchases({ owner_ref: USER_A });
    const listB = listPurchases({ owner_ref: USER_B });

    expect(listA.map((p) => p.id)).toEqual([idA]);
    expect(listB.map((p) => p.id)).toEqual([idB]);
    expect(listA.some((p) => p.id === idB)).toBe(false);
    expect(listB.some((p) => p.id === idA)).toBe(false);
  });

  it("cross-user read/confirm/check/alert return not found (same as missing)", async () => {
    const idA = await createFor(USER_A, "Private A");

    expect(getPurchaseDetail(idA, { owner_ref: USER_B })).toBeNull();
    expect(getPurchaseDetail("pur_does_not_exist", { owner_ref: USER_B })).toBeNull();
    expect(getPurchaseDetail(idA, { owner_ref: USER_A })).not.toBeNull();

    const crossConfirm = confirmPurchaseCandidate({
      purchase_id: idA,
      candidate_id: "cand_aaaaaaaa",
      owner_ref: USER_B,
    });
    expect(crossConfirm.ok).toBe(false);
    if (!crossConfirm.ok) expect(crossConfirm.error).toBe("not_found");

    const missingConfirm = confirmPurchaseCandidate({
      purchase_id: "pur_missing_xx",
      candidate_id: "cand_aaaaaaaa",
      owner_ref: USER_B,
    });
    expect(missingConfirm.ok).toBe(false);
    if (!missingConfirm.ok) expect(missingConfirm.error).toBe("not_found");

    const { getWebDatabase } = await import("../../src/web/db.js");
    const db = getWebDatabase();
    const crossCheck = await runBoundedManualCheck({
      db,
      purchase_id: idA,
      user_ref: USER_B,
    });
    expect(crossCheck.ok).toBe(false);
    if (!crossCheck.ok) {
      expect(crossCheck.error).toBe("not_found");
      expect(crossCheck.provider_called).toBe(false);
    }

    expect(getAlert(idA, "alert_none", { owner_ref: USER_B })).toBeNull();
    expect(getAlert(idA, "alert_none", { owner_ref: USER_A })).toBeNull();
  });

  it("ignores client-supplied owner fields on create", async () => {
    const hostile = {
      product_title: "Owned by server",
      purchase_price: "19.99",
      purchase_date: "2026-07-10",
      region: "CA",
      target_item_id: "87654321",
      target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
      model_number: "WDG-100",
      user_ref: USER_B,
      owner_id: USER_B,
      email: "attacker@example.com",
    };
    const created = await createPurchaseFlow(
      hostile as unknown as Parameters<typeof createPurchaseFlow>[0],
      { owner_ref: USER_A },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detail = getPurchaseDetail(created.purchase_id, { owner_ref: USER_A });
    expect(detail).not.toBeNull();
    expect(String(detail!.purchase.user_ref)).toBe(USER_A);
    expect(getPurchaseDetail(created.purchase_id, { owner_ref: USER_B })).toBeNull();
  });

  it("quarantines ownerless and legacy shared without assigning to next user", async () => {
    const db = openDatabase(dbPath);
    migrateUp(db);
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
      "pur_ownerless1",
      null,
      "https://www.target.com/p/orphan/-/A-111",
      10,
      "USD",
      "2026-07-01",
      "US",
      "CA",
      "target_online",
      null,
      null,
      "111",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      "2026-07-15",
      now,
      now,
    );
    insert.run(
      "pur_legacy_demo",
      LEGACY_SHARED_DEMO_OWNER,
      "https://www.target.com/p/legacy/-/A-222",
      12,
      "USD",
      "2026-07-01",
      "US",
      "CA",
      "target_online",
      null,
      null,
      "222",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      "2026-07-15",
      now,
      now,
    );
    const qDirect = countQuarantinedPurchases(db);
    expect(qDirect.ownerless).toBe(1);
    expect(qDirect.legacy_shared).toBe(1);
    expect(qDirect.total_quarantined).toBe(2);
    db.close();

    resetWebDatabaseCache();
    process.env.NOBU_DB_PATH = dbPath;
    const q = getQuarantinedPurchaseCount();
    expect(q.ownerless).toBe(1);
    expect(q.legacy_shared).toBe(1);
    expect(q.total_quarantined).toBe(2);

    // Next user must not inherit them
    const listA = listPurchases({ owner_ref: USER_A });
    expect(listA.find((p) => p.id === "pur_ownerless1")).toBeUndefined();
    expect(listA.find((p) => p.id === "pur_legacy_demo")).toBeUndefined();
    expect(getPurchaseDetail("pur_ownerless1", { owner_ref: USER_A })).toBeNull();
    expect(
      getPurchaseDetail("pur_legacy_demo", { owner_ref: USER_A }),
    ).toBeNull();
  });

  it("empty owner list stays empty", () => {
    expect(listPurchases({ owner_ref: USER_A })).toEqual([]);
  });
});

describe("fixture isolation (production gate)", () => {
  it("production-like env does not allow fixture mode via request-like flags alone", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL: "1",
    } as NodeJS.ProcessEnv;
    expect(isFixtureCheckAllowed(env)).toBe(false);
    expect(resolveDiscoveryDataSource(env)).toBe("LIVE");
  });

  it("fixture mode requires explicit server gate", () => {
    expect(
      isFixtureCheckAllowed({
        NODE_ENV: "production",
        NOBU_FIXTURE_MODE: "1",
      }),
    ).toBe(true);
    expect(
      isFixtureCheckAllowed({
        NODE_ENV: "production",
        NOBU_ALLOW_FIXTURE_CHECKS: "1",
      }),
    ).toBe(true);
  });
});
