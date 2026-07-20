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

/** Lane 8-R1A operational review metadata (separate from approved rule payload). */
export interface PolicyOperationsRow {
  policy_id: string;
  policy_version: string;
  approved_at: string;
  source_url: string;
  source_last_checked_at: string;
  next_review_at: string;
  review_state: string;
  source_fingerprint: string | null;
  last_owner_alert_at: string | null;
  review_note: string | null;
  retired_at: string | null;
  updated_at: string;
}

export interface PolicyOwnerAlertRow {
  id: string;
  policy_id: string;
  policy_version: string;
  alert_key: string;
  alert_type: string;
  status: string;
  message: string;
  created_at: string;
  cleared_at: string | null;
  last_notified_at: string | null;
}

export interface PolicyPendingReviewRow {
  id: string;
  policy_id: string;
  from_version: string;
  status: string;
  note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PolicyReviewEventRow {
  id: string;
  policy_id: string;
  policy_version: string;
  action: string;
  note: string | null;
  actor: string;
  created_at: string;
  payload_json: string;
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
  /** SerpApi/Google id — never treat as Target TCIN. */
  serpapi_product_id: string | null;
  match_decision: string | null;
  match_tier: string | null;
  match_rule_version: string | null;
  rejection_reason: string | null;
}

export interface ProductFingerprintRow {
  fingerprint_id: string;
  purchase_id: string;
  product_match_id: string;
  target_product_url: string;
  target_item_id: string | null;
  model_number: string | null;
  upc_or_gtin: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  weight: string | null;
  quantity: string | null;
  product_title: string | null;
  seller_kind: string;
  is_target_plus: number;
  match_rule_version: string;
  match_tier: string;
  fingerprint_json: string;
  confirmed_at: string;
  confirmed_by_user: number;
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

export interface MonitorRunRow {
  id: string;
  purchase_id: string;
  mode: string;
  outcome: string;
  skip_reason: string | null;
  searches_consumed: number;
  observation_id: string | null;
  alert_id: string | null;
  provider_status: string | null;
  match_result: string | null;
  notes: string | null;
  started_at: string;
  finished_at: string;
}

export interface AlertRow {
  id: string;
  purchase_id: string;
  fingerprint_id: string;
  observation_id: string;
  purchase_price: number;
  observed_price: number;
  potential_recovery: number;
  currency: string;
  alert_key: string;
  status: string;
  disclaimer: string;
  created_at: string;
}

export interface SearchBudgetLedgerRow {
  period_key: string;
  used_count: number;
  limit_count: number;
  updated_at: string;
}

export const TABLE_NAMES = [
  "policy_versions",
  "purchases",
  "product_matches",
  "price_observations",
  "product_fingerprints",
  "search_budget_ledger",
  "monitor_runs",
  "alerts",
  "policy_operations",
  "policy_owner_alerts",
  "policy_pending_reviews",
  "policy_review_events",
  "purchase_email_alert_prefs",
  "email_notifications",
  "closed_price_opportunities",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
