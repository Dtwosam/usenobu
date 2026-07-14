/**
 * Cookie-backed SQLite snapshot for Vercel multi-instance demos.
 * Ensures create → redirect → review works across serverless instances.
 */
import { cookies } from "next/headers";
import type { NobuDatabase } from "../db/index.js";
import { isVercelRuntime, markCookieHydrated, wasCookieHydrated } from "./db.js";

const COOKIE_NAME = "nobu_demo_state_v1";
/** Stay under typical 4KB browser cookie limits after base64url. */
const MAX_COOKIE_CHARS = 3800;

type Snapshot = {
  purchases: Array<Record<string, unknown>>;
  product_fingerprints: Array<Record<string, unknown>>;
  product_matches: Array<Record<string, unknown>>;
  price_observations: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  monitor_runs: Array<Record<string, unknown>>;
  search_budget_ledger: Array<Record<string, unknown>>;
  /** Enrollment discovery (live or fixture) for review/confirm. */
  enrollment_discovery: Array<Record<string, unknown>>;
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
    enrollment_discovery: [],
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

/** Drop null/empty fields and heavy provenance to keep cookies under limit. */
function slimRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || v === "") continue;
    // Drop heavy raw provider fields; keep a stub provenance_json when present
    if (k === "query" || k === "raw_result_hash") continue;
    if (k === "provenance_json" && typeof v === "string" && v.length > 80) {
      out[k] = '{"source":"cookie_snapshot"}';
      continue;
    }
    if (k === "notes" && typeof v === "string" && v.length > 120) {
      out[k] = v.slice(0, 120);
      continue;
    }
    if (k === "fingerprint_json" && typeof v === "string" && v.length > 600) {
      out[k] = v.slice(0, 600);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function exportSnapshot(db: NobuDatabase): Snapshot {
  // Keep compact: cookie is the Vercel session source of truth (browser ~4KB limit).
  const fingerprints = tableRows(db, "product_fingerprints")
    .slice(-2)
    .map(slimRow);
  // FK: product_fingerprints.product_match_id → product_matches.id
  const matchIds = new Set(
    fingerprints
      .map((f) => (f.product_match_id != null ? String(f.product_match_id) : ""))
      .filter(Boolean),
  );
  // Minimal match row for FK only (fingerprints reference product_match_id)
  const matches = tableRows(db, "product_matches")
    .filter((m) => matchIds.has(String(m.id)))
    .map((m) =>
      slimRow({
        id: m.id,
        purchase_id: m.purchase_id,
        lifecycle: m.lifecycle,
        seller_kind: m.seller_kind,
        seller_text: m.seller_text,
        product_title: m.product_title,
        product_url: m.product_url,
        created_at: m.created_at,
      }),
    );

  const alerts = tableRows(db, "alerts").slice(-2).map((a) =>
    slimRow({
      id: a.id,
      purchase_id: a.purchase_id,
      fingerprint_id: a.fingerprint_id,
      observation_id: a.observation_id,
      purchase_price: a.purchase_price,
      observed_price: a.observed_price,
      potential_recovery: a.potential_recovery,
      currency: a.currency,
      alert_key: a.alert_key,
      status: a.status,
      // Short disclaimer only — full text regenerates from policy on page if needed
      disclaimer: String(a.disclaimer ?? "").slice(0, 160),
      created_at: a.created_at,
    }),
  );
  const alertObsIds = new Set(
    alerts.map((a) => String(a.observation_id ?? "")).filter(Boolean),
  );
  const observations = tableRows(db, "price_observations")
    .filter(
      (o) =>
        alertObsIds.has(String(o.id)) ||
        // keep latest even without alert
        true,
    )
    .slice(-2)
    .map((o) =>
      slimRow({
        id: o.id,
        purchase_id: o.purchase_id,
        fingerprint_id: o.fingerprint_id,
        provider_status: o.provider_status,
        seller_kind: o.seller_kind,
        seller_text: o.seller_text,
        product_title: o.product_title,
        observed_price: o.observed_price,
        currency: o.currency,
        observed_at: o.observed_at,
        is_target_plus: o.is_target_plus,
        price_source_type: o.price_source_type ?? "THIRD_PARTY_SEARCH_OBSERVATION",
        provider: o.provider ?? "SerpApi",
        // Required NOT NULL — keep stub only (never full raw payload)
        provenance_json: '{"source":"cookie_snapshot"}',
        created_at: o.created_at ?? o.observed_at,
      }),
    );

  // Ensure discovery table exists so export does not throw
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS enrollment_discovery (
        purchase_id TEXT PRIMARY KEY NOT NULL,
        data_source TEXT NOT NULL,
        query TEXT,
        provider_status TEXT,
        evaluation_json TEXT NOT NULL,
        offers_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  } catch {
    /* ignore */
  }

  const discovery = tableRows(db, "enrollment_discovery")
    .slice(-1)
    .map((d) => {
      // Truncate large JSON if needed for cookie limit
      let evaluation_json = String(d.evaluation_json ?? "{}");
      let offers_json = String(d.offers_json ?? "[]");
      if (evaluation_json.length > 1800) {
        evaluation_json = evaluation_json.slice(0, 1800);
      }
      if (offers_json.length > 800) {
        offers_json = offers_json.slice(0, 800);
      }
      return slimRow({
        purchase_id: d.purchase_id,
        data_source: d.data_source,
        query: d.query,
        provider_status: d.provider_status,
        evaluation_json,
        offers_json,
        created_at: d.created_at,
      });
    });

  return {
    purchases: tableRows(db, "purchases").slice(-2).map(slimRow),
    product_fingerprints: fingerprints,
    product_matches: matches,
    price_observations: observations,
    alerts,
    monitor_runs: tableRows(db, "monitor_runs")
      .slice(-1)
      .map((r) =>
        slimRow({
          id: r.id,
          purchase_id: r.purchase_id,
          mode: r.mode,
          outcome: r.outcome,
          skip_reason: r.skip_reason,
          searches_consumed: r.searches_consumed,
          provider_status: r.provider_status,
          match_result: r.match_result,
          started_at: r.started_at,
          finished_at: r.finished_at,
        }),
      ),
    search_budget_ledger: tableRows(db, "search_budget_ledger")
      .slice(-1)
      .map(slimRow),
    enrollment_discovery: discovery,
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
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS enrollment_discovery (
        purchase_id TEXT PRIMARY KEY NOT NULL,
        data_source TEXT NOT NULL,
        query TEXT,
        provider_status TEXT,
        evaluation_json TEXT NOT NULL,
        offers_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  } catch {
    /* ignore */
  }
  insertRows(db, "enrollment_discovery", snapshot.enrollment_discovery ?? []);
}

/** Clear demo tables so cookie snapshot is authoritative across warm instances. */
export function clearDemoTables(db: NobuDatabase): void {
  db.exec(`
    DELETE FROM alerts;
    DELETE FROM monitor_runs;
    DELETE FROM price_observations;
    DELETE FROM product_fingerprints;
    DELETE FROM product_matches;
    DELETE FROM purchases;
    DELETE FROM search_budget_ledger;
  `);
  try {
    db.exec(`DELETE FROM enrollment_discovery;`);
  } catch {
    /* table may not exist yet */
  }
}

/**
 * Load cookie snapshot into DB for this request.
 * Cookie is source of truth on Vercel — always re-apply so confirm/check
 * survive multi-instance and warm-lambda /tmp reuse.
 */
export async function hydrateDatabaseFromCookie(
  db: NobuDatabase,
): Promise<void> {
  if (!isVercelRuntime()) return;
  if (wasCookieHydrated()) return;

  try {
    const jar = await cookies();
    const raw = jar.get(COOKIE_NAME)?.value;
    if (!raw) {
      markCookieHydrated(true);
      return;
    }
    const snapshot = decodeSnapshot(raw);
    if (snapshot) {
      clearDemoTables(db);
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
    // Last resort: drop history first; keep purchase + fingerprint + one alert+obs when possible
    while (encoded.length > MAX_COOKIE_CHARS) {
      if (snapshot.monitor_runs.length > 0) {
        snapshot.monitor_runs = [];
      } else if (snapshot.search_budget_ledger.length > 0) {
        snapshot.search_budget_ledger = [];
      } else if (
        snapshot.price_observations.length > 1 ||
        snapshot.alerts.length > 1
      ) {
        snapshot.alerts = snapshot.alerts.slice(-1);
        const keepObs = new Set(
          snapshot.alerts.map((a) => String(a.observation_id ?? "")),
        );
        snapshot.price_observations = snapshot.price_observations.filter((o) =>
          keepObs.has(String(o.id)),
        );
      } else if (
        snapshot.alerts.length === 1 &&
        snapshot.price_observations.length === 1 &&
        encoded.length > MAX_COOKIE_CHARS
      ) {
        // Keep both alert + observation (FK) — slim disclaimer further
        snapshot.alerts = snapshot.alerts.map((a) => ({
          ...a,
          disclaimer: String(a.disclaimer ?? "").slice(0, 80),
        }));
        encoded = encodeSnapshot(snapshot);
        if (encoded.length > MAX_COOKIE_CHARS) {
          // Drop alert+obs together so import does not break FKs
          snapshot.alerts = [];
          snapshot.price_observations = [];
        }
      } else {
        break;
      }
      encoded = encodeSnapshot(snapshot);
    }
    if (encoded.length > MAX_COOKIE_CHARS) {
      console.error("nobu_cookie_persist_too_large", {
        length: encoded.length,
        max: MAX_COOKIE_CHARS,
      });
      return;
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
