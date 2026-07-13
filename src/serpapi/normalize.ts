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
} from "./types.js";

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
  // Exact-ish Target seller labels; do not treat "Target" substring in other brands as Target.
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

export function normalizeOffer(raw: unknown, index: number): NormalizedShoppingOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
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

  const link =
    (typeof row.link === "string" && row.link) ||
    (typeof row.product_link === "string" && row.product_link) ||
    undefined;
  const product_link =
    typeof row.product_link === "string" ? row.product_link : undefined;

  return {
    title,
    link,
    product_link,
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
    // Connector only classifies a single Target-seller offer; matching is Lane 4.
    return ProviderStatus.LIVE_TARGET_MATCH;
  }
  return ProviderStatus.AMBIGUOUS_TARGET_RESULTS;
}

export function normalizeShoppingResponse(args: {
  raw: unknown;
  query: Required<
    Pick<SerpApiShoppingQuery, "q" | "gl" | "hl" | "location" | "device">
  > & { no_cache: boolean };
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

  const shopping =
    (Array.isArray(raw.shopping_results) && raw.shopping_results) ||
    (Array.isArray(raw.organic_results) && raw.organic_results) ||
    [];

  const offers: NormalizedShoppingOffer[] = [];
  for (let i = 0; i < shopping.length; i++) {
    const offer = normalizeOffer(shopping[i], i);
    if (offer) offers.push(offer);
  }

  const targetOffers = offers.filter(
    (o) => o.seller_kind === SellerKind.TARGET && !o.is_target_plus,
  );

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
