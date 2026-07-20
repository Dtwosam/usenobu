/**
 * Export / import account-owned purchase graphs for durable cross-device access.
 * Lane 7.4F: also carries email notification ledger + alert prefs for
 * cross-instance scheduler/notification idempotency.
 */
import type { NobuDatabase } from "../db/index.js";
import type { PurchaseBlobRow } from "./auth-store.js";
import { isValidSessionOwner } from "../web/session-owner.js";
import { isAccountOwnerRef } from "./auth-store.js";

/**
 * Restore local email-alert prefs from durable blob meta.
 * Kept here (not prefs.ts) to avoid circular import with exportPurchaseBlob.
 */
function restoreEmailAlertPref(
  db: NobuDatabase,
  args: {
    purchaseId: string;
    accountId: string;
    email_alerts_enabled?: number | boolean | null;
    email_alerts_consent_at?: string | null;
    email_alerts_disabled_at?: string | null;
    updated_at?: string;
  },
): void {
  if (args.email_alerts_enabled == null && !args.email_alerts_consent_at) {
    return;
  }
  const enabled =
    args.email_alerts_enabled === true || args.email_alerts_enabled === 1;
  const nowIso = args.updated_at ?? new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO purchase_email_alert_prefs
       (purchase_id, account_id, enabled, consent_at, disabled_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(purchase_id) DO UPDATE SET
         account_id = excluded.account_id,
         enabled = excluded.enabled,
         consent_at = COALESCE(excluded.consent_at, purchase_email_alert_prefs.consent_at),
         disabled_at = excluded.disabled_at,
         updated_at = excluded.updated_at`,
    ).run(
      args.purchaseId,
      args.accountId,
      enabled ? 1 : 0,
      args.email_alerts_consent_at ?? null,
      args.email_alerts_disabled_at ?? null,
      nowIso,
    );
  } catch {
    /* table may not exist yet */
  }
}

export type PurchaseBlobPayload = {
  purchase: Record<string, unknown>;
  product_matches: Array<Record<string, unknown>>;
  product_fingerprints: Array<Record<string, unknown>>;
  price_observations: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  enrollment_discovery: Array<Record<string, unknown>>;
  /** Lane 7.4F — durable email notification ledger rows for this purchase. */
  email_notifications?: Array<Record<string, unknown>>;
  /** Lane 7.4F — local email-alert pref row snapshot (also on blob meta). */
  email_alert_pref?: Record<string, unknown> | null;
};

function rows(
  db: NobuDatabase,
  sql: string,
  ...params: unknown[]
): Array<Record<string, unknown>> {
  try {
    return db.prepare(sql).all(...(params as never[])) as Array<
      Record<string, unknown>
    >;
  } catch {
    return [];
  }
}

export function exportPurchaseBlob(
  db: NobuDatabase,
  purchaseId: string,
): string | null {
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  if (!purchase) return null;

  let email_alert_pref: Record<string, unknown> | null = null;
  try {
    email_alert_pref =
      (db
        .prepare(
          `SELECT * FROM purchase_email_alert_prefs WHERE purchase_id = ?`,
        )
        .get(purchaseId) as Record<string, unknown> | undefined) ?? null;
  } catch {
    email_alert_pref = null;
  }

  const payload: PurchaseBlobPayload = {
    purchase,
    product_matches: rows(
      db,
      `SELECT * FROM product_matches WHERE purchase_id = ?`,
      purchaseId,
    ),
    product_fingerprints: rows(
      db,
      `SELECT * FROM product_fingerprints WHERE purchase_id = ?`,
      purchaseId,
    ),
    price_observations: rows(
      db,
      `SELECT * FROM price_observations WHERE purchase_id = ? ORDER BY observed_at DESC LIMIT 20`,
      purchaseId,
    ),
    alerts: rows(
      db,
      `SELECT * FROM alerts WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 10`,
      purchaseId,
    ),
    enrollment_discovery: rows(
      db,
      `SELECT * FROM enrollment_discovery WHERE purchase_id = ?`,
      purchaseId,
    ),
    email_notifications: rows(
      db,
      `SELECT * FROM email_notifications WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 20`,
      purchaseId,
    ),
    email_alert_pref,
  };
  return JSON.stringify(payload);
}

function insertRow(
  db: NobuDatabase,
  table: string,
  row: Record<string, unknown>,
): void {
  const cols = Object.keys(row);
  if (!cols.length) return;
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`;
  const values = cols.map((c) => {
    const v = row[c];
    if (v === null || v === undefined) return null;
    if (typeof v === "number" || typeof v === "bigint") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") return v;
    return String(v);
  });
  try {
    db.prepare(sql).run(...(values as never[]));
  } catch {
    /* ignore partial FK failures */
  }
}

export function importPurchaseBlobs(
  db: NobuDatabase,
  blobs: PurchaseBlobRow[],
): number {
  let n = 0;
  for (const b of blobs) {
    try {
      const payload = JSON.parse(b.blob_json) as PurchaseBlobPayload;
      if (payload.purchase) {
        // Ensure ownership matches durable account
        payload.purchase.user_ref = b.account_id;
        insertRow(db, "purchases", payload.purchase);
      }
      for (const m of payload.product_matches ?? []) insertRow(db, "product_matches", m);
      for (const f of payload.product_fingerprints ?? [])
        insertRow(db, "product_fingerprints", f);
      for (const o of payload.price_observations ?? [])
        insertRow(db, "price_observations", o);
      for (const a of payload.alerts ?? []) insertRow(db, "alerts", a);
      for (const d of payload.enrollment_discovery ?? [])
        insertRow(db, "enrollment_discovery", d);
      for (const en of payload.email_notifications ?? [])
        insertRow(db, "email_notifications", en);

      // Durable blob meta is source of truth for email consent across instances.
      restoreEmailAlertPref(db, {
        purchaseId: b.purchase_id,
        accountId: b.account_id,
        email_alerts_enabled: b.email_alerts_enabled,
        email_alerts_consent_at: b.email_alerts_consent_at,
        email_alerts_disabled_at: b.email_alerts_disabled_at,
        updated_at: b.updated_at,
      });

      // Prefer embedded pref snapshot when meta columns are empty but snapshot is on.
      if (
        payload.email_alert_pref &&
        (b.email_alerts_enabled == null || b.email_alerts_enabled === 0) &&
        payload.email_alert_pref.enabled
      ) {
        restoreEmailAlertPref(db, {
          purchaseId: b.purchase_id,
          accountId: b.account_id,
          email_alerts_enabled: payload.email_alert_pref.enabled as
            | number
            | boolean,
          email_alerts_consent_at: (payload.email_alert_pref.consent_at as
            | string
            | null
            | undefined) ?? null,
          email_alerts_disabled_at: (payload.email_alert_pref.disabled_at as
            | string
            | null
            | undefined) ?? null,
          updated_at: b.updated_at,
        });
      }

      n += 1;
    } catch {
      /* skip bad blob */
    }
  }
  return n;
}

/** True when durable purchase JSON indicates a stopped monitor. */
export function purchaseBlobIsStopped(blob: PurchaseBlobRow): boolean {
  try {
    const payload = JSON.parse(blob.blob_json) as PurchaseBlobPayload;
    const stopped = payload.purchase?.monitoring_stopped_at;
    return Boolean(stopped && String(stopped).trim().length > 0);
  } catch {
    return false;
  }
}

/** True when blob is eligible for scheduled monitoring. */
export function purchaseBlobIsSchedulerEligible(blob: PurchaseBlobRow): boolean {
  try {
    const payload = JSON.parse(blob.blob_json) as PurchaseBlobPayload;
    const p = payload.purchase;
    if (!p) return false;
    if (String(p.status || "") !== "MONITORING_ACTIVE") return false;
    if (!p.fingerprint_id) return false;
    if (purchaseBlobIsStopped(blob)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Reassign guest purchases locally (atomic in SQLite).
 * Does not touch durable claim events (caller records those).
 */
export function reassignGuestPurchasesLocally(args: {
  db: NobuDatabase;
  guestOwnerRef: string;
  accountId: string;
  nowIso: string;
}): { claimed: number; purchaseIds: string[] } {
  const guest = String(args.guestOwnerRef || "").trim();
  if (!isValidSessionOwner(guest) || !isAccountOwnerRef(args.accountId)) {
    return { claimed: 0, purchaseIds: [] };
  }

  args.db.exec("BEGIN IMMEDIATE");
  try {
    const ids = args.db
      .prepare(`SELECT id FROM purchases WHERE user_ref = ?`)
      .all(guest) as Array<{ id: string }>;
    const purchaseIds = ids.map((r) => r.id);
    if (purchaseIds.length) {
      args.db
        .prepare(
          `UPDATE purchases SET user_ref = ?, updated_at = ? WHERE user_ref = ?`,
        )
        .run(args.accountId, args.nowIso, guest);
    }
    args.db.exec("COMMIT");
    return { claimed: purchaseIds.length, purchaseIds };
  } catch (err) {
    try {
      args.db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}
