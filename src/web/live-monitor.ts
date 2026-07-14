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

export function buildMonitorShoppingQuery(fp: LockedProductFingerprint): string {
  const parts = [
    fp.model_number,
    fp.target_item_id,
    fp.upc_or_gtin,
    fp.product_title,
    "Target",
  ].filter(Boolean);
  if (parts.length >= 2) return parts.join(" ");
  try {
    const u = new URL(fp.target_product_url);
    const slug = u.pathname.split("/").filter(Boolean)[1] ?? "product";
    return `${slug.replace(/-/g, " ")} Target`;
  } catch {
    return "Target product";
  }
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
