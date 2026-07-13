/**
 * Logical database models for Lane 1 tables.
 * Production target: PostgreSQL. Local proof uses SQLite with equivalent columns.
 */

export interface PolicyVersionRow {
  id: string;
  policy_id: string;
  version: string;
  jurisdiction: string;
  purchase_channel: string;
  status: string;
  verified_at: string;
  source_url: string;
  window_days: number;
  payload_json: string;
  created_at: string;
}

export interface PurchaseRow {
  id: string;
  user_ref: string | null;
  target_product_url: string;
  purchase_price: number;
  currency: string;
  purchase_date: string;
  country: string;
  region: string | null;
  purchase_channel: string;
  model_number: string | null;
  upc_or_gtin: string | null;
  target_item_id: string | null;
  is_target_plus: number;
  known_exclusion: string | null;
  status: string;
  fingerprint_id: string | null;
  monitoring_deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductMatchRow {
  id: string;
  purchase_id: string;
  lifecycle: string;
  fingerprint_id: string | null;
  seller_kind: string;
  seller_text: string;
  product_title: string;
  product_url: string;
  target_item_id: string | null;
  model_number: string | null;
  upc_or_gtin: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  weight: string | null;
  quantity: string | null;
  observed_price: number | null;
  currency: string | null;
  is_target_plus: number;
  confirmed_at: string | null;
  fingerprint_json: string | null;
  created_at: string;
}

export interface PriceObservationRow {
  id: string;
  purchase_id: string | null;
  fingerprint_id: string | null;
  provider_status: string;
  seller_kind: string;
  seller_text: string;
  product_title: string;
  product_url: string | null;
  target_item_id: string | null;
  model_number: string | null;
  upc_or_gtin: string | null;
  observed_price: number | null;
  currency: string | null;
  observed_at: string;
  is_target_plus: number;
  price_source_type: string;
  provider: string | null;
  engine: string | null;
  query: string | null;
  location: string | null;
  country: string | null;
  language: string | null;
  device: string | null;
  raw_result_hash: string | null;
  matching_rule_version: string | null;
  provenance_json: string;
  created_at: string;
}

export const TABLE_NAMES = [
  "policy_versions",
  "purchases",
  "product_matches",
  "price_observations",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
