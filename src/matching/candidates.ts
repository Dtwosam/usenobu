import { createHash, randomUUID } from "node:crypto";
import { SellerKind } from "../domain/enums.js";
import type { NormalizedShoppingOffer } from "../serpapi/types.js";
import { extractTcinFromTargetUrl, isTargetComUrl } from "./identity.js";
import type { MatchableOffer } from "./types.js";

/**
 * Generate Target-seller-only matchable candidates from normalized shopping offers.
 * Excludes Target Plus and non-Target sellers (fail closed).
 * Never maps SerpApi product_id to TCIN.
 */
export function generateTargetOnlyCandidates(
  offers: ReadonlyArray<NormalizedShoppingOffer | MatchableOffer>,
): MatchableOffer[] {
  const out: MatchableOffer[] = [];

  for (const raw of offers) {
    const offer = toMatchableOffer(raw);
    if (offer.is_target_plus) continue;
    if (offer.seller_kind !== SellerKind.TARGET && offer.seller_kind !== "target") {
      continue;
    }
    out.push(offer);
  }

  return out;
}

export function toMatchableOffer(
  raw: NormalizedShoppingOffer | MatchableOffer,
): MatchableOffer {
  if ("product_title" in raw && !("title" in raw)) {
    // unlikely
  }

  if ("seller_kind" in raw && "title" in raw && !("title_utf8_ok" in raw)) {
    const m = raw as MatchableOffer;
    return {
      ...m,
      offer_id: m.offer_id ?? stableOfferId(m),
      // Explicit: never promote serpapi id to tcin
      target_item_id: m.target_item_id ?? extractTcinFromAnyLink(m),
      serpapi_product_id: m.serpapi_product_id ?? null,
    };
  }

  const o = raw as NormalizedShoppingOffer;
  const merchant = o.merchant_link ?? null;
  const link = o.link ?? null;
  const product_link = o.product_link ?? null;
  const tcin =
    extractTcinFromTargetUrl(merchant) ??
    extractTcinFromTargetUrl(link) ??
    null;

  return {
    offer_id: stableOfferIdFromParts(o),
    title: o.title,
    seller_kind: o.seller_kind,
    seller_text: o.source_text,
    is_target_plus: o.is_target_plus,
    merchant_link: merchant,
    product_link,
    link,
    serpapi_product_id: o.product_id ?? null,
    immersive_product_page_token: o.immersive_product_page_token ?? null,
    target_item_id: tcin,
    model_number: null,
    upc_or_gtin: null,
    observed_price: o.extracted_price ?? null,
    currency: o.currency ?? null,
  };
}

function extractTcinFromAnyLink(m: MatchableOffer): string | null {
  return (
    extractTcinFromTargetUrl(m.merchant_link) ??
    extractTcinFromTargetUrl(m.link) ??
    extractTcinFromTargetUrl(m.product_link) ??
    null
  );
}

function stableOfferId(m: MatchableOffer): string {
  return (
    m.offer_id ??
    createHash("sha256")
      .update(
        [
          m.serpapi_product_id ?? "",
          m.merchant_link ?? m.link ?? m.product_link ?? "",
          m.title,
          m.seller_text,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 16)
  );
}

function stableOfferIdFromParts(o: NormalizedShoppingOffer): string {
  return createHash("sha256")
    .update(
      [
        o.product_id ?? "",
        o.merchant_link ?? o.link ?? o.product_link ?? "",
        o.title,
        o.source_text,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);
}

export function newCandidateId(): string {
  return `cand_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function preferredProductUrl(offer: MatchableOffer): string {
  if (offer.merchant_link && isTargetComUrl(offer.merchant_link)) {
    return offer.merchant_link;
  }
  if (offer.link && isTargetComUrl(offer.link)) {
    return offer.link;
  }
  // Fall back to purchase URL at confirmation time when Google-only links
  return offer.merchant_link || offer.link || offer.product_link || "";
}
