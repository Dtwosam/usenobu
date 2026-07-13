/**
 * Cookie-backed SQLite snapshot for Vercel multi-instance demos.
 * Ensures create → redirect → review works across serverless instances.
 */
import { cookies } from "next/headers";
import type { NobuDatabase } from "../db/index.js";
import { isVercelRuntime, markCookieHydrated, wasCookieHydrated } from "./db.js";

const COOKIE_NAME = "nobu_demo_state_v1";
const MAX_COOKIE_CHARS = 3500;

type Snapshot = {
  purchases: Array<Record<string, unknown>>;
  product_fingerprints: Array<Record<string, unknown>>;
  product_matches: Array<Record<string, unknown>>;
  price_observations: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  monitor_runs: Array<Record<string, unknown>>;
  search_budget_ledger: Array<Record<string, unknown>>;
};

function emptySnapshot(): Snapshot {
  return {
    purchases: [],
    product_fingerprints: [],
    product_matches: [],
    price_observations: [],
    alerts: [],
    monitor_runs: [],
    search_budget_ledger: [],
  };
}

function tableRows(db: NobuDatabase, table: string): Array<Record<string, unknown>> {
  try {
    return db.prepare(`SELECT * FROM ${table}`).all() as Array<
      Record<string, unknown>
    >;
  } catch {
    return [];
  }
}

export function exportSnapshot(db: NobuDatabase): Snapshot {
  return {
    purchases: tableRows(db, "purchases").slice(0, 8),
    product_fingerprints: tableRows(db, "product_fingerprints").slice(0, 8),
    product_matches: tableRows(db, "product_matches").slice(0, 16),
    price_observations: tableRows(db, "price_observations").slice(0, 24),
    alerts: tableRows(db, "alerts").slice(0, 16),
    monitor_runs: tableRows(db, "monitor_runs").slice(0, 16),
    search_budget_ledger: tableRows(db, "search_budget_ledger").slice(0, 4),
  };
}

function encodeSnapshot(snapshot: Snapshot): string {
  const json = JSON.stringify(snapshot);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodeSnapshot(raw: string): Snapshot | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Snapshot;
    if (!parsed || !Array.isArray(parsed.purchases)) return null;
    return { ...emptySnapshot(), ...parsed };
  } catch {
    return null;
  }
}

function insertRows(
  db: NobuDatabase,
  table: string,
  rows: Array<Record<string, unknown>>,
): void {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]!);
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`;
  const stmt = db.prepare(sql);
  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return null;
      if (typeof v === "number" || typeof v === "bigint") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (typeof v === "string") return v;
      return String(v);
    }) as Array<string | number | bigint | null>;
    stmt.run(...values);
  }
}

export function importSnapshot(db: NobuDatabase, snapshot: Snapshot): void {
  // Order respects FKs
  insertRows(db, "purchases", snapshot.purchases ?? []);
  insertRows(db, "product_matches", snapshot.product_matches ?? []);
  insertRows(db, "product_fingerprints", snapshot.product_fingerprints ?? []);
  insertRows(db, "price_observations", snapshot.price_observations ?? []);
  insertRows(db, "alerts", snapshot.alerts ?? []);
  insertRows(db, "monitor_runs", snapshot.monitor_runs ?? []);
  insertRows(db, "search_budget_ledger", snapshot.search_budget_ledger ?? []);
}

/** Load cookie snapshot into DB once per instance cold path when empty. */
export async function hydrateDatabaseFromCookie(
  db: NobuDatabase,
): Promise<void> {
  if (!isVercelRuntime()) return;
  if (wasCookieHydrated()) return;

  // Only hydrate if this instance DB has no purchases yet
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM purchases")
    .get() as { c: number };
  if (count.c > 0) {
    markCookieHydrated(true);
    return;
  }

  try {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    if (!raw) {
      markCookieHydrated(true);
      return;
    }
    const snapshot = decodeSnapshot(raw);
    if (snapshot) {
      importSnapshot(db, snapshot);
    }
  } catch (err) {
    console.error("nobu_cookie_hydrate_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  markCookieHydrated(true);
}

/** Persist compact DB snapshot to cookie after mutations (Vercel only). */
export async function persistDatabaseToCookie(db: NobuDatabase): Promise<void> {
  if (!isVercelRuntime()) return;
  try {
    const snapshot = exportSnapshot(db);
    let encoded = encodeSnapshot(snapshot);
    // Trim older purchases if cookie would be too large
    while (encoded.length > MAX_COOKIE_CHARS && snapshot.purchases.length > 1) {
      const dropId = String(snapshot.purchases[0]!.id);
      snapshot.purchases = snapshot.purchases.slice(1);
      snapshot.product_fingerprints = snapshot.product_fingerprints.filter(
        (r) => String(r.purchase_id) !== dropId,
      );
      snapshot.product_matches = snapshot.product_matches.filter(
        (r) => String(r.purchase_id) !== dropId,
      );
      snapshot.price_observations = snapshot.price_observations.filter(
        (r) => String(r.purchase_id) !== dropId,
      );
      snapshot.alerts = snapshot.alerts.filter(
        (r) => String(r.purchase_id) !== dropId,
      );
      snapshot.monitor_runs = snapshot.monitor_runs.filter(
        (r) => String(r.purchase_id) !== dropId,
      );
      encoded = encodeSnapshot(snapshot);
    }

    const jar = await cookies();
    jar.set(COOKIE_NAME, encoded, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 60 * 60 * 24 * 7,
    });
  } catch (err) {
    console.error("nobu_cookie_persist_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
