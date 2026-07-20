/**
 * Cookie-backed SQLite snapshot for Vercel multi-instance demos.
 * Ensures create → redirect → review works across serverless instances.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { cookies } from "next/headers";
import type { NobuDatabase } from "../db/index.js";
import { isVercelRuntime, markCookieHydrated, wasCookieHydrated } from "./db.js";
import {
  migrateSnapshotPurchases,
  SESSION_SNAPSHOT_VERSION,
} from "./demo-defaults.js";

const COOKIE_NAME = "nobu_demo_state_v1";
/** Stay under typical 4KB browser cookie limits after encoding. */
const MAX_COOKIE_CHARS = 3500;

type Snapshot = {
  snapshot_version?: number;
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
    snapshot_version: SESSION_SNAPSHOT_VERSION,
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
    // Never mid-truncate fingerprint_json (must remain valid JSON for monitoring)
    if (k === "fingerprint_json" && typeof v === "string" && v.length > 900) {
      try {
        const fp = JSON.parse(v) as Record<string, unknown>;
        out[k] = JSON.stringify({
          fingerprint_id: fp.fingerprint_id,
          target_product_url: fp.target_product_url,
          target_item_id: fp.target_item_id,
          model_number: fp.model_number,
          upc_or_gtin: fp.upc_or_gtin,
          product_title: fp.product_title,
          brand: fp.brand,
          seller_kind: fp.seller_kind ?? "target",
          is_target_plus: false,
          confirmed_at: fp.confirmed_at,
          confirmed_by_user: true,
        });
      } catch {
        out[k] = v;
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Max candidates kept in cookie snapshot (matches discovery bound). */
const COOKIE_DISCOVERY_CANDIDATE_MAX = 5;

type CompactCandidate = {
  candidate_id?: string;
  tier?: string;
  decision?: string;
  title_only?: boolean;
  reasons?: string[];
  title_similarity?: number;
  matched_tcin?: string;
  matched_model?: string;
  matched_upc?: string;
  offer?: Record<string, unknown>;
};

/** Valid JSON-only discovery rows for cookie budget (never mid-string truncate). */
function slimDiscoveryForCookie(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.slice(-1).map((d) => {
    let evaluation_json = String(d.evaluation_json ?? "{}");
    let offers_json = "[]";
    try {
      const ev = JSON.parse(evaluation_json) as {
        decision?: string;
        reasons?: string[];
        match_rule_version?: string;
        exact_candidate?: CompactCandidate | null;
        candidates?: CompactCandidate[];
      };
      const compactCandidate = (candidate: CompactCandidate | null | undefined) => {
        if (!candidate?.offer) return null;
        const o = candidate.offer;
        // offer_id is required for cand_<offer_id> revalidation across instances
        const offer_id =
          o.offer_id ||
          (typeof candidate.candidate_id === "string" &&
          candidate.candidate_id.startsWith("cand_")
            ? candidate.candidate_id.slice(5)
            : candidate.candidate_id);
        return {
          candidate_id: candidate.candidate_id,
          tier: candidate.tier,
          decision: candidate.decision,
          title_only: candidate.title_only ?? false,
          reasons: (candidate.reasons ?? []).slice(0, 4),
          title_similarity: candidate.title_similarity ?? 0,
          matched_tcin: candidate.matched_tcin,
          matched_model: candidate.matched_model,
          matched_upc: candidate.matched_upc,
          offer: {
            offer_id,
            title: o.title,
            seller_kind: o.seller_kind,
            seller_text: o.seller_text,
            is_target_plus: o.is_target_plus ?? false,
            merchant_link: o.merchant_link,
            link: o.link,
            product_link: o.product_link,
            target_item_id: o.target_item_id,
            model_number: o.model_number,
            upc_or_gtin: o.upc_or_gtin,
            color: o.color,
            size: o.size,
            observed_price: o.observed_price,
            currency: o.currency ?? "USD",
            thumbnail: o.thumbnail,
            serpapi_product_id: o.serpapi_product_id,
          },
        };
      };
      const exact = ev.exact_candidate ?? null;
      const compactExact = compactCandidate(exact);
      // Multi-candidate: keep up to 6 with offer_id (uncertain product mode)
      const fromList = (ev.candidates ?? [])
        .map((candidate) => compactCandidate(candidate))
        .filter((candidate) => candidate !== null)
        .slice(0, COOKIE_DISCOVERY_CANDIDATE_MAX);
      let compactCandidates = fromList;
      if (
        compactExact &&
        !compactCandidates.some(
          (c) => c.candidate_id === compactExact.candidate_id,
        )
      ) {
        compactCandidates = [compactExact, ...compactCandidates].slice(
          0,
          COOKIE_DISCOVERY_CANDIDATE_MAX,
        );
      }
      if (compactCandidates.length === 0 && compactExact) {
        compactCandidates = [compactExact];
      }
      evaluation_json = JSON.stringify({
        match_rule_version: ev.match_rule_version ?? "match-v1",
        decision: ev.decision,
        reasons: (ev.reasons ?? []).slice(0, 4),
        candidates: compactCandidates,
        exact_candidate: compactExact,
        rejected: [],
      });
      if (compactCandidates.length > 0) {
        offers_json = JSON.stringify(compactCandidates.map((c) => c.offer));
      }
    } catch {
      evaluation_json = JSON.stringify({
        match_rule_version: "match-v1",
        decision: "MATCH_REVIEW_REQUIRED",
        reasons: ["snapshot_compact_failed"],
        candidates: [],
        rejected: [],
      });
      offers_json = "[]";
    }
    return {
      purchase_id: d.purchase_id,
      data_source: d.data_source,
      provider_status: d.provider_status,
      evaluation_json,
      offers_json,
      // Drop heavy diagnostics from cookie to leave room for multi-candidate offers
      diagnostics_json: null,
      created_at: d.created_at,
    };
  });
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
        diagnostics_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    try {
      db.exec(`ALTER TABLE enrollment_discovery ADD COLUMN diagnostics_json TEXT;`);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }

  // Re-slim discovery with valid JSON only (never blind-truncate mid-JSON)
  const discovery = slimDiscoveryForCookie(
    tableRows(db, "enrollment_discovery"),
  );

  return {
    snapshot_version: SESSION_SNAPSHOT_VERSION,
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
    // Auth tables intentionally excluded — durable AuthStore only (Lane 7.3A.2A.1R).
  };
}

function encodeSnapshot(snapshot: Snapshot): string {
  const json = JSON.stringify(snapshot);
  // Compress to fit multi-instance session cookie under browser limits.
  const deflated = deflateSync(Buffer.from(json, "utf8"), { level: 9 });
  return `z.${deflated.toString("base64url")}`;
}

function decodeSnapshot(raw: string): Snapshot | null {
  try {
    let json: string;
    if (raw.startsWith("z.")) {
      json = inflateSync(Buffer.from(raw.slice(2), "base64url")).toString(
        "utf8",
      );
    } else {
      // Legacy uncompressed base64url snapshots
      json = Buffer.from(raw, "base64url").toString("utf8");
    }
    const parsed = JSON.parse(json) as Snapshot;
    if (!parsed || !Array.isArray(parsed.purchases)) return null;
    const base = { ...emptySnapshot(), ...parsed };
    // Drop unconfirmed pre-repair demo drafts (Example Widget / 87654321).
    // Confirmed fingerprints are preserved.
    const { snapshot: migrated } = migrateSnapshotPurchases(base);
    return {
      ...emptySnapshot(),
      ...migrated,
      snapshot_version: SESSION_SNAPSHOT_VERSION,
    };
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
        diagnostics_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    try {
      db.exec(`ALTER TABLE enrollment_discovery ADD COLUMN diagnostics_json TEXT;`);
    } catch {
      /* ignore */
    }
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
  // Do not clear durable auth tables (if present on shared sqlite) — owned by AuthStore.
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

export type CookiePersistResult =
  | { ok: true; length: number }
  | { ok: false; reason: string; length?: number };

/**
 * Persist compact DB snapshot to cookie after mutations.
 * Returns success/failure so callers never redirect without session state.
 */
export async function persistDatabaseToCookie(
  db: NobuDatabase,
): Promise<CookiePersistResult> {
  // Multi-instance hosts have no shared SQLite — cookie is required.
  try {
    let snapshot = exportSnapshot(db);
    snapshot.enrollment_discovery = slimDiscoveryForCookie(
      snapshot.enrollment_discovery ?? [],
    );
    // Drop history aggressively for cookie budget
    snapshot.monitor_runs = [];
    snapshot.search_budget_ledger = [];
    if (snapshot.purchases.length > 1) {
      snapshot.purchases = snapshot.purchases.slice(-1);
    }
    const keep = new Set(snapshot.purchases.map((p) => String(p.id)));
    snapshot.product_fingerprints = snapshot.product_fingerprints.filter((f) =>
      keep.has(String(f.purchase_id)),
    );
    // Preserve match rows required by fingerprint FKs
    const matchIds = new Set(
      snapshot.product_fingerprints
        .map((f) =>
          f.product_match_id != null ? String(f.product_match_id) : "",
        )
        .filter(Boolean),
    );
    snapshot.product_matches = snapshot.product_matches.filter((m) =>
      matchIds.has(String(m.id)),
    );
    snapshot.alerts = snapshot.alerts
      .filter((a) => keep.has(String(a.purchase_id)))
      .slice(-1);
    snapshot.price_observations = snapshot.price_observations
      .filter((o) => keep.has(String(o.purchase_id)))
      .slice(-1);
    snapshot.enrollment_discovery = snapshot.enrollment_discovery.filter((d) =>
      keep.has(String(d.purchase_id)),
    );

    let encoded = encodeSnapshot(snapshot);
    if (encoded.length > MAX_COOKIE_CHARS) {
      // Emergency: keep purchase + fingerprints (monitoring) + compact discovery
      const keepIds = new Set(snapshot.purchases.slice(-1).map((p) => String(p.id)));
      snapshot = {
        purchases: snapshot.purchases.slice(-1),
        product_fingerprints: snapshot.product_fingerprints
          .filter((f) => keepIds.has(String(f.purchase_id)))
          .slice(-1)
          .map((f) => slimRow(f)),
        // Keep match rows referenced by fingerprints (FK product_match_id)
        product_matches: (() => {
          const fps = snapshot.product_fingerprints
            .filter((f) => keepIds.has(String(f.purchase_id)))
            .slice(-1);
          const matchIds = new Set(
            fps
              .map((f) =>
                f.product_match_id != null ? String(f.product_match_id) : "",
              )
              .filter(Boolean),
          );
          return snapshot.product_matches
            .filter((m) => matchIds.has(String(m.id)))
            .map((m) => slimRow(m));
        })(),
        price_observations: snapshot.price_observations
          .filter((o) => keepIds.has(String(o.purchase_id)))
          .slice(-1),
        alerts: snapshot.alerts
          .filter((a) => keepIds.has(String(a.purchase_id)))
          .slice(-1),
        monitor_runs: [],
        search_budget_ledger: [],
        enrollment_discovery: slimDiscoveryForCookie(
          snapshot.enrollment_discovery,
        ),
      };
      encoded = encodeSnapshot(snapshot);
    }

    if (encoded.length > MAX_COOKIE_CHARS) {
      console.error("nobu_cookie_persist_too_large", {
        length: encoded.length,
        max: MAX_COOKIE_CHARS,
      });
      return {
        ok: false,
        reason: "cookie_too_large",
        length: encoded.length,
      };
    }

    if (!snapshot.purchases.length) {
      // Auth is durable (not cookie). Empty purchase snapshot is a no-op success off-Vercel.
      if (!isVercelRuntime()) {
        return { ok: true, length: 0 };
      }
      return { ok: false, reason: "no_purchase_in_snapshot" };
    }

    const jar = await cookies();
    jar.set(COOKIE_NAME, encoded, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isVercelRuntime() || process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
    });
    return { ok: true, length: encoded.length };
  } catch (err) {
    console.error("nobu_cookie_persist_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    if (!isVercelRuntime()) {
      return { ok: true, length: 0 };
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "cookie_persist_failed",
    };
  }
}
