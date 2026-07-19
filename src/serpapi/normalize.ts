import { createHash } from "node:crypto";
import {
  ProviderStatus,
  SellerKind,
  type ProviderStatus as ProviderStatusType,
} from "../domain/enums.js";
import type {
  NormalizedShoppingOffer,
  SerpApiShoppingQuery,
  SerpApiShoppingResult,
  ShoppingFilterGroup,
  ShoppingFilterOption,
} from "./types.js";
import { decodeShoppingTitle, titleLooksWellFormedUtf8 } from "./utf8.js";

export function hashRawPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json).digest("hex");
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function isGoogleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "google.com" ||
      host === "www.google.com" ||
      host.endsWith(".google.com")
    );
  } catch {
    return false;
  }
}

/**
 * Classify seller text only — no product matching, no optimistic Target promotion
 * from Google product links or title text alone.
 */
export function classifySeller(sourceText: string): {
  seller_kind: SellerKind;
  is_target_plus: boolean;
} {
  const s = sourceText.trim().toLowerCase();
  if (!s) {
    return { seller_kind: SellerKind.UNKNOWN, is_target_plus: false };
  }
  if (s.includes("target plus") || s.includes("targetplus")) {
    return { seller_kind: SellerKind.TARGET_PLUS, is_target_plus: true };
  }
  if (
    s === "target" ||
    s === "target.com" ||
    s.startsWith("target ") ||
    s.endsWith(" target") ||
    s.includes("target.com")
  ) {
    return { seller_kind: SellerKind.TARGET, is_target_plus: false };
  }
  return { seller_kind: SellerKind.OTHER, is_target_plus: false };
}

export function isTargetStoreFilterText(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.includes("target plus") || t.includes("targetplus")) return false;
  return t === "target" || t === "target.com" || t.startsWith("target ");
}

export function normalizeOffer(
  raw: unknown,
  index: number,
): NormalizedShoppingOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const rawTitle = typeof row.title === "string" ? row.title : "";
  const title = decodeShoppingTitle(rawTitle);
  if (!title) return null;

  const source =
    (typeof row.source === "string" && row.source) ||
    (typeof row.seller === "string" && row.seller) ||
    (typeof row.store === "string" && row.store) ||
    "";
  const { seller_kind, is_target_plus } = classifySeller(source);

  const extracted =
    parsePrice(row.extracted_price) ??
    parsePrice(row.price) ??
    parsePrice(row.old_price);

  const rawLink = typeof row.link === "string" ? row.link : undefined;
  const product_link =
    typeof row.product_link === "string" ? row.product_link : undefined;

  // Prefer explicit non-Google merchant URL; do not treat Google product_link as Target URL.
  let merchant_link: string | undefined;
  if (rawLink && !isGoogleHost(rawLink)) {
    merchant_link = rawLink;
  }

  return {
    title,
    title_utf8_ok: titleLooksWellFormedUtf8(title),
    merchant_link,
    product_link,
    link: rawLink ?? product_link,
    source_text: source || "unknown",
    seller_kind,
    is_target_plus,
    price_text: typeof row.price === "string" ? row.price : undefined,
    extracted_price: extracted,
    currency: extracted !== undefined ? "USD" : undefined,
    thumbnail: typeof row.thumbnail === "string" ? row.thumbnail : undefined,
    product_id:
      typeof row.product_id === "string"
        ? row.product_id
        : typeof row.product_id === "number"
          ? String(row.product_id)
          : undefined,
    immersive_product_page_token:
      typeof row.immersive_product_page_token === "string"
        ? row.immersive_product_page_token
        : undefined,
    raw_position:
      typeof row.position === "number" ? row.position : index + 1,
  };
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function collectShoppingRows(raw: Record<string, unknown>): {
  rows: unknown[];
  counts: {
    shopping_results_count: number;
    inline_shopping_results_count: number;
    categorized_results_count: number;
    organic_results_count: number;
  };
} {
  const rows: unknown[] = [];
  let categorized_results_count = 0;
  if (Array.isArray(raw.shopping_results)) {
    rows.push(...raw.shopping_results);
  }
  if (Array.isArray(raw.inline_shopping_results)) {
    rows.push(...raw.inline_shopping_results);
  }
  if (Array.isArray(raw.categorized_shopping_results)) {
    for (const cat of raw.categorized_shopping_results) {
      if (
        cat &&
          typeof cat === "object" &&
          Array.isArray((cat as { shopping_results?: unknown[] }).shopping_results)
        ) {
        const categorizedRows = (cat as { shopping_results: unknown[] })
          .shopping_results;
        categorized_results_count += categorizedRows.length;
        rows.push(...categorizedRows);
      }
    }
  }
  if (rows.length === 0 && Array.isArray(raw.organic_results)) {
    rows.push(...raw.organic_results);
  }
  return {
    rows,
    counts: {
      shopping_results_count: countArray(raw.shopping_results),
      inline_shopping_results_count: countArray(raw.inline_shopping_results),
      categorized_results_count,
      organic_results_count: countArray(raw.organic_results),
    },
  };
}

function extractFilterOptions(raw: unknown): ShoppingFilterOption[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const options: ShoppingFilterOption[] = [];
  if (Array.isArray(obj.options)) {
    for (const opt of obj.options) {
      if (!opt || typeof opt !== "object") continue;
      const o = opt as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text : "";
      if (!text) continue;
      options.push({
        text,
        shoprs: typeof o.shoprs === "string" ? o.shoprs : undefined,
        is_target_store_filter: isTargetStoreFilterText(text),
      });
    }
  }
  // Some payloads put shoprs on the filter node itself
  if (typeof obj.text === "string" && typeof obj.shoprs === "string") {
    options.push({
      text: obj.text,
      shoprs: obj.shoprs,
      is_target_store_filter: isTargetStoreFilterText(obj.text),
    });
  }
  return options;
}

export function extractFilters(raw: Record<string, unknown>): ShoppingFilterGroup[] {
  const groups: ShoppingFilterGroup[] = [];
  const buckets = [raw.filters, raw.carousel_filters, raw.shopping_filters];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (!item || typeof item !== "object") continue;
      const node = item as Record<string, unknown>;
      const options = extractFilterOptions(node);
      if (options.length === 0) continue;
      groups.push({
        type: typeof node.type === "string" ? node.type : undefined,
        options,
      });
    }
  }
  return groups;
}

export function resolveProviderStatus(args: {
  httpStatus?: number;
  bodyError?: string;
  offers: NormalizedShoppingOffer[];
  targetOffers: NormalizedShoppingOffer[];
  stale?: boolean;
}): ProviderStatusType {
  if (args.stale) return ProviderStatus.STALE_RESULT;

  if (args.httpStatus === 429) {
    return ProviderStatus.PROVIDER_RATE_LIMITED;
  }
  if (
    args.httpStatus !== undefined &&
    (args.httpStatus >= 500 || args.httpStatus === 401 || args.httpStatus === 403)
  ) {
    return ProviderStatus.PROVIDER_ERROR;
  }
  if (args.bodyError) {
    const lower = args.bodyError.toLowerCase();
    if (
      lower.includes("rate limit") ||
      lower.includes("too many") ||
      lower.includes("run out of searches") ||
      lower.includes("out of searches")
    ) {
      return ProviderStatus.PROVIDER_RATE_LIMITED;
    }
    return ProviderStatus.PROVIDER_ERROR;
  }

  if (args.targetOffers.length === 0) {
    return ProviderStatus.NO_TARGET_RESULT;
  }
  if (args.targetOffers.length === 1) {
    return ProviderStatus.LIVE_TARGET_MATCH;
  }
  return ProviderStatus.AMBIGUOUS_TARGET_RESULTS;
}

export function normalizeShoppingResponse(args: {
  raw: unknown;
  query: {
    q: string;
    gl: string;
    hl: string;
    location: string;
    device: "desktop" | "mobile" | "tablet";
    no_cache: boolean;
    shoprs?: string;
  };
  observedAt: string;
  live: boolean;
  searchesRecorded: number;
  httpStatus?: number;
}): SerpApiShoppingResult {
  const raw = (args.raw ?? {}) as Record<string, unknown>;
  const bodyError =
    typeof raw.error === "string"
      ? raw.error
      : typeof raw.error === "object" &&
          raw.error &&
          typeof (raw.error as { message?: string }).message === "string"
        ? (raw.error as { message: string }).message
        : undefined;

  const collected = collectShoppingRows(raw);
  const shopping = collected.rows;
  const offers: NormalizedShoppingOffer[] = [];
  for (let i = 0; i < shopping.length; i++) {
    const offer = normalizeOffer(shopping[i], i);
    if (offer) offers.push(offer);
  }

  const targetOffers = offers.filter(
    (o) => o.seller_kind === SellerKind.TARGET && !o.is_target_plus,
  );

  const filters = extractFilters(raw);
  const target_shoprs_tokens = filters
    .flatMap((g) => g.options)
    .filter((o) => o.is_target_store_filter && o.shoprs)
    .map((o) => o.shoprs as string);

  const meta =
    raw.search_metadata && typeof raw.search_metadata === "object"
      ? (raw.search_metadata as Record<string, unknown>)
      : undefined;

  const provider_status = resolveProviderStatus({
    httpStatus: args.httpStatus,
    bodyError,
    offers,
    targetOffers,
  });

  return {
    provider: "SerpApi",
    engine: "google_shopping",
    provider_status,
    query: args.query,
    observed_at: args.observedAt,
    offers,
    target_offers: targetOffers,
    result_counts: {
      ...collected.counts,
      normalized_offers_count: offers.length,
      target_offers_count: targetOffers.length,
    },
    filters,
    target_shoprs_tokens: [...new Set(target_shoprs_tokens)],
    search_metadata: meta
      ? {
          id: typeof meta.id === "string" ? meta.id : undefined,
          status: typeof meta.status === "string" ? meta.status : undefined,
          total_time_taken:
            typeof meta.total_time_taken === "number"
              ? meta.total_time_taken
              : undefined,
          google_shopping_url:
            typeof meta.google_shopping_url === "string"
              ? meta.google_shopping_url
              : undefined,
        }
      : undefined,
    error_message: bodyError,
    raw_result_hash: hashRawPayload(args.raw),
    live: args.live,
    searches_recorded: args.searchesRecorded,
  };
}

export type { SerpApiShoppingQuery };
