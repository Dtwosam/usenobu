import { extractTcinFromTargetUrl, isTargetComUrl } from "./identity.js";
import {
  normalizeModel,
  normalizeTargetProductUrl,
  normalizeUpc,
  normalizeVariant,
  titleSimilarity,
} from "./identity.js";
import { generateTargetOnlyCandidates, newCandidateId } from "./candidates.js";
import {
  isStrongMatchTier,
  MATCH_RULE_VERSION,
  MatchDecision,
  MatchTier,
  type MatchTier as MatchTierType,
} from "./rules.js";
import type {
  MatchableOffer,
  MatchEvaluationResult,
  PurchaseMatchReference,
  ScoredCandidate,
} from "./types.js";
import type { NormalizedShoppingOffer } from "../serpapi/types.js";

/**
 * Score a single Target-seller offer against the purchase reference.
 * SerpApi product_id is never used as TCIN.
 */
export function scoreOfferAgainstPurchase(
  purchase: PurchaseMatchReference,
  offer: MatchableOffer,
): ScoredCandidate {
  const candidate_id = newCandidateId();
  const reasons: string[] = [];
  const sim = purchase.product_title
    ? titleSimilarity(purchase.product_title, offer.title)
    : 0;

  // Hard rejects first
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

  // Variant conflicts fail closed when both sides assert different values
  const variantConflict = detectVariantConflict(purchase, offer);
  if (variantConflict) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.NONE,
      decision: MatchDecision.REJECTED,
      reasons: ["variant_mismatch", variantConflict],
      title_similarity: sim,
      title_only: false,
    };
  }

  const purchaseTcin =
    purchase.target_item_id?.trim() ||
    extractTcinFromTargetUrl(purchase.target_product_url) ||
    null;
  const offerTcin =
    offer.target_item_id?.trim() ||
    extractTcinFromTargetUrl(offer.merchant_link) ||
    extractTcinFromTargetUrl(offer.link) ||
    null;

  const purchaseUrl = normalizeTargetProductUrl(purchase.target_product_url);
  const offerUrl =
    normalizeTargetProductUrl(offer.merchant_link) ||
    normalizeTargetProductUrl(offer.link);

  const purchaseModel = normalizeModel(purchase.model_number);
  // Structured model first; model-from-title only when title is highly similar
  // to the purchase title (blocks accessory false positives).
  const structuredModel = normalizeModel(offer.model_number);
  const titleSimForModel = purchase.product_title
    ? titleSimilarity(purchase.product_title, offer.title)
    : 0;
  const modelFromTitle =
    !structuredModel &&
    purchaseModel &&
    purchase.product_title &&
    titleSimForModel >= 0.72
      ? extractModelFromTitle(offer.title, purchaseModel)
      : null;
  const offerModel = structuredModel || modelFromTitle;

  const purchaseUpc = normalizeUpc(purchase.upc_or_gtin);
  const offerUpc = normalizeUpc(offer.upc_or_gtin);

  // Hierarchy: URL → TCIN → model+variant → UPC → title-only
  if (purchaseUrl && offerUrl && purchaseUrl === offerUrl) {
    reasons.push("exact_target_url");
    return strongResult(
      candidate_id,
      offer,
      MatchTier.EXACT_TARGET_URL,
      reasons,
      sim,
      { matched_tcin: offerTcin ?? purchaseTcin ?? undefined },
    );
  }

  if (purchaseTcin && offerTcin && purchaseTcin === offerTcin) {
    reasons.push("exact_tcin");
    // Guard: serpapi product_id must not equal tcin claim without Target URL
    if (
      offer.serpapi_product_id &&
      offer.serpapi_product_id === purchaseTcin &&
      !offerTcin
    ) {
      // unreachable if offerTcin set from serpapi — we never set it that way
    }
    return strongResult(
      candidate_id,
      offer,
      MatchTier.EXACT_TCIN,
      reasons,
      sim,
      { matched_tcin: offerTcin },
    );
  }

  // Reject wrong TCIN when both present and differ
  if (purchaseTcin && offerTcin && purchaseTcin !== offerTcin) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.NONE,
      decision: MatchDecision.REJECTED,
      reasons: ["wrong_tcin", `purchase=${purchaseTcin}`, `offer=${offerTcin}`],
      title_similarity: sim,
      title_only: false,
    };
  }

  if (purchaseModel && offerModel && purchaseModel === offerModel) {
    reasons.push("exact_model");
    reasons.push("variants_compatible");
    return strongResult(
      candidate_id,
      offer,
      MatchTier.EXACT_MODEL_VARIANT,
      reasons,
      sim,
      { matched_model: purchaseModel, matched_tcin: offerTcin ?? undefined },
    );
  }

  if (purchaseModel && offerModel && purchaseModel !== offerModel) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.NONE,
      decision: MatchDecision.REJECTED,
      reasons: [
        "wrong_model",
        `purchase=${purchaseModel}`,
        `offer=${offerModel}`,
      ],
      title_similarity: sim,
      title_only: false,
    };
  }

  // If purchase has model but offer has no model signal → cannot strong-match on model
  if (purchaseUpc && offerUpc && purchaseUpc === offerUpc) {
    reasons.push("exact_upc");
    return strongResult(
      candidate_id,
      offer,
      MatchTier.EXACT_UPC,
      reasons,
      sim,
      { matched_upc: purchaseUpc },
    );
  }

  if (purchaseUpc && offerUpc && purchaseUpc !== offerUpc) {
    return {
      candidate_id,
      offer,
      tier: MatchTier.NONE,
      decision: MatchDecision.REJECTED,
      reasons: ["wrong_upc"],
      title_similarity: sim,
      title_only: false,
    };
  }

  // Title-only path — never exact candidate; requires a purchase title to compare
  const titleOnly = Boolean(purchase.product_title) && sim >= 0.35;

  if (titleOnly) {
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
    reasons: ["no_strong_identity_match"],
    title_similarity: sim,
    title_only: false,
  };
}

function strongResult(
  candidate_id: string,
  offer: MatchableOffer,
  tier: MatchTierType,
  reasons: string[],
  sim: number,
  extra: Partial<ScoredCandidate>,
): ScoredCandidate {
  return {
    candidate_id,
    offer,
    tier,
    decision: MatchDecision.EXACT_MATCH_CANDIDATE,
    reasons,
    title_similarity: sim,
    title_only: false,
    ...extra,
  };
}

function detectVariantConflict(
  purchase: PurchaseMatchReference,
  offer: MatchableOffer,
): string | null {
  const pairs: Array<[string, string | null | undefined, string | null | undefined]> = [
    ["size", purchase.size, offer.size],
    ["color", purchase.color, offer.color],
    ["weight", purchase.weight, offer.weight],
    ["quantity", purchase.quantity, offer.quantity],
  ];
  for (const [name, p, o] of pairs) {
    const np = normalizeVariant(p);
    const no = normalizeVariant(o);
    if (np && no && np !== no) {
      return `${name}:${np}!=${no}`;
    }
  }
  return null;
}

/**
 * If the purchase model appears as a whole title token, treat as model signal.
 * Does not invent models. Callers must also gate on title similarity.
 */
function extractModelFromTitle(
  title: string,
  purchaseModelNormalized: string,
): string | null {
  const tokens = title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.includes(purchaseModelNormalized)) {
    return purchaseModelNormalized;
  }
  return null;
}

/** Prefer Target URL / TCIN, then higher title similarity, then lower price. */
function pickBestStrongCandidate(strong: ScoredCandidate[]): ScoredCandidate {
  const ranked = [...strong].sort((a, b) => {
    const aUrl = a.tier === MatchTier.EXACT_TARGET_URL || a.tier === MatchTier.EXACT_TCIN ? 1 : 0;
    const bUrl = b.tier === MatchTier.EXACT_TARGET_URL || b.tier === MatchTier.EXACT_TCIN ? 1 : 0;
    if (bUrl !== aUrl) return bUrl - aUrl;
    if (b.title_similarity !== a.title_similarity) {
      return b.title_similarity - a.title_similarity;
    }
    const ap = a.offer.observed_price ?? Number.POSITIVE_INFINITY;
    const bp = b.offer.observed_price ?? Number.POSITIVE_INFINITY;
    return ap - bp;
  });
  return ranked[0]!;
}

function offerTcin(c: ScoredCandidate): string | null {
  return (
    c.matched_tcin?.trim() ||
    c.offer.target_item_id?.trim() ||
    null
  );
}

function offerModelKey(c: ScoredCandidate): string | null {
  return (
    c.matched_model?.trim() ||
    normalizeModel(c.offer.model_number) ||
    null
  );
}

function offerUpcKey(c: ScoredCandidate): string | null {
  return c.matched_upc?.trim() || normalizeUpc(c.offer.upc_or_gtin) || null;
}

/** Accessory-like titles (cases, keychains) must not merge with the main SKU. */
function titleLooksAccessory(title: string): boolean {
  return /\b(case|loop|keychain|holder|strap|wallet|insert|band|cover|pouch|sleeve)\b/i.test(
    title,
  );
}

/**
 * Two strong Target candidates are the same product when identifiers do not
 * conflict and titles are compatible. Never uses Google product id as identity.
 */
export function strongCandidatesCompatible(
  a: ScoredCandidate,
  b: ScoredCandidate,
): boolean {
  const aT = offerTcin(a);
  const bT = offerTcin(b);
  if (aT && bT && aT !== bT) return false;

  const aM = offerModelKey(a);
  const bM = offerModelKey(b);
  if (aM && bM && aM !== bM) return false;

  const aU = offerUpcKey(a);
  const bU = offerUpcKey(b);
  if (aU && bU && aU !== bU) return false;

  const aAcc = titleLooksAccessory(a.offer.title);
  const bAcc = titleLooksAccessory(b.offer.title);
  if (aAcc !== bAcc) return false;

  // Same model (or same TCIN) with compatible accessory class → same product
  if ((aT && bT && aT === bT) || (aM && bM && aM === bM)) {
    return titleSimilarity(a.offer.title, b.offer.title) >= 0.45 || aT === bT;
  }

  return titleSimilarity(a.offer.title, b.offer.title) >= 0.72;
}

/** Group strong candidates into compatible identity clusters (dedupe same SKU). */
export function groupCompatibleStrongCandidates(
  strong: ScoredCandidate[],
): ScoredCandidate[][] {
  const groups: ScoredCandidate[][] = [];
  for (const c of strong) {
    let placed = false;
    for (const g of groups) {
      if (g.every((x) => strongCandidatesCompatible(x, c))) {
        g.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([c]);
  }
  return groups;
}

/**
 * Evaluate all offers: filter to Target-only, score, aggregate fail-closed decision.
 */
export function evaluateProductMatches(
  purchase: PurchaseMatchReference,
  offers: ReadonlyArray<NormalizedShoppingOffer | MatchableOffer>,
): MatchEvaluationResult {
  const targetOffers = generateTargetOnlyCandidates(offers);
  const rejectedNonTarget: ScoredCandidate[] = [];

  // Explicitly record non-Target / Plus as rejected for proof tests
  for (const raw of offers) {
    const asMatchable: MatchableOffer =
      "title_utf8_ok" in (raw as object)
        ? {
            title: (raw as NormalizedShoppingOffer).title,
            seller_kind: (raw as NormalizedShoppingOffer).seller_kind,
            seller_text: (raw as NormalizedShoppingOffer).source_text,
            is_target_plus: (raw as NormalizedShoppingOffer).is_target_plus,
            merchant_link: (raw as NormalizedShoppingOffer).merchant_link,
            product_link: (raw as NormalizedShoppingOffer).product_link,
            link: (raw as NormalizedShoppingOffer).link,
            serpapi_product_id: (raw as NormalizedShoppingOffer).product_id,
          }
        : (raw as MatchableOffer);

    if (
      asMatchable.is_target_plus ||
      asMatchable.seller_kind !== "target"
    ) {
      rejectedNonTarget.push(
        scoreOfferAgainstPurchase(purchase, asMatchable),
      );
    }
  }

  const scored = targetOffers.map((o) => scoreOfferAgainstPurchase(purchase, o));
  const all = [...scored, ...rejectedNonTarget];

  const strong = scored.filter(
    (c) =>
      c.decision === MatchDecision.EXACT_MATCH_CANDIDATE &&
      isStrongMatchTier(c.tier),
  );
  const rejected = all.filter((c) => c.decision === MatchDecision.REJECTED);
  const titleOnly = scored.filter((c) => c.title_only);

  // Multiple strong: collapse compatible duplicates; fail closed only when
  // groups are genuinely different products (never use Google product id).
  if (strong.length > 1) {
    const groups = groupCompatibleStrongCandidates(strong);
    if (groups.length > 1) {
      return {
        match_rule_version: MATCH_RULE_VERSION,
        decision: MatchDecision.MATCH_REVIEW_REQUIRED,
        reasons: ["ambiguous_multiple_strong_target_candidates"],
        candidates: scored.map((c) =>
          isStrongMatchTier(c.tier)
            ? {
                ...c,
                decision: MatchDecision.MATCH_REVIEW_REQUIRED,
                reasons: [...c.reasons, "ambiguous_group"],
              }
            : c,
        ),
        rejected,
      };
    }
    // Same product / duplicate offers — one confirmable representative
    const exact = pickBestStrongCandidate(groups[0]!);
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: [
        "single_strong_target_identity_among_duplicates",
        ...exact.reasons,
      ],
      // Collapse UI to the representative; full scored list stays in rejected/provenance path
      candidates: [exact],
      exact_candidate: exact,
      rejected: [
        ...rejected,
        ...strong
          .filter((c) => c.candidate_id !== exact.candidate_id)
          .map((c) => ({
            ...c,
            decision: MatchDecision.REJECTED,
            reasons: [...c.reasons, "duplicate_offer_collapsed"],
          })),
      ],
    };
  }

  if (strong.length === 1) {
    const exact = strong[0]!;
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.EXACT_MATCH_CANDIDATE,
      reasons: ["single_strong_target_candidate", ...exact.reasons],
      candidates: [exact],
      exact_candidate: exact,
      rejected,
    };
  }

  if (strong.length === 0 && titleOnly.length > 0) {
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.MATCH_REVIEW_REQUIRED,
      reasons: ["title_only_insufficient"],
      candidates: scored,
      rejected,
    };
  }

  if (scored.length === 0) {
    return {
      match_rule_version: MATCH_RULE_VERSION,
      decision: MatchDecision.MATCH_REVIEW_REQUIRED,
      reasons: ["no_target_candidates"],
      candidates: [],
      rejected,
    };
  }

  return {
    match_rule_version: MATCH_RULE_VERSION,
    decision: MatchDecision.MATCH_REVIEW_REQUIRED,
    reasons: ["no_strong_match"],
    candidates: scored,
    rejected,
  };
}

export { isTargetComUrl };
