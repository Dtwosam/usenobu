/**
 * Exact-product identity requirements for consumer Find my product.
 * Does not change A2MCP / PurchaseInputSchema (agent stays frozen).
 * Never treats Google product IDs as TCIN.
 *
 * Exact mode accepts either a supported Target product URL or a valid TCIN
 * (not both required). Conflicting URL/TCIN is rejected.
 */
import {
  extractTcinFromTargetUrl,
  normalizeUpc,
  parseTargetProductUrl,
} from "../matching/identity.js";

export const EXACT_IDENTITY_MISSING_MODEL_OR_UPC =
  "Add a model number or UPC if Nobu asks for one.";

export const EXACT_IDENTITY_SECTION_HEADING = "Exact product details";

/** Synthetic Target product URL built from a user-supplied TCIN (no network). */
export function synthesizeTargetUrlFromTcin(tcin: string): string {
  const id = String(tcin).trim();
  return `https://www.target.com/p/-/A-${id}`;
}

/**
 * Readable provisional title from a Target product URL slug.
 * Label as link-derived until third-party enrichment improves it.
 * Never treats the slug as a current price observation.
 */
export function provisionalTitleFromTargetUrl(
  url: string | null | undefined,
): string | null {
  const parsed = parseTargetProductUrl(url);
  if (!parsed.ok) return null;
  if (parsed.product_name) {
    return titleCaseWords(parsed.product_name);
  }
  if (parsed.tcin) {
    return `Target item ${parsed.tcin}`;
  }
  return null;
}

export function provisionalTitleFromTcin(
  tcin: string | null | undefined,
): string | null {
  const id = String(tcin ?? "").trim();
  if (!isLikelyTcin(id)) return null;
  return `Target item ${id}`;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (w.length <= 2 && /^[a-z]+$/i.test(w)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

export type ExactIdentityInput = {
  target_product_url?: string | null;
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
};

export type ExactIdentityResult = {
  ok: boolean;
  effective_tcin: string | null;
  /** Normalized or synthesized Target product URL when identity is usable. */
  effective_url: string | null;
  has_target_url: boolean;
  has_tcin: boolean;
  has_model: boolean;
  has_upc: boolean;
  has_model_or_upc: boolean;
  /** True when only TCIN was supplied and a synthetic URL was derived. */
  url_synthesized_from_tcin: boolean;
  /** Link-derived provisional title when URL slug is available. */
  provisional_title: string | null;
  errors: {
    target_product_url?: string;
    target_item_id?: string;
    model_or_upc?: string;
    identity?: string;
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

  const parsed = parseTargetProductUrl(input.target_product_url);
  return parsed.ok && isLikelyTcin(parsed.tcin) ? parsed.tcin : null;
}

export function hasModelNumber(value: string | null | undefined): boolean {
  return String(value ?? "").trim().length > 0;
}

export function hasUpcOrGtin(value: string | null | undefined): boolean {
  return normalizeUpc(value) != null;
}

/**
 * Exact product identity for Find my product:
 * - Supported Target product URL with TCIN, OR
 * - Valid digits-only TCIN alone
 * Optional model/UPC are progressive fallback details, not initial requirements.
 * Empty URL is fine when TCIN is valid. Malformed TCIN / non-Target URL rejected when provided.
 */
export function evaluateExactIdentity(
  input: ExactIdentityInput,
): ExactIdentityResult {
  const urlRaw = String(input.target_product_url ?? "").trim();
  const explicitTcin = String(input.target_item_id ?? "").trim();
  const hasUrlInput = urlRaw.length > 0;
  const hasTcinInput = explicitTcin.length > 0;

  const parsed = hasUrlInput
    ? parseTargetProductUrl(urlRaw)
    : ({
        ok: false as const,
        original_url: "",
        code: "INVALID_TARGET_URL" as const,
        message: "Add a Target.com product URL.",
      });

  const has_target_url = parsed.ok;
  const effective_tcin = resolveEffectiveTcin(input);
  const has_tcin = Boolean(effective_tcin);
  const has_model = hasModelNumber(input.model_number);
  const has_upc = hasUpcOrGtin(input.upc_or_gtin);
  const has_model_or_upc = has_model || has_upc;

  const errors: ExactIdentityResult["errors"] = {};

  // Malformed / non-Target URL when the user typed one
  if (hasUrlInput && !parsed.ok) {
    errors.target_product_url = parsed.message;
  }

  // Malformed explicit TCIN
  if (hasTcinInput && !isLikelyTcin(explicitTcin)) {
    errors.target_item_id =
      "Enter a valid Target item number (TCIN), usually 5–12 digits.";
  }

  // Conflicting URL TCIN vs explicit TCIN
  if (
    hasUrlInput &&
    parsed.ok &&
    hasTcinInput &&
    isLikelyTcin(explicitTcin) &&
    explicitTcin !== parsed.tcin
  ) {
    errors.target_item_id =
      "The entered TCIN does not match the Target product URL.";
  }

  // Neither usable identity
  if (!has_tcin && !errors.target_product_url && !errors.target_item_id) {
    errors.identity =
      "Add a Target product link or a TCIN (Target item number). You do not need both.";
  }

  const conflictOrMalformed = Boolean(
    errors.target_product_url || errors.target_item_id,
  );
  const ok = has_tcin && !conflictOrMalformed;

  let effective_url: string | null = null;
  let url_synthesized_from_tcin = false;
  if (ok && has_target_url && parsed.ok) {
    effective_url = parsed.normalized_url;
  } else if (ok && effective_tcin) {
    effective_url = synthesizeTargetUrlFromTcin(effective_tcin);
    url_synthesized_from_tcin = !has_target_url;
  }

  const provisional_title =
    (has_target_url && parsed.ok
      ? provisionalTitleFromTargetUrl(urlRaw)
      : null) || provisionalTitleFromTcin(effective_tcin);

  return {
    ok,
    effective_tcin,
    effective_url,
    has_target_url,
    has_tcin,
    has_model,
    has_upc,
    has_model_or_upc,
    url_synthesized_from_tcin,
    provisional_title,
    errors,
  };
}

export { extractTcinFromTargetUrl };
