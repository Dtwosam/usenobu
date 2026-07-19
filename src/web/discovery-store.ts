/**
 * Persist enrollment discovery results for the review/confirm screen.
 * Cookie SQLite — table created on demand (no formal migration required for MVP).
 * Multi-candidate: keep up to 6 candidates with stable offer_id through compact.
 */
import type { NobuDatabase } from "../db/index.js";
import type { MatchEvaluationResult, MatchableOffer } from "../matching/index.js";
import { DISCOVERY_CANDIDATE_MAX } from "../matching/discovery-candidates.js";
import type {
  DiscoveryDataSource,
  LiveDiscoveryDiagnostics,
} from "./live-discovery.js";

export interface EnrollmentDiscoverySnapshot {
  purchase_id: string;
  data_source: DiscoveryDataSource;
  query: string | null;
  provider_status: string | null;
  evaluation: MatchEvaluationResult;
  offers: MatchableOffer[];
  diagnostics?: LiveDiscoveryDiagnostics | null;
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
      diagnostics_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  try {
    db.exec(`ALTER TABLE enrollment_discovery ADD COLUMN diagnostics_json TEXT;`);
  } catch {
    /* column already exists */
  }
}

/**
 * Compact evaluation for cookie-backed sessions.
 * Keep all confirmable candidates (bounded) so multi-candidate review works
 * across multi-instance hosts. Always preserve offer_id on each offer.
 */
function slimEvaluation(evaluation: MatchEvaluationResult): MatchEvaluationResult {
  const max = DISCOVERY_CANDIDATE_MAX;
  // Prefer exact/strong confirmable rows; fall back to full candidate list bound
  const preferred = evaluation.candidates.filter(
    (c) =>
      c.decision === "EXACT_MATCH_CANDIDATE" ||
      evaluation.exact_candidate?.candidate_id === c.candidate_id ||
      c.title_only,
  );
  let candidates =
    preferred.length > 0
      ? preferred.slice(0, max)
      : evaluation.candidates.slice(0, max);

  if (
    evaluation.exact_candidate &&
    !candidates.some(
      (c) => c.candidate_id === evaluation.exact_candidate!.candidate_id,
    )
  ) {
    candidates = [evaluation.exact_candidate, ...candidates].slice(0, max);
  }

  // Ensure every candidate keeps offer_id (required for cand_ revalidation)
  candidates = candidates.map((c) => ({
    ...c,
    offer: {
      ...c.offer,
      offer_id:
        c.offer.offer_id ||
        (c.candidate_id.startsWith("cand_")
          ? c.candidate_id.slice(5)
          : c.candidate_id),
    },
  }));

  return {
    match_rule_version: evaluation.match_rule_version,
    decision: evaluation.decision,
    reasons: evaluation.reasons.slice(0, 8),
    candidates,
    exact_candidate: evaluation.exact_candidate
      ? {
          ...evaluation.exact_candidate,
          offer: {
            ...evaluation.exact_candidate.offer,
            offer_id:
              evaluation.exact_candidate.offer.offer_id ||
              (evaluation.exact_candidate.candidate_id.startsWith("cand_")
                ? evaluation.exact_candidate.candidate_id.slice(5)
                : evaluation.exact_candidate.candidate_id),
          },
        }
      : evaluation.exact_candidate,
    rejected: [],
  };
}

export function saveEnrollmentDiscovery(
  db: NobuDatabase,
  snap: EnrollmentDiscoverySnapshot,
): void {
  ensureEnrollmentDiscoveryTable(db);
  const evaluation = slimEvaluation(snap.evaluation);
  // Offers for every kept candidate — required for server-side revalidation
  const offerById = new Map<string, MatchableOffer>();
  for (const o of snap.offers) {
    if (o.offer_id) offerById.set(String(o.offer_id), o);
  }
  const offers: MatchableOffer[] = evaluation.candidates.map((c) => {
    const fromOffer = c.offer.offer_id
      ? offerById.get(String(c.offer.offer_id))
      : undefined;
    const base = fromOffer ?? c.offer;
    return {
      ...base,
      offer_id:
        base.offer_id ||
        c.offer.offer_id ||
        (c.candidate_id.startsWith("cand_")
          ? c.candidate_id.slice(5)
          : c.candidate_id),
    };
  });

  db.prepare(
    `INSERT INTO enrollment_discovery (
      purchase_id, data_source, query, provider_status,
      evaluation_json, offers_json, diagnostics_json, created_at
    ) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(purchase_id) DO UPDATE SET
      data_source = excluded.data_source,
      query = excluded.query,
      provider_status = excluded.provider_status,
      evaluation_json = excluded.evaluation_json,
      offers_json = excluded.offers_json,
      diagnostics_json = excluded.diagnostics_json,
      created_at = excluded.created_at`,
  ).run(
    snap.purchase_id,
    snap.data_source,
    snap.query,
    snap.provider_status,
    JSON.stringify(evaluation),
    JSON.stringify(offers),
    snap.diagnostics ? JSON.stringify(snap.diagnostics) : null,
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
              evaluation_json, offers_json, diagnostics_json, created_at
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
        diagnostics_json: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  try {
    const evaluation = JSON.parse(row.evaluation_json) as MatchEvaluationResult;
    let offers: MatchableOffer[] = [];
    try {
      offers = JSON.parse(row.offers_json || "[]") as MatchableOffer[];
    } catch {
      offers = evaluation.exact_candidate
        ? [evaluation.exact_candidate.offer]
        : (evaluation.candidates ?? []).map((c) => c.offer);
    }
    return {
      purchase_id: row.purchase_id,
      data_source: row.data_source as DiscoveryDataSource,
      query: row.query,
      provider_status: row.provider_status,
      evaluation,
      offers,
      diagnostics: row.diagnostics_json
        ? (JSON.parse(row.diagnostics_json) as LiveDiscoveryDiagnostics)
        : null,
      created_at: row.created_at,
    };
  } catch {
    // Corrupt cookie snapshot — fail closed without crashing the page
    return null;
  }
}
