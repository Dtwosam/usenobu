import type { ProviderStatus, SellerKind } from "../domain/enums.js";

/** Server-side SerpApi Google Shopping query controls (data contract). */
export interface SerpApiShoppingQuery {
  /** Search query; prefer model/identifier + Target terms. */
  q: string;
  /** ISO country for Google (MVP: us). */
  gl?: string;
  /** Language (MVP: en). */
  hl?: string;
  /** Stable U.S. location string for consistent results. */
  location?: string;
  /** Device mode; default desktop. */
  device?: "desktop" | "mobile" | "tablet";
  /** When true, bypass provider cache if capacity permits. */
  no_cache?: boolean;
  /** Request timeout in milliseconds. */
  timeout_ms?: number;
}

export interface NormalizedShoppingOffer {
  title: string;
  link?: string;
  product_link?: string;
  source_text: string;
  seller_kind: SellerKind;
  is_target_plus: boolean;
  price_text?: string;
  extracted_price?: number;
  currency?: "USD";
  thumbnail?: string;
  /** Best-effort identifiers if present in payload (not matched optimistically). */
  product_id?: string;
  immersive_product_page_token?: string;
  raw_position?: number;
}

export interface SerpApiShoppingResult {
  provider: "SerpApi";
  engine: "google_shopping";
  /** Classification only — not Target eligibility and not optimistic matching. */
  provider_status: ProviderStatus;
  query: Required<
    Pick<SerpApiShoppingQuery, "q" | "gl" | "hl" | "location" | "device">
  > & {
    no_cache: boolean;
  };
  observed_at: string;
  offers: NormalizedShoppingOffer[];
  /** Target-seller offers only (filter, not fingerprint match). */
  target_offers: NormalizedShoppingOffer[];
  search_metadata?: {
    id?: string;
    status?: string;
    total_time_taken?: number;
    google_shopping_url?: string;
  };
  error_message?: string;
  /** SHA-256 of redacted raw JSON for audit. */
  raw_result_hash: string;
  /** Whether this result came from a live network call. */
  live: boolean;
  searches_recorded: number;
}

export interface SerpApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  usageCounter?: SearchUsageRecorder;
  /** Clock override for tests. */
  now?: () => Date;
}

export interface SearchUsageRecord {
  at: string;
  engine: "google_shopping";
  query: string;
  live: boolean;
  http_status?: number;
  provider_status?: ProviderStatus;
  error_class?: string;
}

export interface SearchUsageRecorder {
  record(entry: SearchUsageRecord): void;
  getCount(): number;
  getEntries(): readonly SearchUsageRecord[];
}

export interface CapabilityFieldReport {
  field: string;
  available: boolean;
  notes?: string;
  sample_redacted?: string | number | boolean | null;
}

export interface LiveCapabilityReport {
  audit_id: string;
  audited_at: string;
  live: boolean;
  provider: "SerpApi";
  engine: "google_shopping";
  query: string;
  location: string;
  provider_status: ProviderStatus;
  searches_consumed: number;
  target_offer_count: number;
  total_offer_count: number;
  fields: CapabilityFieldReport[];
  missing_fields: string[];
  notes: string[];
  /** Path to redacted fixture if written. */
  redacted_fixture_path?: string;
  disclaimer: string;
}
