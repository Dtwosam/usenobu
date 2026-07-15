/**
 * Exact-product identity requirements for consumer Find my product.
 * Does not change A2MCP / PurchaseInputSchema (agent stays frozen).
 * Never treats Google product IDs as TCIN.
 */
import {
  extractTcinFromTargetUrl,
  isTargetComUrl,
  normalizeUpc,
} from "../matching/identity.js";

export const EXACT_IDENTITY_MISSING_MODEL_OR_UPC =
  "Add a model number or UPC to continue.";

export const EXACT_IDENTITY_SECTION_HEADING = "Exact product details";

export type ExactIdentityInput = {
  target_product_url?: string | null;
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
};

export type ExactIdentityResult = {
  ok: boolean;
  effective_tcin: string | null;
  has_target_url: boolean;
  has_tcin: boolean;
  has_model: boolean;
  has_upc: boolean;
  has_model_or_upc: boolean;
  errors: {
    target_product_url?: string;
    target_item_id?: string;
    model_or_upc?: string;
  };
};

/** Digits-only TCIN shape from Target URL A- segment (never Google product ids). */
export function isLikelyTcin(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return /^\d{5,12}$/.test(v);
}

/**
 * Prefer explicit user TCIN; otherwise extract from a trusted Target product URL.
 * Does not invent IDs from non-Target hosts or Google shopping links.
 */
export function resolveEffectiveTcin(input: ExactIdentityInput): string | null {
  const explicit = String(input.target_item_id ?? "").trim();
  if (isLikelyTcin(explicit)) return explicit;

  const url = String(input.target_product_url ?? "").trim();
  if (!url || !isTargetComUrl(url)) return null;
  const fromUrl = extractTcinFromTargetUrl(url);
  return fromUrl && isLikelyTcin(fromUrl) ? fromUrl : null;
}

export function hasModelNumber(value: string | null | undefined): boolean {
  return String(value ?? "").trim().length > 0;
}

export function hasUpcOrGtin(value: string | null | undefined): boolean {
  return normalizeUpc(value) != null;
}

/**
 * Required for Find my product:
 * - Valid Target product URL
 * - TCIN (explicit or from Target URL)
 * - At least one of model number or UPC/GTIN
 */
export function evaluateExactIdentity(
  input: ExactIdentityInput,
): ExactIdentityResult {
  const url = String(input.target_product_url ?? "").trim();
  const has_target_url = Boolean(url && isTargetComUrl(url));
  const effective_tcin = resolveEffectiveTcin(input);
  const has_tcin = Boolean(effective_tcin);
  const has_model = hasModelNumber(input.model_number);
  const has_upc = hasUpcOrGtin(input.upc_or_gtin);
  const has_model_or_upc = has_model || has_upc;

  const errors: ExactIdentityResult["errors"] = {};
  if (!has_target_url) {
    errors.target_product_url =
      "Add a valid Target.com product link so Nobu can find the exact item.";
  }
  if (!has_tcin) {
    errors.target_item_id =
      "Add the TCIN (Target item number) or a Target product link that includes it.";
  }
  if (!has_model_or_upc) {
    errors.model_or_upc = EXACT_IDENTITY_MISSING_MODEL_OR_UPC;
  }

  return {
    ok: has_target_url && has_tcin && has_model_or_upc,
    effective_tcin,
    has_target_url,
    has_tcin,
    has_model,
    has_upc,
    has_model_or_upc,
    errors,
  };
}

export { extractTcinFromTargetUrl };
