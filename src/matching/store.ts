import type { NobuDatabase } from "../db/migrator.js";
import type { LockedProductFingerprint } from "../domain/product-fingerprint.js";
import { MatchLifecycle } from "../domain/enums.js";
import { confirmProductMatch, newMatchRowId, type ConfirmMatchInput } from "./confirm.js";
import { MATCH_RULE_VERSION } from "./rules.js";
import type { MatchEvaluationResult, PurchaseMatchReference, ScoredCandidate } from "./types.js";

export interface PersistCandidatesInput {
  db: NobuDatabase;
  purchaseId: string;
  evaluation: MatchEvaluationResult;
  now?: string;
}

/** Persist scored candidates / rejections for a purchase (no confirmation yet). */
export function persistMatchEvaluation(input: PersistCandidatesInput): string[] {
  const now = input.now ?? new Date().toISOString();
  const ids: string[] = [];
  const insert = input.db.prepare(
    `INSERT INTO product_matches (
      id, purchase_id, lifecycle, fingerprint_id, seller_kind, seller_text,
      product_title, product_url, target_item_id, model_number, upc_or_gtin,
      brand, size, color, weight, quantity, observed_price, currency,
      is_target_plus, confirmed_at, fingerprint_json, created_at,
      serpapi_product_id, match_decision, match_tier, match_rule_version, rejection_reason
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )`,
  );

  for (const c of [...input.evaluation.candidates, ...input.evaluation.rejected]) {
    const id = c.candidate_id.startsWith("cand_")
      ? c.candidate_id.replace(/^cand_/, "pm_")
      : newMatchRowId();
    const lifecycle =
      c.decision === "REJECTED"
        ? MatchLifecycle.REJECTED
        : MatchLifecycle.CANDIDATE;
    insert.run(
      id,
      input.purchaseId,
      lifecycle,
      null,
      String(c.offer.seller_kind),
      c.offer.seller_text,
      c.offer.title,
      c.offer.merchant_link || c.offer.link || c.offer.product_link || "",
      c.matched_tcin ?? c.offer.target_item_id ?? null,
      c.matched_model ?? c.offer.model_number ?? null,
      c.matched_upc ?? c.offer.upc_or_gtin ?? null,
      c.offer.brand ?? null,
      c.offer.size ?? null,
      c.offer.color ?? null,
      c.offer.weight ?? null,
      c.offer.quantity ?? null,
      c.offer.observed_price ?? null,
      c.offer.currency ?? null,
      c.offer.is_target_plus ? 1 : 0,
      null,
      null,
      now,
      c.offer.serpapi_product_id ?? null,
      c.decision,
      c.tier,
      input.evaluation.match_rule_version,
      c.decision === "REJECTED" ? c.reasons.join("|") : null,
    );
    ids.push(id);
  }
  return ids;
}

export interface ConfirmAndPersistInput {
  db: NobuDatabase;
  purchase: PurchaseMatchReference & { purchase_id: string };
  candidate: ScoredCandidate;
  confirmed_at?: string;
  product_match_id?: string;
}

/**
 * Truthful, scheduler-ineligible pre-payment purchase status. Only Lane 7.4D
 * `START_MONITORING`, after verified payment, may transition a purchase to
 * `MONITORING_ACTIVE` — see `selectActivePurchases` /
 * `loadScheduleRows`, both of which select on `status === "MONITORING_ACTIVE"`
 * only, so any other status (including this one) is automatically excluded.
 */
export const MONITORING_PAYMENT_READY_STATUS = "MONITORING_PAYMENT_READY";

/**
 * Shared persistence: create the locked fingerprint, persist match +
 * fingerprint rows, and set the purchase's final status. Never call directly
 * from outside this module — use `confirmAndPersistLockedFingerprint` (web,
 * activates monitoring immediately) or
 * `confirmAndPersistLockedFingerprintPending` (agent pre-payment path, never
 * activates monitoring) so the activation decision stays explicit at the
 * call site.
 */
function persistConfirmedFingerprint(
  input: ConfirmAndPersistInput,
  finalStatus: string,
): LockedProductFingerprint {
  const confirmed = confirmProductMatch({
    purchase: input.purchase,
    candidate: input.candidate,
    confirmed_by_user: true,
    confirmed_at: input.confirmed_at,
  } satisfies ConfirmMatchInput);

  const fp = confirmed.fingerprint;
  const now = fp.confirmed_at;
  const matchId = input.product_match_id ?? newMatchRowId();

  input.db
    .prepare(
      `INSERT INTO product_matches (
        id, purchase_id, lifecycle, fingerprint_id, seller_kind, seller_text,
        product_title, product_url, target_item_id, model_number, upc_or_gtin,
        brand, size, color, weight, quantity, observed_price, currency,
        is_target_plus, confirmed_at, fingerprint_json, created_at,
        serpapi_product_id, match_decision, match_tier, match_rule_version, rejection_reason
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )`,
    )
    .run(
      matchId,
      input.purchase.purchase_id,
      MatchLifecycle.LOCKED,
      fp.fingerprint_id,
      "target",
      input.candidate.offer.seller_text,
      fp.product_title ?? input.candidate.offer.title,
      fp.target_product_url,
      fp.target_item_id ?? null,
      fp.model_number ?? null,
      fp.upc_or_gtin ?? null,
      fp.brand ?? null,
      fp.size ?? null,
      fp.color ?? null,
      fp.weight ?? null,
      fp.quantity ?? null,
      input.candidate.offer.observed_price ?? null,
      input.candidate.offer.currency ?? null,
      0,
      now,
      JSON.stringify(fp),
      now,
      input.candidate.offer.serpapi_product_id ?? null,
      "EXACT_MATCH_CANDIDATE",
      confirmed.match_tier,
      MATCH_RULE_VERSION,
      null,
    );

  input.db
    .prepare(
      `INSERT INTO product_fingerprints (
        fingerprint_id, purchase_id, product_match_id, target_product_url,
        target_item_id, model_number, upc_or_gtin, brand, size, color, weight,
        quantity, product_title, seller_kind, is_target_plus, match_rule_version,
        match_tier, fingerprint_json, confirmed_at, confirmed_by_user, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      fp.fingerprint_id,
      input.purchase.purchase_id,
      matchId,
      fp.target_product_url,
      fp.target_item_id ?? null,
      fp.model_number ?? null,
      fp.upc_or_gtin ?? null,
      fp.brand ?? null,
      fp.size ?? null,
      fp.color ?? null,
      fp.weight ?? null,
      fp.quantity ?? null,
      fp.product_title ?? null,
      "target",
      0,
      MATCH_RULE_VERSION,
      confirmed.match_tier,
      JSON.stringify(fp),
      now,
      1,
      now,
    );

  input.db
    .prepare(
      `UPDATE purchases
       SET fingerprint_id = ?, status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(fp.fingerprint_id, finalStatus, now, input.purchase.purchase_id);

  return fp;
}

/**
 * Confirm user selection, create locked fingerprint, persist match + purchase
 * update, and activate monitoring immediately. Monitoring must not start
 * without this step (Lane 5 consumes fingerprint_id). Used by the consumer
 * web confirmation flow only — unchanged since before Lane 7.4C.1.
 */
export function confirmAndPersistLockedFingerprint(
  input: ConfirmAndPersistInput,
): LockedProductFingerprint {
  return persistConfirmedFingerprint(input, "MONITORING_ACTIVE");
}

/**
 * Lane 7.4C.1 — agent-native pre-payment path. Locks the fingerprint and
 * persists match/fingerprint rows exactly like
 * `confirmAndPersistLockedFingerprint`, but leaves the purchase in the
 * truthful, scheduler-ineligible `MONITORING_PAYMENT_READY_STATUS` instead
 * of `MONITORING_ACTIVE`. Only Lane 7.4D `START_MONITORING`, after verified
 * payment, may transition the purchase to `MONITORING_ACTIVE`.
 */
export function confirmAndPersistLockedFingerprintPending(
  input: ConfirmAndPersistInput,
): LockedProductFingerprint {
  return persistConfirmedFingerprint(input, MONITORING_PAYMENT_READY_STATUS);
}

export function getLockedFingerprint(
  db: NobuDatabase,
  fingerprintId: string,
): LockedProductFingerprint | null {
  const row = db
    .prepare(
      `SELECT fingerprint_json FROM product_fingerprints WHERE fingerprint_id = ?`,
    )
    .get(fingerprintId) as { fingerprint_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.fingerprint_json) as LockedProductFingerprint;
}
