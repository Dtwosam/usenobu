import { createHash, randomUUID } from "node:crypto";
import {
  parseLockedProductFingerprint,
  type LockedProductFingerprint,
} from "../domain/product-fingerprint.js";
import { SellerKind } from "../domain/enums.js";
import { preferredProductUrl } from "./candidates.js";
import {
  extractTcinFromTargetUrl,
  isTargetComUrl,
  normalizeModel,
  normalizeTargetProductUrl,
  normalizeUpc,
} from "./identity.js";
import { isStrongMatchTier, MATCH_RULE_VERSION } from "./rules.js";
import type {
  MatchableOffer,
  PurchaseMatchReference,
  ScoredCandidate,
} from "./types.js";

export interface ConfirmMatchInput {
  purchase: PurchaseMatchReference;
  candidate: ScoredCandidate;
  /** Must be true — confirmation is required before monitoring. */
  confirmed_by_user: true;
  confirmed_at?: string;
  fingerprint_id?: string;
}

export interface ConfirmMatchResult {
  fingerprint: LockedProductFingerprint;
  match_rule_version: string;
  match_tier: string;
  product_url: string;
}

/**
 * User confirmation of a single strong candidate creates a locked fingerprint.
 * Fails closed if candidate is not Target, is Target Plus, is title-only,
 * or lacks strong identity for locking.
 */
export function confirmProductMatch(input: ConfirmMatchInput): ConfirmMatchResult {
  if (input.confirmed_by_user !== true) {
    throw new Error("User confirmation is required before locking a fingerprint");
  }

  const { candidate, purchase } = input;
  const offer = candidate.offer;

  if (offer.is_target_plus || offer.seller_kind !== SellerKind.TARGET) {
    throw new Error("Cannot confirm non-Target or Target Plus candidate");
  }

  if (candidate.title_only || candidate.tier === "title_only") {
    throw new Error("Title-only matches cannot be confirmed as locked fingerprints");
  }

  if (!isStrongMatchTier(candidate.tier)) {
    throw new Error(
      `Cannot confirm weak match tier ${candidate.tier}; fail closed`,
    );
  }

  const tcin =
    candidate.matched_tcin ||
    offer.target_item_id ||
    extractTcinFromTargetUrl(offer.merchant_link) ||
    extractTcinFromTargetUrl(purchase.target_product_url) ||
    purchase.target_item_id ||
    null;

  const model =
    candidate.matched_model ||
    normalizeModel(offer.model_number) ||
    normalizeModel(purchase.model_number) ||
    null;

  const upc =
    candidate.matched_upc ||
    normalizeUpc(offer.upc_or_gtin) ||
    normalizeUpc(purchase.upc_or_gtin) ||
    null;

  if (!tcin && !model && !upc) {
    throw new Error(
      "Locked fingerprint requires target_item_id (TCIN), model_number, or upc_or_gtin",
    );
  }

  // Prefer Target.com URL from purchase when offer only has Google product links
  let productUrl = preferredProductUrl(offer);
  if (!isTargetComUrl(productUrl)) {
    productUrl = purchase.target_product_url;
  }
  if (!isTargetComUrl(productUrl)) {
    throw new Error("Locked fingerprint requires a Target.com product URL");
  }

  const confirmed_at = input.confirmed_at ?? new Date().toISOString();
  const fingerprint_id =
    input.fingerprint_id ??
    `fp_${createHash("sha256")
      .update(
        [
          purchase.purchase_id ?? "",
          productUrl,
          tcin ?? "",
          model ?? "",
          upc ?? "",
          MATCH_RULE_VERSION,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 24)}`;

  const fingerprint = parseLockedProductFingerprint({
    fingerprint_id,
    purchase_id: purchase.purchase_id,
    target_product_url: productUrl,
    target_item_id: tcin ?? undefined,
    model_number: model ?? purchase.model_number ?? undefined,
    upc_or_gtin: upc ?? undefined,
    brand: offer.brand ?? purchase.brand ?? undefined,
    size: offer.size ?? purchase.size ?? undefined,
    color: offer.color ?? purchase.color ?? undefined,
    weight: offer.weight ?? purchase.weight ?? undefined,
    quantity: offer.quantity ?? purchase.quantity ?? undefined,
    product_title: offer.title ?? purchase.product_title ?? undefined,
    seller_kind: SellerKind.TARGET,
    is_target_plus: false,
    confirmed_at,
    confirmed_by_user: true,
  });

  return {
    fingerprint,
    match_rule_version: MATCH_RULE_VERSION,
    match_tier: candidate.tier,
    product_url: productUrl,
  };
}

/**
 * Later monitoring must use the locked fingerprint only.
 * SerpApi product_id is never compared as TCIN.
 */
export function offerMatchesLockedFingerprint(
  fingerprint: LockedProductFingerprint,
  offer: MatchableOffer,
): { match: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (offer.is_target_plus || offer.seller_kind !== "target") {
    return { match: false, reasons: ["seller_not_target"] };
  }

  // Hierarchy (same spirit as enrollment): URL → TCIN → model → UPC.
  // Missing one identifier type is not an automatic reject when another
  // contract-approved strong signal is present. Title-only never passes.
  const fpUrl = normalizeTargetProductUrl(fingerprint.target_product_url);
  const offerUrl =
    normalizeTargetProductUrl(offer.merchant_link) ||
    normalizeTargetProductUrl(offer.link) ||
    normalizeTargetProductUrl(offer.product_link);
  if (fpUrl && offerUrl && fpUrl === offerUrl) {
    reasons.push("exact_target_url");
    return { match: true, reasons };
  }

  const fpTcin = fingerprint.target_item_id?.trim() || null;
  // TCIN only from explicit field or Target.com URL — never SerpApi product_id
  const offerTcin =
    offer.target_item_id?.trim() ||
    extractTcinFromTargetUrl(offer.merchant_link) ||
    extractTcinFromTargetUrl(offer.link) ||
    extractTcinFromTargetUrl(offer.product_link) ||
    null;

  if (fpTcin && offerTcin && fpTcin === offerTcin) {
    reasons.push("tcin");
    return { match: true, reasons };
  }
  if (fpTcin && offerTcin && fpTcin !== offerTcin) {
    return { match: false, reasons: ["tcin_mismatch"] };
  }

  const fpModel = normalizeModel(fingerprint.model_number);
  const offerModelRaw = normalizeModel(offer.model_number);
  // Safe model-from-title: only when fingerprint model is present and appears as a token in title
  const offerModelFromTitle =
    fpModel &&
    offer.title
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .split(/\s+/)
      .includes(fpModel)
      ? fpModel
      : null;
  const offerModel = offerModelRaw || offerModelFromTitle;

  if (fpModel && offerModel && fpModel === offerModel) {
    reasons.push("model");
    return { match: true, reasons };
  }
  if (fpModel && offerModelRaw && fpModel !== offerModelRaw) {
    return { match: false, reasons: ["model_mismatch"] };
  }

  const fpUpc = normalizeUpc(fingerprint.upc_or_gtin);
  const offerUpc = normalizeUpc(offer.upc_or_gtin);
  if (fpUpc && offerUpc && fpUpc === offerUpc) {
    reasons.push("upc");
    return { match: true, reasons };
  }
  if (fpUpc && offerUpc && fpUpc !== offerUpc) {
    return { match: false, reasons: ["upc_mismatch"] };
  }

  // Title-only never unlocks monitoring match
  reasons.push("insufficient_identity_for_locked_fingerprint");
  return { match: false, reasons };
}

export function newMatchRowId(): string {
  return `pm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
