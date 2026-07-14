import {
  generateTargetOnlyCandidates,
  offerMatchesLockedFingerprint,
  type TargetMatchFingerprint,
} from "../matching/index.js";
import type { MatchableOffer } from "../matching/types.js";
import { DEFAULT_POLICY_DISCLAIMER } from "../policy/target-us-policy.js";

export interface ObservationMatchResult {
  match_ok: boolean;
  ambiguous: boolean;
  matched_offer?: MatchableOffer;
  match_reasons: string[];
  observed_price?: number;
  potential_recovery?: number;
  suppress_alert_reason?: string;
}

/**
 * Validate observation offers against the locked fingerprint only.
 * Ambiguous multi-match and mismatches fail closed (no alert).
 */
export function evaluateObservationAgainstFingerprint(args: {
  fingerprint: TargetMatchFingerprint;
  offers: readonly MatchableOffer[];
  purchase_price: number;
}): ObservationMatchResult {
  const targetOnly = generateTargetOnlyCandidates([...args.offers]);
  const matches: Array<{ offer: MatchableOffer; reasons: string[] }> = [];

  for (const offer of targetOnly) {
    const r = offerMatchesLockedFingerprint(args.fingerprint, offer);
    if (r.match) {
      matches.push({ offer, reasons: r.reasons });
    }
  }

  if (matches.length === 0) {
    return {
      match_ok: false,
      ambiguous: false,
      match_reasons: ["no_locked_fingerprint_match"],
      suppress_alert_reason: "mismatch_or_no_target_match",
    };
  }

  if (matches.length > 1) {
    // Distinct identity keys → ambiguous
    const keys = new Set(
      matches.map(
        (m) =>
          m.offer.target_item_id ||
          m.offer.model_number ||
          m.offer.serpapi_product_id ||
          m.offer.title,
      ),
    );
    if (keys.size > 1) {
      return {
        match_ok: false,
        ambiguous: true,
        match_reasons: ["ambiguous_multiple_locked_matches"],
        suppress_alert_reason: "ambiguous_observation",
      };
    }
  }

  const best = matches[0]!;
  const price = best.offer.observed_price;
  if (price === null || price === undefined || !(price > 0)) {
    return {
      match_ok: true,
      ambiguous: false,
      matched_offer: best.offer,
      match_reasons: best.reasons,
      suppress_alert_reason: "missing_usable_price",
    };
  }

  if (price >= args.purchase_price) {
    return {
      match_ok: true,
      ambiguous: false,
      matched_offer: best.offer,
      match_reasons: best.reasons,
      observed_price: price,
      potential_recovery: 0,
      suppress_alert_reason: "price_not_lower",
    };
  }

  const recovery =
    Math.round((args.purchase_price - price) * 100) / 100;

  return {
    match_ok: true,
    ambiguous: false,
    matched_offer: best.offer,
    match_reasons: best.reasons,
    observed_price: price,
    potential_recovery: recovery,
  };
}

export function buildAlertDisclaimer(): string {
  return DEFAULT_POLICY_DISCLAIMER;
}

export function computePotentialRecovery(
  purchasePrice: number,
  observedPrice: number,
): number {
  if (!(purchasePrice > 0) || !(observedPrice > 0)) return 0;
  if (observedPrice >= purchasePrice) return 0;
  return Math.round((purchasePrice - observedPrice) * 100) / 100;
}
