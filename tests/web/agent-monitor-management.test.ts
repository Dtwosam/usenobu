/**
 * Lane 7.4E — agent-native monitor management.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  createSqliteAuthStore,
  resetAuthStoreCache,
} from "../../src/auth/auth-store.js";
import {
  beginAgentEmailVerification,
  revokeAgentConnectionAction,
  verifyAgentEmailCode,
} from "../../src/auth/agent-connections.js";
import {
  clearCapturedAgentEmailCodes,
  peekCapturedAgentEmailCode,
} from "../../src/auth/email.js";
import { exportPurchaseBlob } from "../../src/auth/purchase-blobs.js";
import { resetWebDatabaseCache } from "../../src/web/db.js";
import { runAgentAction } from "../../src/ai/agent-service.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import { selectActivePurchases, listPurchaseRows } from "../../src/monitoring/index.js";
import { isEmailAlertsEnabled } from "../../src/notifications/prefs.js";

function tempDb(): string {
  return path.join(
    os.tmpdir(),
    `nobu-agent-mm-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
}

describe("Lane 7.4E agent monitor management", () => {
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

  async function seedActiveMonitor(args: {
    accountId: string;
    purchaseId: string;
    status?: string;
    stopped?: boolean;
  }): Promise<string> {
    const price = 24.99;
    const now = "2026-07-10T12:00:00.000Z";
    db.prepare(
      `INSERT INTO purchases (
        id, user_ref, target_product_url, purchase_price, currency, purchase_date,
        country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
        is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      args.purchaseId,
      args.accountId,
      "https://www.target.com/p/example-gadget/-/A-87654321",
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
      target_product_url: "https://www.target.com/p/example-gadget/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
      product_title: "Example Gadget WDG-100",
    };
    const offer: MatchableOffer = {
      offer_id: "seed",
      title: "Example Gadget WDG-100",
      seller_kind: "target",
      seller_text: "Target",
      is_target_plus: false,
      merchant_link: "https://www.target.com/p/example-gadget/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
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

    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const blob = exportPurchaseBlob(db, args.purchaseId)!;
    await store.savePurchaseBlob({
      accountId: args.accountId,
      purchaseId: args.purchaseId,
      blobJson: blob,
      nowIso: now,
    });

    return fp.fingerprint_id;
  }

  it("1. owner list excludes other accounts, pending and stopped monitors", async () => {
    const a = await establishConnection("owner-a@example.com");
    const b = await establishConnection("owner-b@example.com");
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const connA = await store.getAgentConnectionById(a.connection_id);
    const connB = await store.getAgentConnectionById(b.connection_id);
    const accountA = connA!.account_id!;
    const accountB = connB!.account_id!;

    await seedActiveMonitor({
      accountId: accountA,
      purchaseId: "pur_a_active",
    });
    await seedActiveMonitor({
      accountId: accountA,
      purchaseId: "pur_a_pending",
      status: "MONITORING_PAYMENT_READY",
    });
    await seedActiveMonitor({
      accountId: accountA,
      purchaseId: "pur_a_stopped",
      stopped: true,
    });
    await seedActiveMonitor({
      accountId: accountB,
      purchaseId: "pur_b_active",
    });

    const list = await runAgentAction(
      {
        action: "LIST_ACTIVE_MONITORS",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
      },
      { sqliteDb: db },
    );
    expect(list.http_status).toBe(200);
    const body = list.body as {
      monitors: Array<{ purchase_id: string }>;
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.monitors.map((m) => m.purchase_id)).toEqual(["pur_a_active"]);
    // No emails / payments / blobs
    expect(JSON.stringify(body)).not.toMatch(/@example\.com|payment|blob_json/i);
  });

  it("2–3. status requires correct connection; guessed/cross-owner same not_found", async () => {
    const a = await establishConnection("status-a@example.com");
    const b = await establishConnection("status-b@example.com");
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const accountA = (await store.getAgentConnectionById(a.connection_id))!
      .account_id!;
    await seedActiveMonitor({ accountId: accountA, purchaseId: "pur_status" });

    const ok = await runAgentAction(
      {
        action: "CHECK_MONITORING_STATUS",
        purchase_id: "pur_status",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
      },
      { sqliteDb: db },
    );
    expect(ok.http_status).toBe(200);
    expect((ok.body as { purchase_id: string }).purchase_id).toBe("pur_status");

    const noCreds = await runAgentAction(
      { action: "CHECK_MONITORING_STATUS", purchase_id: "pur_status" },
      { sqliteDb: db },
    );
    expect(noCreds.http_status).toBe(404);
    expect((noCreds.body as { error: string }).error).toBe("not_found");

    const wrongConn = await runAgentAction(
      {
        action: "CHECK_MONITORING_STATUS",
        purchase_id: "pur_status",
        connection_id: b.connection_id,
        connection_token: b.connection_token,
      },
      { sqliteDb: db },
    );
    expect(wrongConn.http_status).toBe(404);
    expect((wrongConn.body as { error: string }).error).toBe("not_found");

    const missing = await runAgentAction(
      {
        action: "CHECK_MONITORING_STATUS",
        purchase_id: "pur_does_not_exist",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
      },
      { sqliteDb: db },
    );
    expect(missing.http_status).toBe(404);
    expect((missing.body as { error: string }).error).toBe("not_found");
    // Same shape
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(wrongConn.body));
  });

  it("4. email enable/disable is owner-scoped, idempotent, durable", async () => {
    const a = await establishConnection("email-a@example.com");
    const b = await establishConnection("email-b@example.com");
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const accountA = (await store.getAgentConnectionById(a.connection_id))!
      .account_id!;
    await seedActiveMonitor({ accountId: accountA, purchaseId: "pur_email" });

    const enable = await runAgentAction(
      {
        action: "ENABLE_EMAIL_ALERTS",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
        purchase_id: "pur_email",
      },
      { sqliteDb: db },
    );
    expect(enable.http_status).toBe(200);
    expect((enable.body as { status: string }).status).toBe(
      "EMAIL_ALERTS_ENABLED",
    );
    expect(isEmailAlertsEnabled(db, "pur_email")).toBe(true);

    const enableAgain = await runAgentAction(
      {
        action: "ENABLE_EMAIL_ALERTS",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
        purchase_id: "pur_email",
      },
      { sqliteDb: db },
    );
    expect(enableAgain.http_status).toBe(200);

    // Durable meta
    const blob = await store.getPurchaseBlob(accountA, "pur_email");
    expect(blob?.email_alerts_enabled).toBe(1);

    const cross = await runAgentAction(
      {
        action: "ENABLE_EMAIL_ALERTS",
        connection_id: b.connection_id,
        connection_token: b.connection_token,
        purchase_id: "pur_email",
      },
      { sqliteDb: db },
    );
    expect(cross.http_status).toBe(404);

    const disable = await runAgentAction(
      {
        action: "DISABLE_EMAIL_ALERTS",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
        purchase_id: "pur_email",
      },
      { sqliteDb: db },
    );
    expect(disable.http_status).toBe(200);
    expect((disable.body as { status: string }).status).toBe(
      "EMAIL_ALERTS_DISABLED",
    );
    expect(isEmailAlertsEnabled(db, "pur_email")).toBe(false);

    // Still monitoring
    const status = db
      .prepare(`SELECT status FROM purchases WHERE id = ?`)
      .get("pur_email") as { status: string };
    expect(status.status).toBe("MONITORING_ACTIVE");
  });

  it("5–6. stop is idempotent, not archive/delete/payment-touch; excluded from scheduler", async () => {
    const a = await establishConnection("stop-a@example.com");
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const accountA = (await store.getAgentConnectionById(a.connection_id))!
      .account_id!;
    await seedActiveMonitor({ accountId: accountA, purchaseId: "pur_stop" });

    // Ensure payment tables exist and are empty for this purchase
    const paymentsBefore = (
      db.prepare(`SELECT COUNT(*) AS c FROM payment_attempts`).get() as {
        c: number;
      }
    ).c;

    const stop1 = await runAgentAction(
      {
        action: "STOP_MONITORING",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
        purchase_id: "pur_stop",
      },
      { sqliteDb: db },
    );
    expect(stop1.http_status).toBe(200);
    expect((stop1.body as { status: string }).status).toBe("MONITORING_STOPPED");
    expect(JSON.stringify(stop1.body).toLowerCase()).not.toMatch(
      /refund|money back|target owes/,
    );

    const stop2 = await runAgentAction(
      {
        action: "STOP_MONITORING",
        connection_id: a.connection_id,
        connection_token: a.connection_token,
        purchase_id: "pur_stop",
      },
      { sqliteDb: db },
    );
    expect(stop2.http_status).toBe(200);
    expect((stop2.body as { status: string }).status).toBe("MONITORING_STOPPED");

    const row = db
      .prepare(
        `SELECT status, monitoring_stopped_at, monitoring_stop_reason FROM purchases WHERE id = ?`,
      )
      .get("pur_stop") as {
      status: string;
      monitoring_stopped_at: string;
      monitoring_stop_reason: string;
    };
    expect(row.status).toBe("MONITORING_ACTIVE"); // stop ≠ archive/status rewrite
    expect(row.monitoring_stop_reason).toBe("user_requested");
    expect(row.monitoring_stopped_at).toBeTruthy();

    // Not deleted
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM purchases WHERE id = ?`).get(
        "pur_stop",
      ) as { c: number },
    ).toEqual({ c: 1 });

    // Blob not archived
    const blob = await store.getPurchaseBlob(accountA, "pur_stop");
    expect(blob).not.toBeNull();
    expect(blob!.archived_at).toBeNull();

    // Payment records untouched
    const paymentsAfter = (
      db.prepare(`SELECT COUNT(*) AS c FROM payment_attempts`).get() as {
        c: number;
      }
    ).c;
    expect(paymentsAfter).toBe(paymentsBefore);

    // Scheduler selection excludes stopped
    const selected = selectActivePurchases(listPurchaseRows(db), "2026-07-10T12:00:00.000Z");
    expect(selected.map((p) => p.id)).not.toContain("pur_stop");
  });

  it("7. revoking a connection does not stop an existing monitor", async () => {
    const a = await establishConnection("revoke-a@example.com");
    const store = createSqliteAuthStore(db);
    await store.ensureSchema();
    const accountA = (await store.getAgentConnectionById(a.connection_id))!
      .account_id!;
    await seedActiveMonitor({ accountId: accountA, purchaseId: "pur_revoke" });

    const revoked = await revokeAgentConnectionAction({
      connectionId: a.connection_id,
      connectionToken: a.connection_token,
      sqliteDb: db,
    });
    expect(revoked.ok).toBe(true);

    const row = db
      .prepare(
        `SELECT status, monitoring_stopped_at FROM purchases WHERE id = ?`,
      )
      .get("pur_revoke") as {
      status: string;
      monitoring_stopped_at: string | null;
    };
    expect(row.status).toBe("MONITORING_ACTIVE");
    expect(row.monitoring_stopped_at).toBeNull();

    const selected = selectActivePurchases(
      listPurchaseRows(db),
      "2026-07-10T12:00:00.000Z",
    );
    expect(selected.map((p) => p.id)).toContain("pur_revoke");
  });

  it("8. existing free actions remain unchanged", async () => {
    const invalid = await runAgentAction(
      { action: "UNDERSTAND_PURCHASE", purchase_text: "" },
      { sqliteDb: db },
    );
    expect(invalid.http_status).toBe(400);

    const begin = await runAgentAction(
      {
        action: "BEGIN_EMAIL_VERIFICATION",
        email: "legacy-ok@example.com",
      },
      { sqliteDb: db },
    );
    expect(begin.http_status).toBe(200);
    expect((begin.body as { status: string }).status).toBe("EMAIL_CODE_SENT");

    // Legacy non-account purchase status without credentials
    db.prepare(
      `INSERT INTO purchases (
        id, user_ref, target_product_url, purchase_price, currency, purchase_date,
        country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
        is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "pur_legacy",
      "usr_" + "a".repeat(32),
      "https://www.target.com/p/x/-/A-1",
      10,
      "USD",
      "2026-07-01",
      "US",
      "TX",
      "target_online",
      null,
      null,
      null,
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      null,
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );
    const legacyStatus = await runAgentAction(
      { action: "CHECK_MONITORING_STATUS", purchase_id: "pur_legacy" },
      { sqliteDb: db },
    );
    expect(legacyStatus.http_status).toBe(200);
    expect((legacyStatus.body as { purchase_id: string }).purchase_id).toBe(
      "pur_legacy",
    );
  });
});
