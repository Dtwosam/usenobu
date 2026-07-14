/**
 * Bounded enrichment: when Shopping returns Target-sourced rows without
 * Target.com URLs, resolve one Immersive Product page to recover a genuine
 * Target merchant link + TCIN. Never invents identifiers.
 */
import type { MatchableOffer } from "../matching/types.js";
import {
  extractTcinFromTargetUrl,
  isTargetComUrl,
  titleSimilarity,
} from "../matching/identity.js";
import type { SerpApiShoppingClient } from "./client.js";
import { parseImmersiveProductResponse } from "./immersive.js";

export interface EnrichTargetLinksArgs {
  client: SerpApiShoppingClient;
  offers: MatchableOffer[];
  /** Preferred title for selecting which immersive product to open. */
  reference_title?: string | null;
  /** Expected TCIN when known — prefer store link matching this TCIN. */
  expected_tcin?: string | null;
  /** Hard cap: at most one immersive search. */
  max_immersive_searches?: number;
}

export interface EnrichTargetLinksResult {
  offers: MatchableOffer[];
  immersive_searches: number;
  enriched_count: number;
  selected_title?: string;
  target_link?: string;
  target_tcin?: string | null;
}

/**
 * If any Target offer already has a Target.com URL, no enrichment needed.
 * Otherwise pick the best Target-sourced offer with an immersive token,
 * resolve once, and merge Target store link onto matching offers.
 */
export async function enrichOffersWithImmersiveTargetLinks(
  args: EnrichTargetLinksArgs,
): Promise<EnrichTargetLinksResult> {
  const max = args.max_immersive_searches ?? 1;
  const offers = args.offers.map((o) => ({ ...o }));

  const hasDirectTarget = offers.some(
    (o) =>
      o.seller_kind === "target" &&
      !o.is_target_plus &&
      (isTargetComUrl(o.merchant_link) ||
        isTargetComUrl(o.link) ||
        Boolean(o.target_item_id)),
  );
  if (hasDirectTarget || max < 1) {
    return { offers, immersive_searches: 0, enriched_count: 0 };
  }

  const minSim = args.reference_title ? 0.72 : 0;
  const candidates = offers
    .filter(
      (o) =>
        o.seller_kind === "target" &&
        !o.is_target_plus &&
        Boolean(o.immersive_product_page_token),
    )
    .map((o) => ({
      offer: o,
      sim: args.reference_title
        ? titleSimilarity(args.reference_title, o.title)
        : 0,
    }))
    .filter((c) => c.sim >= minSim)
    .sort((a, b) => b.sim - a.sim);

  // Require high title similarity when a reference title is known —
  // never open immersive for a weak lookalike (wrong Conair variant).
  const pick = candidates[0] ?? null;
  if (!pick?.offer.immersive_product_page_token) {
    return { offers, immersive_searches: 0, enriched_count: 0 };
  }

  const raw = await args.client.searchImmersiveProduct({
    page_token: pick.offer.immersive_product_page_token,
    timeout_ms: 20_000,
  });
  const parsed = parseImmersiveProductResponse(raw);

  // Fail closed: when expected TCIN is known, only accept a Target store
  // whose URL TCIN matches. Do not attach a different SKU's link.
  let store = parsed.target_stores[0];
  if (args.expected_tcin) {
    const preferred = parsed.target_stores.find(
      (s) => s.target_item_id === args.expected_tcin,
    );
    if (!preferred) {
      return {
        offers,
        immersive_searches: 1,
        enriched_count: 0,
        selected_title: pick.offer.title,
        target_tcin: store?.target_item_id ?? null,
        target_link: store?.link,
      };
    }
    store = preferred;
  }
  if (!store) {
    return {
      offers,
      immersive_searches: 1,
      enriched_count: 0,
      selected_title: pick.offer.title,
    };
  }

  const tcin =
    store.target_item_id || extractTcinFromTargetUrl(store.link) || null;
  let enriched_count = 0;

  // Enrich the selected offer; also enrich siblings sharing same google product id
  for (const o of offers) {
    const sameProduct =
      o.offer_id === pick.offer.offer_id ||
      (pick.offer.serpapi_product_id &&
        o.serpapi_product_id === pick.offer.serpapi_product_id) ||
      (o.title === pick.offer.title && o.seller_kind === "target");
    if (!sameProduct) continue;
    if (o.seller_kind !== "target" || o.is_target_plus) continue;

    o.merchant_link = store.link;
    o.link = store.link;
    if (tcin) o.target_item_id = tcin;
    if (store.extracted_price && !(o.observed_price && o.observed_price > 0)) {
      o.observed_price = store.extracted_price;
    }
    if (store.title) {
      // Keep original shopping title; do not overwrite with store title unless empty
      if (!o.title) o.title = store.title;
    }
    enriched_count += 1;
  }

  return {
    offers,
    immersive_searches: 1,
    enriched_count,
    selected_title: pick.offer.title,
    target_link: store.link,
    target_tcin: tcin,
  };
}
