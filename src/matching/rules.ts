/**
 * Fail-closed product matching rule version (Lane 4).
 * SerpApi product_id is never treated as Target TCIN.
 */
export const MATCH_RULE_VERSION = "match-v1" as const;

/** Strong → weak hierarchy (data contract). Title-only is never confirmatory. */
export const MatchTier = {
  EXACT_TARGET_URL: "exact_target_url",
  EXACT_TCIN: "exact_tcin",
  EXACT_MODEL_VARIANT: "exact_model_variant",
  EXACT_UPC: "exact_upc",
  TITLE_ONLY: "title_only",
  NONE: "none",
} as const;

export type MatchTier = (typeof MatchTier)[keyof typeof MatchTier];

export const MatchDecision = {
  /** Single strong Target candidate — eligible for user confirmation only. */
  EXACT_MATCH_CANDIDATE: "EXACT_MATCH_CANDIDATE",
  /** Ambiguous, weak, or incomplete — fail closed for auto-lock. */
  MATCH_REVIEW_REQUIRED: "MATCH_REVIEW_REQUIRED",
  /** Wrong seller, Target Plus, wrong model/variant, or hard reject. */
  REJECTED: "REJECTED",
} as const;

export type MatchDecision = (typeof MatchDecision)[keyof typeof MatchDecision];

export const STRONG_MATCH_TIERS: ReadonlySet<MatchTier> = new Set([
  MatchTier.EXACT_TARGET_URL,
  MatchTier.EXACT_TCIN,
  MatchTier.EXACT_MODEL_VARIANT,
  MatchTier.EXACT_UPC,
]);

export function isStrongMatchTier(tier: MatchTier): boolean {
  return STRONG_MATCH_TIERS.has(tier);
}
