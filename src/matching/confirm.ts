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
  normalizeVariant,
  titleSimilarity,
} from "./identity.js";

/** Model extracted only from title must still look like the locked product. */
const MIN_TITLE_SIM_FOR_MODEL_FROM_TITLE = 0.72;
const ACCESSORY_MARKERS = [
  "accessory",
  "case",
  "clip",
  "cover",
  "holder",
  "key ring",
  "keychain",
  "keyring",
  "loop",
  "mount",
  "protective skin",
  "replacement",
  "strap",
] as const;
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

/** Identity fields consumed by live matching; locked fingerprints are a superset. */
export type TargetMatchFingerprint = Pick<
  LockedProductFingerprint,
  | "target_product_url"
  | "target_item_id"
  | "model_number"
  | "upc_or_gtin"
  | "brand"
  | "size"
  | "color"
  | "weight"
  | "quantity"
  | "product_title"
  | "seller_kind"
  | "is_target_plus"
>;

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
  fingerprint: TargetMatchFingerprint,
  offer: MatchableOffer,
): { match: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (fingerprint.is_target_plus || fingerprint.seller_kind !== "target") {
    return { match: false, reasons: ["fingerprint_seller_not_target"] };
  }
  if (offer.is_target_plus || offer.seller_kind !== "target") {
    return { match: false, reasons: ["seller_not_target"] };
  }

  const variantConflict = lockedVariantConflict(fingerprint, offer);
  if (variantConflict) {
    return { match: false, reasons: ["variant_mismatch", variantConflict] };
  }

  if (
    fingerprint.brand &&
    offer.brand &&
    normalizeWords(fingerprint.brand) !== normalizeWords(offer.brand)
  ) {
    return { match: false, reasons: ["brand_mismatch"] };
  }

  if (isAccessoryMismatch(fingerprint.product_title, offer.title)) {
    return { match: false, reasons: ["accessory_mismatch"] };
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
  // Safe model-from-title: model appears as a token AND title is highly similar
  // to the locked product title (blocks accessory false positives, e.g. AirTag case).
  const modelTokenInTitle =
    Boolean(fpModel) && titleContainsCompleteModel(offer.title, fpModel!);
  const titleSim = fingerprint.product_title
    ? titleSimilarity(fingerprint.product_title, offer.title)
    : 0;
  const offerModelFromTitle =
    fpModel &&
    modelTokenInTitle &&
    fingerprint.product_title &&
    titleSim >= MIN_TITLE_SIM_FOR_MODEL_FROM_TITLE
      ? fpModel
      : null;
  const offerModel = offerModelRaw || offerModelFromTitle;

  if (fpModel && offerModel && fpModel === offerModel) {
    reasons.push(offerModelRaw ? "model" : "model_from_title");
    if (!offerModelRaw) reasons.push(`title_sim=${titleSim.toFixed(3)}`);
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

function normalizeWords(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function lockedVariantConflict(
  fingerprint: TargetMatchFingerprint,
  offer: MatchableOffer,
): string | null {
  const pairs: Array<
    [string, string | null | undefined, string | null | undefined]
  > = [
    ["size", fingerprint.size, offer.size],
    ["color", fingerprint.color, offer.color],
    ["weight", fingerprint.weight, offer.weight],
    ["quantity", fingerprint.quantity, offer.quantity],
  ];
  for (const [name, locked, observed] of pairs) {
    const normalizedLocked = normalizeVariant(locked);
    const normalizedObserved = normalizeVariant(observed);
    if (
      normalizedLocked &&
      normalizedObserved &&
      normalizedLocked !== normalizedObserved
    ) {
      return `${name}:${normalizedLocked}!=${normalizedObserved}`;
    }
  }
  return null;
}

function isAccessoryMismatch(
  lockedTitle: string | null | undefined,
  offerTitle: string,
): boolean {
  if (!lockedTitle) return false;
  const locked = ` ${normalizeWords(lockedTitle)} `;
  const observed = ` ${normalizeWords(offerTitle)} `;
  return ACCESSORY_MARKERS.some((marker) => {
    const normalizedMarker = ` ${normalizeWords(marker)} `;
    return observed.includes(normalizedMarker) && !locked.includes(normalizedMarker);
  });
}

function titleContainsCompleteModel(
  title: string,
  normalizedModel: string,
): boolean {
  const tokens = title
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (let start = 0; start < tokens.length; start += 1) {
    let phrase = "";
    for (let end = start; end < tokens.length; end += 1) {
      phrase += tokens[end];
      if (phrase === normalizedModel) return true;
      if (phrase.length >= normalizedModel.length) break;
    }
  }
  return false;
}

export function newMatchRowId(): string {
  return `pm_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
