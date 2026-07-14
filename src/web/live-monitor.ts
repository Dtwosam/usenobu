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
import type { LockedProductFingerprint } from "../domain/product-fingerprint.js";

/**
 * Deterministic live query from locked fingerprint.
 * Prefer strong identifiers in order: model → UPC → TCIN → title → brand → Target.
 * Never includes purchase chatter (price, date, "I bought", refund).
 */
export function buildMonitorShoppingQuery(fp: LockedProductFingerprint): string {
  const model = (fp.model_number ?? "").trim();
  const upc = (fp.upc_or_gtin ?? "").trim();
  const tcin = (fp.target_item_id ?? "").trim();
  const title = (fp.product_title ?? "").trim();
  const brand = (fp.brand ?? "").trim();

  const parts: string[] = [];

  // Primary identity: brand + model when model exists
  if (model) {
    if (brand && !model.toLowerCase().includes(brand.toLowerCase())) {
      parts.push(brand);
    }
    parts.push(model);
  } else if (upc) {
    parts.push(upc);
  } else if (tcin) {
    parts.push(tcin);
  } else if (title) {
    // Collapse whitespace; drop noisy purchase language if it leaked into title
    const cleanTitle = title
      .replace(/\b(i bought|purchased|today|yesterday|refund|monitoring)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleanTitle) parts.push(cleanTitle);
  } else if (brand) {
    parts.push(brand);
  } else {
    try {
      const u = new URL(fp.target_product_url);
      const slug = u.pathname.split("/").filter(Boolean)[1] ?? "product";
      parts.push(slug.replace(/-/g, " "));
    } catch {
      parts.push("product");
    }
  }

  // Optional secondary disambiguators when primary was model (not already included)
  if (model && upc && !parts.includes(upc)) {
    // Keep query compact: model-first path does not always need UPC
  }

  parts.push("Target");
  return parts.filter(Boolean).join(" ");
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
      return shoppingResultToObservation(shopping, query, observedAt);
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
