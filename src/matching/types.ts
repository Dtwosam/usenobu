import type { SellerKind } from "../domain/enums.js";
import type { MatchDecision, MatchTier } from "./rules.js";

/** Purchase-side identity used for matching (user-provided + known fields). */
export interface PurchaseMatchReference {
  purchase_id?: string;
  target_product_url: string;
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
  brand?: string | null;
  size?: string | null;
  color?: string | null;
  weight?: string | null;
  quantity?: string | null;
  /** Optional human title — never sufficient alone for confirmation. */
  product_title?: string | null;
}

/**
 * Offer or candidate input for matching.
 * serpapi_product_id is explicitly NOT a TCIN.
 */
export interface MatchableOffer {
  offer_id?: string;
  title: string;
  seller_kind: SellerKind | string;
  seller_text: string;
  is_target_plus: boolean;
  merchant_link?: string | null;
  product_link?: string | null;
  link?: string | null;
  /** SerpApi/Google product id — never used as Target TCIN. */
  serpapi_product_id?: string | null;
  /**
   * SerpApi immersive product page token (when present).
   * Used only to recover merchant Target.com links — never as TCIN.
   */
  immersive_product_page_token?: string | null;
  /** Target TCIN only when known from Target URL or user-confirmed data — not SerpApi id. */
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
  brand?: string | null;
  size?: string | null;
  color?: string | null;
  weight?: string | null;
  quantity?: string | null;
  observed_price?: number | null;
  currency?: string | null;
  observed_at?: string | null;
  thumbnail?: string | null;
}

export interface ScoredCandidate {
  candidate_id: string;
  offer: MatchableOffer;
  tier: MatchTier;
  decision: MatchDecision;
  reasons: string[];
  title_similarity: number;
  matched_tcin?: string;
  matched_model?: string;
  matched_upc?: string;
  /** True when only title similarity fired (fail-closed for auto-confirm). */
  title_only: boolean;
}

export interface MatchEvaluationResult {
  match_rule_version: string;
  decision: MatchDecision;
  reasons: string[];
  /** Target-seller-only candidates that were scored (excludes non-Target / Plus). */
  candidates: ScoredCandidate[];
  /** Strong single candidate when decision is EXACT_MATCH_CANDIDATE. */
  exact_candidate?: ScoredCandidate;
  rejected: ScoredCandidate[];
}
