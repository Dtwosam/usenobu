/**
 * Live SerpApi observation fetcher for manual monitoring checks.
 * Reuses existing SerpApi client + offer normalization — not a second connector.
 */
import { createHash } from "node:crypto";
import { toMatchableOffer } from "../matching/candidates.js";
import type { MatchableOffer } from "../matching/types.js";
import type {
  MonitorObservationInput,
  ObservationFetcher,
} from "../monitoring/types.js";
import {
  createSerpApiClientFromEnv,
  type SerpApiShoppingClient,
  type SerpApiShoppingResult,
} from "../serpapi/index.js";
import { enrichOffersWithImmersiveTargetLinks } from "../serpapi/enrich-target-links.js";
import { offerMatchesLockedFingerprint } from "../matching/confirm.js";
import type { TargetMatchFingerprint } from "../matching/confirm.js";

/**
 * Deterministic live query from locked fingerprint.
 * Prefer strong identifiers in order: model → UPC → TCIN → title → brand → Target.
 * When model is primary, include TCIN as a compact secondary disambiguator.
 * Never includes purchase chatter (price, date, "I bought", refund).
 */
export interface MonitorShoppingQueryPlan {
  query: string;
  strategy: string;
}

export function buildMonitorShoppingQueryPlan(
  fp: TargetMatchFingerprint,
): MonitorShoppingQueryPlan {
  const model = (fp.model_number ?? "").trim();
  const upc = (fp.upc_or_gtin ?? "").trim();
  const tcin = (fp.target_item_id ?? "").trim();
  const title = (fp.product_title ?? "").trim();
  const brand = (fp.brand ?? "").trim();

  const parts: string[] = [];

  const cleanTitle = title
    .replace(/\b(i bought|purchased|today|yesterday|refund|monitoring)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedTitle = cleanTitle.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const normalizedModel = model.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

  // A confirmed title containing the complete model-equivalent is the least
  // restrictive governed primary query. Matching still requires strong evidence.
  if (
    normalizedTitle &&
    normalizedModel &&
    ` ${normalizedTitle} `.includes(` ${normalizedModel} `)
  ) {
    parts.push(cleanTitle);
    parts.push("Target");
    return {
      query: parts.filter(Boolean).join(" "),
      strategy: "title_contains_model",
    };
  }

  // Primary identity: brand + model when model exists
  if (parts.length === 0 && model) {
    if (brand && !model.toLowerCase().includes(brand.toLowerCase())) {
      parts.push(brand);
    }
    parts.push(model);
    // Compact secondary: TCIN helps Shopping surface the exact SKU page
    if (tcin && !parts.includes(tcin)) {
      parts.push(tcin);
    }
    parts.push("Target");
    return {
      query: parts.filter(Boolean).join(" "),
      strategy: "model_primary",
    };
  } else if (parts.length === 0 && upc) {
    parts.push(upc);
    parts.push("Target");
    return {
      query: parts.filter(Boolean).join(" "),
      strategy: "upc_primary",
    };
  } else if (parts.length === 0 && title) {
    // Collapse whitespace; drop noisy purchase language if it leaked into title
    if (cleanTitle) parts.push(cleanTitle);
    if (tcin && !parts.includes(tcin)) parts.push(tcin);
    parts.push("Target");
    return {
      query: parts.filter(Boolean).join(" "),
      strategy: "title_slug_primary",
    };
  } else if (parts.length === 0 && tcin) {
    parts.push(tcin);
    parts.push("Target");
    return {
      query: parts.filter(Boolean).join(" "),
      strategy: "tcin_primary",
    };
  } else if (parts.length === 0 && brand) {
    parts.push(brand);
    parts.push("Target");
    return {
      query: parts.filter(Boolean).join(" "),
      strategy: "brand_primary",
    };
  } else if (parts.length === 0) {
    try {
      const u = new URL(fp.target_product_url);
      const slug = u.pathname.split("/").filter(Boolean)[1] ?? "product";
      parts.push(slug.replace(/-/g, " "));
    } catch {
      parts.push("product");
    }
  }

  parts.push("Target");
  return {
    query: parts.filter(Boolean).join(" "),
    strategy: "url_slug_fallback",
  };
}

export function buildMonitorShoppingQuery(fp: TargetMatchFingerprint): string {
  return buildMonitorShoppingQueryPlan(fp).query;
}

function hashOffers(offers: MatchableOffer[]): string {
  return createHash("sha256")
    .update(
      offers
        .map(
          (o) =>
            `${o.offer_id}|${o.observed_price}|${o.merchant_link ?? o.link ?? ""}|${o.title}`,
        )
        .join(";"),
    )
    .digest("hex");
}

export function shoppingResultToObservation(
  shopping: SerpApiShoppingResult,
  query: string,
  observedAt: string,
): MonitorObservationInput {
  const offers: MatchableOffer[] = (shopping.offers ?? []).map((o) =>
    toMatchableOffer(o),
  );
  return {
    offers,
    provider_status: shopping.provider_status,
    observed_at: observedAt,
    query,
    raw_result_hash: hashOffers(offers),
    consumed_search: true,
  };
}

/**
 * Build ObservationFetcher that calls live SerpApi (or injected client).
 * Never returns fixture offers.
 */
export function createLiveSerpApiObservationFetcher(deps?: {
  client?: SerpApiShoppingClient | null;
  /** Inject for tests — never production. */
  searchImpl?: (query: {
    q: string;
  }) => Promise<SerpApiShoppingResult>;
}): ObservationFetcher {
  return async ({ fingerprint, as_of }) => {
    const query = buildMonitorShoppingQuery(fingerprint);
    const observedAt = as_of;

    if (deps?.searchImpl) {
      const shopping = await deps.searchImpl({ q: query });
      return shoppingResultToObservation(shopping, query, observedAt);
    }

    const client =
      deps?.client !== undefined
        ? deps.client
        : createSerpApiClientFromEnv();

    if (!client) {
      return {
        offers: [],
        provider_status: "PROVIDER_ERROR",
        observed_at: observedAt,
        query,
        raw_result_hash: createHash("sha256")
          .update("serpapi_not_configured")
          .digest("hex"),
        consumed_search: true,
      };
    }

    try {
      const shopping = await client.searchShopping({
        q: query,
        gl: "us",
        hl: "en",
        location: "Austin, Texas, United States",
        device: "desktop",
        timeout_ms: 20_000,
      });
      let offers: MatchableOffer[] = (shopping.offers ?? []).map((o) =>
        toMatchableOffer(o),
      );

      // If no offer already matches the locked fingerprint, try one immersive
      // resolve to recover Target.com URL / TCIN (new Shopping layout gap).
      const anyMatch = offers.some(
        (o) => offerMatchesLockedFingerprint(fingerprint, o).match,
      );
      if (!anyMatch) {
        try {
          const enriched = await enrichOffersWithImmersiveTargetLinks({
            client,
            offers,
            reference_title: fingerprint.product_title,
            expected_tcin: fingerprint.target_item_id,
            max_immersive_searches: 1,
          });
          offers = enriched.offers;
        } catch {
          // Immersive failure must not invent data — keep shopping offers.
        }
      }

      return {
        offers,
        provider_status: shopping.provider_status,
        observed_at: observedAt,
        query,
        raw_result_hash: hashOffers(offers),
        consumed_search: true,
      };
    } catch {
      return {
        offers: [],
        provider_status: "PROVIDER_ERROR",
        observed_at: observedAt,
        query,
        raw_result_hash: createHash("sha256")
          .update(`serpapi_error|${query}`)
          .digest("hex"),
        consumed_search: true,
      };
    }
  };
}
