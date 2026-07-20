/**
 * Lane 7.4E — free agent-native monitor management.
 *
 * LIST_ACTIVE_MONITORS, ENABLE/DISABLE_EMAIL_ALERTS, STOP_MONITORING,
 * and ownership-safe CHECK_MONITORING_STATUS helpers.
 *
 * No new monitor entity, scheduler, notification system, or payment changes.
 */
import type { NobuDatabase } from "../db/index.js";
import {
  getAuthStore,
  isAccountOwnerRef,
  type AuthStore,
} from "../auth/auth-store.js";
import { authorizeAgentConnection } from "../auth/agent-connections.js";
import {
  exportPurchaseBlob,
  importPurchaseBlobs,
} from "../auth/purchase-blobs.js";
import { setEmailAlertPreference, getEmailAlertPref } from "../notifications/prefs.js";
import { consumerOwnsPurchase } from "./session-owner.js";
import { getWebDatabase } from "./db.js";

export const MONITORING_STOP_REASON_USER_REQUESTED = "user_requested" as const;

export const LIST_ACTIVE_MONITORS_LIMIT = 50;

const GENERIC_NOT_FOUND = {
  error: "not_found" as const,
  message: "No purchase found for that id.",
};

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

async function resolveDb(sqliteDb?: NobuDatabase): Promise<NobuDatabase> {
  if (sqliteDb) return sqliteDb;
  return getWebDatabase();
}

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

/**
 * Hydrate account purchase blobs into the local purchases DB, then return
 * the authorized account id. Never trusts a caller-supplied account id.
 */
export async function hydrateAuthorizedAccountPurchases(args: {
  connectionId: string;
  connectionToken: string;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  now?: Date;
}): Promise<
  | { ok: true; accountId: string; db: NobuDatabase; store: AuthStore }
  | { ok: false; reason: "unauthorized" }
> {
  const auth = await authorizeAgentConnection({
    connectionId: args.connectionId,
    connectionToken: args.connectionToken,
    now: args.now,
    env: args.env,
    sqliteDb: args.sqliteDb,
  });
  if (!auth.ok) return { ok: false, reason: "unauthorized" };

  const accountId = String(auth.connection.account_id || "").trim();
  if (!isAccountOwnerRef(accountId)) {
    return { ok: false, reason: "unauthorized" };
  }

  const db = await resolveDb(args.sqliteDb);
  const store = await resolveStore(db, args.env);
  const blobs = await store.listPurchaseBlobs(accountId);
  importPurchaseBlobs(db, blobs);
  return { ok: true, accountId, db, store };
}

function loadPurchase(
  db: NobuDatabase,
  purchaseId: string,
): Record<string, unknown> | null {
  const row = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  return row ?? null;
}

function ownsPurchase(
  purchase: Record<string, unknown> | null,
  accountId: string,
): boolean {
  if (!purchase) return false;
  return consumerOwnsPurchase(
    purchase.user_ref as string | null | undefined,
    accountId,
  );
}

async function persistPurchaseBlob(args: {
  store: AuthStore;
  db: NobuDatabase;
  accountId: string;
  purchaseId: string;
  nowIso: string;
}): Promise<void> {
  const blob = exportPurchaseBlob(args.db, args.purchaseId);
  if (!blob) return;
  await args.store.savePurchaseBlob({
    accountId: args.accountId,
    purchaseId: args.purchaseId,
    blobJson: blob,
    nowIso: args.nowIso,
  });
}

function productTitleFor(
  db: NobuDatabase,
  purchase: Record<string, unknown>,
): string | null {
  if (purchase.fingerprint_id) {
    try {
      const fp = db
        .prepare(
          `SELECT product_title FROM product_fingerprints WHERE fingerprint_id = ?`,
        )
        .get(String(purchase.fingerprint_id)) as
        | { product_title: string | null }
        | undefined;
      if (fp?.product_title) return String(fp.product_title);
    } catch {
      /* ignore */
    }
  }
  try {
    const m = db
      .prepare(
        `SELECT product_title FROM product_matches WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(String(purchase.id)) as { product_title?: string } | undefined;
    return m?.product_title ? String(m.product_title) : null;
  } catch {
    return null;
  }
}

function emailAlertsEnabled(db: NobuDatabase, purchaseId: string): boolean {
  return Boolean(getEmailAlertPref(db, purchaseId)?.enabled);
}

function isStopped(purchase: Record<string, unknown>): boolean {
  const v = purchase.monitoring_stopped_at;
  return Boolean(v && String(v).trim().length > 0);
}

function safeMonitorSummary(
  db: NobuDatabase,
  purchase: Record<string, unknown>,
): Record<string, unknown> {
  return {
    purchase_id: String(purchase.id),
    status: String(purchase.status),
    retailer: "Target",
    purchase_price: Number(purchase.purchase_price),
    currency: String(purchase.currency ?? "USD"),
    purchase_date: String(purchase.purchase_date),
    monitoring_deadline: purchase.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
    has_locked_fingerprint: Boolean(purchase.fingerprint_id),
    product_title: productTitleFor(db, purchase),
    email_alerts_enabled: emailAlertsEnabled(db, String(purchase.id)),
    monitoring_stopped_at: purchase.monitoring_stopped_at
      ? String(purchase.monitoring_stopped_at)
      : null,
    monitoring_stop_reason: purchase.monitoring_stop_reason
      ? String(purchase.monitoring_stop_reason)
      : null,
  };
}

export type ListActiveMonitorsResult =
  | {
      ok: true;
      monitors: Array<Record<string, unknown>>;
      count: number;
    }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED" };

/**
 * Bounded list of the authorized account's active, unstopped, locked monitors.
 */
export async function listActiveMonitorsForAgent(args: {
  connectionId: string;
  connectionToken: string;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  now?: Date;
  limit?: number;
}): Promise<ListActiveMonitorsResult> {
  const hydrated = await hydrateAuthorizedAccountPurchases(args);
  if (!hydrated.ok) return { ok: false, status: "ACTION_NOT_AUTHORIZED" };

  const { accountId, db } = hydrated;
  const limit = Math.min(
    Math.max(1, args.limit ?? LIST_ACTIVE_MONITORS_LIMIT),
    LIST_ACTIVE_MONITORS_LIMIT,
  );

  const rows = db
    .prepare(
      `SELECT * FROM purchases
       WHERE user_ref = ?
         AND status = 'MONITORING_ACTIVE'
         AND fingerprint_id IS NOT NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(accountId, limit * 2) as Array<Record<string, unknown>>;

  const monitors: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (isStopped(row)) continue;
    monitors.push(safeMonitorSummary(db, row));
    if (monitors.length >= limit) break;
  }

  return { ok: true, monitors, count: monitors.length };
}

export type EmailAlertActionResult =
  | {
      ok: true;
      status: "EMAIL_ALERTS_ENABLED" | "EMAIL_ALERTS_DISABLED";
      purchase_id: string;
      email_alerts_enabled: boolean;
    }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED" }
  | { ok: false; error: "not_found"; message: string };

export async function setEmailAlertsForAgent(args: {
  connectionId: string;
  connectionToken: string;
  purchaseId: string;
  enabled: boolean;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  now?: Date;
}): Promise<EmailAlertActionResult> {
  const hydrated = await hydrateAuthorizedAccountPurchases(args);
  if (!hydrated.ok) return { ok: false, status: "ACTION_NOT_AUTHORIZED" };

  const { accountId, db, store } = hydrated;
  const purchase = loadPurchase(db, args.purchaseId);
  if (!ownsPurchase(purchase, accountId)) {
    return { ok: false, ...GENERIC_NOT_FOUND };
  }

  const nowIso = (args.now ?? new Date()).toISOString();
  const result = await setEmailAlertPreference({
    db,
    accountId,
    purchaseId: args.purchaseId,
    enabled: args.enabled,
    nowIso,
  });
  if (!result.ok) {
    return { ok: false, ...GENERIC_NOT_FOUND };
  }

  await persistPurchaseBlob({
    store,
    db,
    accountId,
    purchaseId: args.purchaseId,
    nowIso,
  });

  return {
    ok: true,
    status: args.enabled ? "EMAIL_ALERTS_ENABLED" : "EMAIL_ALERTS_DISABLED",
    purchase_id: args.purchaseId,
    email_alerts_enabled: result.pref.enabled,
  };
}

export type StopMonitoringResult =
  | {
      ok: true;
      status: "MONITORING_STOPPED";
      purchase_id: string;
      monitoring_stopped_at: string;
      monitoring_stop_reason: typeof MONITORING_STOP_REASON_USER_REQUESTED;
    }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED" }
  | { ok: false; error: "not_found"; message: string };

/**
 * Owner-scoped stop. Idempotent. Does not archive, delete, alter payments,
 * or revoke the connection. Never implies a refund.
 */
export async function stopMonitoringForAgent(args: {
  connectionId: string;
  connectionToken: string;
  purchaseId: string;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  now?: Date;
}): Promise<StopMonitoringResult> {
  const hydrated = await hydrateAuthorizedAccountPurchases(args);
  if (!hydrated.ok) return { ok: false, status: "ACTION_NOT_AUTHORIZED" };

  const { accountId, db, store } = hydrated;
  const purchase = loadPurchase(db, args.purchaseId);
  if (!ownsPurchase(purchase, accountId)) {
    return { ok: false, ...GENERIC_NOT_FOUND };
  }

  const nowIso = (args.now ?? new Date()).toISOString();
  const existingStopped = purchase!.monitoring_stopped_at
    ? String(purchase!.monitoring_stopped_at)
    : null;

  if (!existingStopped) {
    try {
      db.prepare(
        `UPDATE purchases
         SET monitoring_stopped_at = ?,
             monitoring_stop_reason = ?,
             updated_at = ?
         WHERE id = ? AND user_ref = ?`,
      ).run(
        nowIso,
        MONITORING_STOP_REASON_USER_REQUESTED,
        nowIso,
        args.purchaseId,
        accountId,
      );
    } catch {
      return { ok: false, ...GENERIC_NOT_FOUND };
    }
  }

  const stoppedAt = existingStopped ?? nowIso;
  await persistPurchaseBlob({
    store,
    db,
    accountId,
    purchaseId: args.purchaseId,
    nowIso,
  });

  return {
    ok: true,
    status: "MONITORING_STOPPED",
    purchase_id: args.purchaseId,
    monitoring_stopped_at: stoppedAt,
    monitoring_stop_reason: MONITORING_STOP_REASON_USER_REQUESTED,
  };
}

export type CheckMonitoringStatusResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; http_status: 401; status: "ACTION_NOT_AUTHORIZED" }
  | { ok: false; http_status: 404; error: "not_found"; message: string };

/**
 * Ownership-safe status lookup.
 * - Account-owned / agent purchases require valid connection + ownership.
 * - Legacy non-account rows keep prior unauthenticated read compatibility.
 */
export async function checkMonitoringStatusForAgent(args: {
  purchaseId: string;
  connectionId?: string;
  connectionToken?: string;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  now?: Date;
}): Promise<CheckMonitoringStatusResult> {
  const db = await resolveDb(args.sqliteDb);
  const purchaseId = String(args.purchaseId || "").trim();
  if (!purchaseId) {
    return { ok: false, http_status: 404, ...GENERIC_NOT_FOUND };
  }

  const hasCreds =
    Boolean(String(args.connectionId || "").trim()) &&
    Boolean(String(args.connectionToken || "").trim());

  // Prefer authorized hydrate path when credentials are present.
  if (hasCreds) {
    const hydrated = await hydrateAuthorizedAccountPurchases({
      connectionId: String(args.connectionId),
      connectionToken: String(args.connectionToken),
      sqliteDb: args.sqliteDb,
      env: args.env,
      now: args.now,
    });
    if (!hydrated.ok) {
      return {
        ok: false,
        http_status: 401,
        status: "ACTION_NOT_AUTHORIZED",
      };
    }

    const purchase = loadPurchase(hydrated.db, purchaseId);
    if (!ownsPurchase(purchase, hydrated.accountId)) {
      return { ok: false, http_status: 404, ...GENERIC_NOT_FOUND };
    }
    return {
      ok: true,
      body: buildStatusBody(hydrated.db, purchase!),
    };
  }

  // Legacy path: only non-account purchases may be read without credentials.
  const purchase = loadPurchase(db, purchaseId);
  if (!purchase) {
    return { ok: false, http_status: 404, ...GENERIC_NOT_FOUND };
  }

  const owner = String(purchase.user_ref ?? "").trim();
  if (isAccountOwnerRef(owner)) {
    // Account-owned: credentials required — same safe not_found (no existence leak).
    return { ok: false, http_status: 404, ...GENERIC_NOT_FOUND };
  }

  return { ok: true, body: buildStatusBody(db, purchase) };
}

function buildStatusBody(
  db: NobuDatabase,
  purchase: Record<string, unknown>,
): Record<string, unknown> {
  const purchaseId = String(purchase.id);
  let latestObserved: number | null = null;
  let alertCount = 0;
  let runCount = 0;
  try {
    const obs = db
      .prepare(
        `SELECT observed_price FROM price_observations
         WHERE purchase_id = ? AND observed_price IS NOT NULL
         ORDER BY observed_at DESC LIMIT 1`,
      )
      .get(purchaseId) as { observed_price: number } | undefined;
    if (obs?.observed_price != null) latestObserved = Number(obs.observed_price);
  } catch {
    /* ignore */
  }
  try {
    const a = db
      .prepare(`SELECT COUNT(*) AS c FROM alerts WHERE purchase_id = ?`)
      .get(purchaseId) as { c: number };
    alertCount = Number(a?.c ?? 0);
  } catch {
    /* ignore */
  }
  try {
    const r = db
      .prepare(`SELECT COUNT(*) AS c FROM monitor_runs WHERE purchase_id = ?`)
      .get(purchaseId) as { c: number };
    runCount = Number(r?.c ?? 0);
  } catch {
    /* ignore */
  }

  const status = String(purchase.status);
  const stopped = isStopped(purchase);
  let message = `Current status: ${status}`;
  if (stopped) {
    message = "Monitoring stopped for this purchase";
  } else if (status === "MONITORING_ACTIVE") {
    message = "Nobu is watching this purchase";
  }

  return {
    agent_state: "MONITORING_STATUS",
    purchase_id: purchaseId,
    status,
    retailer: "Target",
    purchase_price: Number(purchase.purchase_price),
    currency: String(purchase.currency),
    purchase_date: String(purchase.purchase_date),
    monitoring_deadline: purchase.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
    has_locked_fingerprint: Boolean(purchase.fingerprint_id),
    latest_observed_price: latestObserved,
    alert_count: alertCount,
    run_count: runCount,
    email_alerts_enabled: emailAlertsEnabled(db, purchaseId),
    monitoring_stopped_at: purchase.monitoring_stopped_at
      ? String(purchase.monitoring_stopped_at)
      : null,
    monitoring_stop_reason: purchase.monitoring_stop_reason
      ? String(purchase.monitoring_stop_reason)
      : null,
    message,
  };
}
