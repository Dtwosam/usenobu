/**
 * Adaptive product-clue validation for Find my product.
 * Users supply whatever product details they have; Nobu decides
 * one match, several matches, or insufficient evidence.
 * Client gating is UX-only — server must revalidate.
 */
import {
  isLikelyTcin,
  evaluateExactIdentity,
} from "./exact-identity.js";
import {
  normalizeModel,
  normalizeUpc,
  parseTargetProductUrl,
} from "../matching/identity.js";

/** Minimum meaningful free-text description/title length. */
export const MIN_MEANINGFUL_DESCRIPTION_LEN = 3;

export type ProductClueInput = {
  product_title?: string | null;
  product_description?: string | null;
  target_product_url?: string | null;
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
};

export type ProductClueAssessment = {
  /** At least one usable product clue for search. */
  has_usable_clue: boolean;
  /** Strong exact Target URL and/or TCIN identity (no conflicts). */
  has_exact_identity: boolean;
  has_meaningful_description: boolean;
  has_valid_url: boolean;
  has_valid_tcin: boolean;
  has_valid_model: boolean;
  has_valid_upc: boolean;
  /** Malformed URL or conflicting URL/TCIN when user provided values. */
  has_blocking_identity_error: boolean;
  errors: {
    target_product_url?: string;
    target_item_id?: string;
    identity?: string;
  };
  /** Normalized description/title for discovery query. */
  description: string | null;
};

const PLACEHOLDER_RE =
  /^(n\/?a|none|unknown|test|asdf|xxx|placeholder|product|item)$/i;

/**
 * Meaningful product title/description — not whitespace, placeholders,
 * or one-character noise.
 */
export function isMeaningfulDescription(
  value: string | null | undefined,
): boolean {
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  if (v.length < MIN_MEANINGFUL_DESCRIPTION_LEN) return false;
  if (PLACEHOLDER_RE.test(v)) return false;
  // Require at least one letter (blocks pure punctuation / numbers-only noise
  // that is not a TCIN — pure digit TCINs are handled separately).
  if (!/[a-zA-Z]/.test(v) && !/\d{5,}/.test(v)) return false;
  return true;
}

export function assessProductClues(input: ProductClueInput): ProductClueAssessment {
  const urlRaw = String(input.target_product_url ?? "").trim();
  const tcinRaw = String(input.target_item_id ?? "").trim();
  const modelRaw = String(input.model_number ?? "").trim();
  const upcRaw = String(input.upc_or_gtin ?? "").trim();
  const descRaw = String(
    input.product_description || input.product_title || "",
  ).trim();

  const has_meaningful_description = isMeaningfulDescription(descRaw);
  const has_valid_tcin = isLikelyTcin(tcinRaw);
  const has_valid_model = Boolean(normalizeModel(modelRaw));
  const has_valid_upc = normalizeUpc(upcRaw) != null;

  const errors: ProductClueAssessment["errors"] = {};
  let has_valid_url = false;

  if (urlRaw) {
    const parsed = parseTargetProductUrl(urlRaw);
    if (parsed.ok) {
      has_valid_url = true;
    } else {
      errors.target_product_url = parsed.message;
    }
  }

  if (tcinRaw && !has_valid_tcin) {
    errors.target_item_id =
      "Enter a valid Target item number (TCIN), usually 5–12 digits.";
  }

  // Conflicting URL vs TCIN
  if (has_valid_url && has_valid_tcin) {
    const identity = evaluateExactIdentity({
      target_product_url: urlRaw,
      target_item_id: tcinRaw,
    });
    if (!identity.ok && identity.errors.target_item_id) {
      errors.target_item_id = identity.errors.target_item_id;
    }
  }

  const has_blocking_identity_error = Boolean(
    errors.target_product_url || errors.target_item_id,
  );

  const has_exact_identity =
    !has_blocking_identity_error && (has_valid_url || has_valid_tcin);

  const has_usable_clue =
    !has_blocking_identity_error &&
    (has_meaningful_description ||
      has_valid_url ||
      has_valid_tcin ||
      has_valid_model ||
      has_valid_upc);

  return {
    has_usable_clue,
    has_exact_identity,
    has_meaningful_description,
    has_valid_url,
    has_valid_tcin,
    has_valid_model,
    has_valid_upc,
    has_blocking_identity_error,
    errors,
    description: has_meaningful_description ? descRaw : null,
  };
}

/** Purchase-side gates shared by client button and server submit. */
export function canSubmitFindProduct(args: {
  purchase_price: string | number | null | undefined;
  purchase_date: string | null | undefined;
  region?: string | null;
  clues: ProductClueInput;
}): { ok: boolean; reason: string } {
  const price = Number(args.purchase_price);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: "Enter the price paid." };
  }
  const date = String(args.purchase_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "Enter the purchase date." };
  }
  const assessment = assessProductClues(args.clues);
  if (assessment.has_blocking_identity_error) {
    return {
      ok: false,
      reason:
        assessment.errors.target_item_id ||
        assessment.errors.target_product_url ||
        "Check the product link or TCIN.",
    };
  }
  if (!assessment.has_usable_clue) {
    return {
      ok: false,
      reason: "Add at least one product detail so Nobu can search for it.",
    };
  }
  return { ok: true, reason: "" };
}
