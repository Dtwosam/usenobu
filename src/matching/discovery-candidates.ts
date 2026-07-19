/**
 * Uncertain-product multi-candidate discovery presentation.
 * Surfaces Target-seller offers with stable identity for explicit user selection.
 * Never auto-confirms. Title-only offers remain non-confirmable.
 */
import {
  extractTcinFromTargetUrl,
  normalizeModel,
  normalizeTargetProductUrl,
  normalizeUpc,
  titleSimilarity,
} from "./identity.js";
import { generateTargetOnlyCandidates, toMatchableOffer } from "./candidates.js";
import {
  isStrongMatchTier,
  MATCH_RULE_VERSION,
  MatchDecision,
  MatchTier,
} from "./rules.js";
import type {
  MatchableOffer,
  MatchEvaluationResult,
  PurchaseMatchReference,
  ScoredCandidate,
} from "./types.js";
import type { NormalizedShoppingOffer } from "../serpapi/types.js";

/** Bounded multi-candidate list for review (3–5 useful when available). */
export const DISCOVERY_CANDIDATE_MIN = 3;
export const DISCOVERY_CANDIDATE_MAX = 5;

function offerStableTcin(offer: MatchableOffer): string | null {
  return (
    offer.target_item_id?.trim() ||
    extractTcinFromTargetUrl(offer.merchant_link) ||
    extractTcinFromTargetUrl(offer.link) ||
    extractTcinFromTargetUrl(offer.product_link) ||
    null
  );
}

function offerTargetUrl(offer: MatchableOffer): string | null {
  return (
    normalizeTargetProductUrl(offer.merchant_link) ||
    normalizeTargetProductUrl(offer.link) ||
    normalizeTargetProductUrl(offer.product_link) ||
    null
  );
}

/** True when the offer has a confirmable identity signal (not title alone). */
export function offerHasStableIdentity(offer: MatchableOffer): boolean {
  return Boolean(
    offerStableTcin(offer) ||
      offerTargetUrl(offer) ||
      normalizeModel(offer.model_number) ||
      normalizeUpc(offer.upc_or_gtin),
  );
}

function discoveryDedupKey(offer: MatchableOffer): string {
  const tcin = offerStableTcin(offer);
  if (tcin) return `tcin:${tcin}`;
  const url = offerTargetUrl(offer);
  if (url) return `url:${url}`;
  const model = normalizeModel(offer.model_number);
  if (model) return `model:${model}`;
  const upc = normalizeUpc(offer.upc_or_gtin);
  if (upc) return `upc:${upc}`;
  return `title:${offer.title.trim().toLowerCase()}`;
}

/**
 * Collapse materially identical Target offers (same TCIN/URL/model/UPC).
 * Prefers lower observed price, then richer identity fields.
 */
export function dedupeDiscoveryOffers(
  offers: ReadonlyArray<MatchableOffer>,
): MatchableOffer[] {
  const byKey = new Map<string, MatchableOffer>();
  for (const offer of offers) {
    const key = discoveryDedupKey(offer);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, offer);
      continue;
    }
    const prefer =
      rankDiscoveryOffer(offer) > rankDiscoveryOffer(existing) ? offer : existing;
    // Same key: keep the preferred representative
    byKey.set(key, prefer);
  }
  return [...byKey.values()];
}

function rankDiscoveryOffer(offer: MatchableOffer): number {
  let score = 0;
  if (offerStableTcin(offer)) score += 40;
  if (offerTargetUrl(offer)) score += 20;
  if (normalizeModel(offer.model_number)) score += 10;
  if (normalizeUpc(offer.upc_or_gtin)) score += 10;
  if (offer.thumbnail) score += 3;
  if (offer.observed_price != null) score += 2;
  // Prefer lower price among equals (subtract normalized price component)
  if (offer.observed_price != null) {
    score += Math.max(0, 5 - Math.min(offer.observed_price / 100, 5));
  }
  return score;
}

/**
 * Score one Target offer for uncertain-product discovery presentation.
 * Uses the offer's own stable identity — purchase URL/TCIN may be absent.
 */
export function scoreDiscoveryOffer(
  purchase: PurchaseMatchReference,
  offer: MatchableOffer,
): ScoredCandidate {
  const candidate_id = offer.offer_id
    ? `cand_${offer.offer_id}`
    : `cand_${discoveryDedupKey(offer).replace(/[^a-z0-9]/gi, "").slice(0, 16)}`;
  const sim = purchase.product_title
    ? titleSimilarity(purchase.product_title, offer.title)
    : 0;

  if (offer.is_target_plus) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.NONE,
      decision: MatchDecision.REJECTED,
      reasons: ["target_plus_excluded"],
      title_similarity: sim,
      title_only: false,
    };
  }
  if (offer.seller_kind !== "target") {
    return {
      candidate_id,
      offer,
      tier: MatchTier.NONE,
      decision: MatchDecision.REJECTED,
      reasons: ["non_target_seller", String(offer.seller_kind)],
      title_similarity: sim,
      title_only: false,
    };
  }

  const tcin = offerStableTcin(offer);
  const url = offerTargetUrl(offer);
  const model = normalizeModel(offer.model_number);
  const upc = normalizeUpc(offer.upc_or_gtin);

  if (url && tcin) {
    return {
      candidate_id,
      offer: { ...offer, target_item_id: offer.target_item_id || tcin },
      tier: MatchTier.EXACT_TARGET_URL,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: ["discovery_target_url", "discovery_tcin"],
      title_similarity: sim,
      title_only: false,
      matched_tcin: tcin,
      matched_model: model ?? undefined,
      matched_upc: upc ?? undefined,
    };
  }
  if (tcin) {
    return {
      candidate_id,
      offer: { ...offer, target_item_id: offer.target_item_id || tcin },
      tier: MatchTier.EXACT_TCIN,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: ["discovery_tcin"],
      title_similarity: sim,
      title_only: false,
      matched_tcin: tcin,
      matched_model: model ?? undefined,
      matched_upc: upc ?? undefined,
    };
  }
  if (model) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.EXACT_MODEL_VARIANT,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: ["discovery_model"],
      title_similarity: sim,
      title_only: false,
      matched_model: model,
      matched_upc: upc ?? undefined,
    };
  }
  if (upc) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.EXACT_UPC,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: ["discovery_upc"],
      title_similarity: sim,
      title_only: false,
      matched_upc: upc,
    };
  }

  // Title-only — showable for context but never confirmable
  if (purchase.product_title && sim >= 0.2) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.TITLE_ONLY,
      decision: MatchDecision.MATCH_REVIEW_REQUIRED,
      reasons: ["title_only_insufficient", `similarity=${sim.toFixed(3)}`],
      title_similarity: sim,
      title_only: true,
    };
  }

  return {
    candidate_id,
    offer,
    tier: MatchTier.NONE,
    decision: MatchDecision.MATCH_REVIEW_REQUIRED,
    reasons: ["no_stable_discovery_identity"],
    title_similarity: sim,
    title_only: false,
  };
}

/**
 * Build a bounded multi-candidate evaluation for uncertain-product mode.
 * - Target seller only; Target Plus excluded
 * - Deduplicate materially identical offers
 * - Bound to DISCOVERY_CANDIDATE_MAX
 * - Never auto-selects exact_candidate when multiple strong options exist
 */
export function evaluateUncertainProductDiscovery(
  purchase: PurchaseMatchReference,
  offers: ReadonlyArray<NormalizedShoppingOffer | MatchableOffer>,
): MatchEvaluationResult {
  const targetOnly = generateTargetOnlyCandidates(offers);
  const rejectedNonTarget: ScoredCandidate[] = [];
  for (const raw of offers) {
    const asMatchable = toMatchableOffer(
      raw as NormalizedShoppingOffer | MatchableOffer,
    );
    if (
      asMatchable.is_target_plus ||
      asMatchable.seller_kind !== "target"
    ) {
      rejectedNonTarget.push(scoreDiscoveryOffer(purchase, asMatchable));
    }
  }

  const deduped = dedupeDiscoveryOffers(targetOnly);
  const scoredAll = deduped.map((o) => scoreDiscoveryOffer(purchase, o));

  // Prefer strong identity first, then higher title similarity, then lower price
  const ranked = [...scoredAll].sort((a, b) => {
    const aStrong = isStrongMatchTier(a.tier) ? 1 : 0;
    const bStrong = isStrongMatchTier(b.tier) ? 1 : 0;
    if (bStrong !== aStrong) return bStrong - aStrong;
    if (b.title_similarity !== a.title_similarity) {
      return b.title_similarity - a.title_similarity;
    }
    const ap = a.offer.observed_price ?? Number.POSITIVE_INFINITY;
    const bp = b.offer.observed_price ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });

  const candidates = ranked.slice(0, DISCOVERY_CANDIDATE_MAX);
  const strong = candidates.filter(
    (c) =>
      c.decision === MatchDecision.EXACT_MATCH_CANDIDATE &&
      !c.title_only &&
      isStrongMatchTier(c.tier),
  );

  if (strong.length === 1 && candidates.length === 1) {
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: ["single_discovery_candidate", ...strong[0]!.reasons],
      candidates,
      exact_candidate: strong[0],
      rejected: rejectedNonTarget,
    };
  }

  if (strong.length >= 1) {
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.MATCH_REVIEW_REQUIRED,
      reasons: [
        "uncertain_product_multi_candidate",
        `candidate_count=${candidates.length}`,
        `strong_count=${strong.length}`,
      ],
      candidates,
      // Never auto-pick among multiple discovery candidates
      exact_candidate: undefined,
      rejected: rejectedNonTarget,
    };
  }

  if (candidates.length === 0) {
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.MATCH_REVIEW_REQUIRED,
      reasons: ["no_target_candidates"],
      candidates: [],
      rejected: rejectedNonTarget,
    };
  }

  return {
    match_rule_version: MATCH_RULE_VERSION,
    decision: MatchDecision.MATCH_REVIEW_REQUIRED,
    reasons: ["title_only_or_weak_discovery"],
    candidates,
    rejected: rejectedNonTarget,
  };
}
