/**
 * Persist enrollment discovery results for the review/confirm screen.
 * Cookie SQLite — table created on demand (no formal migration required for MVP).
 */
import type { NobuDatabase } from "../db/index.js";
import type { MatchEvaluationResult, MatchableOffer } from "../matching/index.js";
import type { DiscoveryDataSource } from "./live-discovery.js";

export interface EnrollmentDiscoverySnapshot {
  purchase_id: string;
  data_source: DiscoveryDataSource;
  query: string | null;
  provider_status: string | null;
  evaluation: MatchEvaluationResult;
  offers: MatchableOffer[];
  created_at: string;
}

export function ensureEnrollmentDiscoveryTable(db: NobuDatabase): void {
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
}

/** Compact evaluation for cookie-backed sessions (keep confirmable candidate). */
function slimEvaluation(evaluation: MatchEvaluationResult): MatchEvaluationResult {
  const candidates = evaluation.candidates
    .filter(
      (c) =>
        c.decision === "EXACT_MATCH_CANDIDATE" ||
        evaluation.exact_candidate?.candidate_id === c.candidate_id,
    )
    .slice(0, 3);
  // Always include exact_candidate in candidates list if present
  if (
    evaluation.exact_candidate &&
    !candidates.some(
      (c) => c.candidate_id === evaluation.exact_candidate!.candidate_id,
    )
  ) {
    candidates.unshift(evaluation.exact_candidate);
  }
  return {
    match_rule_version: evaluation.match_rule_version,
    decision: evaluation.decision,
    reasons: evaluation.reasons.slice(0, 8),
    candidates: candidates.length
      ? candidates
      : evaluation.candidates.slice(0, 2),
    exact_candidate: evaluation.exact_candidate,
    rejected: [],
  };
}

export function saveEnrollmentDiscovery(
  db: NobuDatabase,
  snap: EnrollmentDiscoverySnapshot,
): void {
  ensureEnrollmentDiscoveryTable(db);
  const evaluation = slimEvaluation(snap.evaluation);
  // Offers only for exact/strong candidates — cookie budget
  const offers =
    evaluation.exact_candidate != null
      ? [evaluation.exact_candidate.offer]
      : evaluation.candidates.slice(0, 2).map((c) => c.offer);
  db.prepare(
    `INSERT INTO enrollment_discovery (
      purchase_id, data_source, query, provider_status,
      evaluation_json, offers_json, created_at
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(purchase_id) DO UPDATE SET
      data_source = excluded.data_source,
      query = excluded.query,
      provider_status = excluded.provider_status,
      evaluation_json = excluded.evaluation_json,
      offers_json = excluded.offers_json,
      created_at = excluded.created_at`,
  ).run(
    snap.purchase_id,
    snap.data_source,
    snap.query,
    snap.provider_status,
    JSON.stringify(evaluation),
    JSON.stringify(offers),
    snap.created_at,
  );
}

export function loadEnrollmentDiscovery(
  db: NobuDatabase,
  purchaseId: string,
): EnrollmentDiscoverySnapshot | null {
  ensureEnrollmentDiscoveryTable(db);
  const row = db
    .prepare(
      `SELECT purchase_id, data_source, query, provider_status,
              evaluation_json, offers_json, created_at
       FROM enrollment_discovery WHERE purchase_id = ?`,
    )
    .get(purchaseId) as
    | {
        purchase_id: string;
        data_source: string;
        query: string | null;
        provider_status: string | null;
        evaluation_json: string;
        offers_json: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    purchase_id: row.purchase_id,
    data_source: row.data_source as DiscoveryDataSource,
    query: row.query,
    provider_status: row.provider_status,
    evaluation: JSON.parse(row.evaluation_json) as MatchEvaluationResult,
    offers: JSON.parse(row.offers_json) as MatchableOffer[],
    created_at: row.created_at,
  };
}
