/**
 * Export / import account-owned purchase graphs for durable cross-device access.
 */
import type { NobuDatabase } from "../db/index.js";
import type { PurchaseBlobRow } from "./auth-store.js";
import { isValidSessionOwner } from "../web/session-owner.js";
import { isAccountOwnerRef } from "./auth-store.js";

export type PurchaseBlobPayload = {
  purchase: Record<string, unknown>;
  product_matches: Array<Record<string, unknown>>;
  product_fingerprints: Array<Record<string, unknown>>;
  price_observations: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  enrollment_discovery: Array<Record<string, unknown>>;
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
      n += 1;
    } catch {
      /* skip bad blob */
    }
  }
  return n;
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
