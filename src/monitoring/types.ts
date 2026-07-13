import type { LockedProductFingerprint } from "../domain/product-fingerprint.js";
import type { MatchableOffer } from "../matching/types.js";
import type { ProviderStatus } from "../domain/enums.js";

export type MonitorMode = "manual" | "scheduled";

export type MonitorRunOutcome =
  | "checked"
  | "skipped"
  | "error";

export type MonitorSkipReason =
  | "not_monitoring_active"
  | "missing_locked_fingerprint"
  | "window_expired"
  | "budget_exhausted"
  | "already_checked_this_tick"
  | null;

export interface SearchBudgetSnapshot {
  period_key: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface ActivePurchase {
  id: string;
  status: string;
  purchase_price: number;
  currency: string;
  purchase_date: string;
  purchase_channel: string;
  country: string;
  region: string | null;
  fingerprint_id: string;
  monitoring_deadline: string | null;
  is_target_plus: number;
  known_exclusion: string | null;
}

export interface MonitorObservationInput {
  offers: MatchableOffer[];
  provider_status?: ProviderStatus | string;
  observed_at?: string;
  query?: string;
  raw_result_hash?: string;
  /** When true, this check consumed a SerpApi search credit. */
  consumed_search: boolean;
}

/** Injected observation source — fixtures/tests; no live calls required. */
export type ObservationFetcher = (args: {
  purchase: ActivePurchase;
  fingerprint: LockedProductFingerprint;
  as_of: string;
}) => Promise<MonitorObservationInput> | MonitorObservationInput;

export interface PriceDropAlert {
  id: string;
  purchase_id: string;
  fingerprint_id: string;
  observation_id: string;
  purchase_price: number;
  observed_price: number;
  potential_recovery: number;
  currency: string;
  alert_key: string;
  status: "PRICE_DROP_DETECTED";
  disclaimer: string;
  created_at: string;
}

export interface MonitorCheckResult {
  purchase_id: string;
  outcome: MonitorRunOutcome;
  skip_reason: MonitorSkipReason;
  searches_consumed: number;
  observation_id?: string;
  alert_id?: string;
  alert_created: boolean;
  match_ok: boolean;
  match_reasons: string[];
  observed_price?: number;
  potential_recovery?: number;
  provider_status?: string;
  notes: string[];
  monitor_run_id: string;
}

export interface MonitorBatchResult {
  as_of: string;
  mode: MonitorMode;
  budget_before: SearchBudgetSnapshot;
  budget_after: SearchBudgetSnapshot;
  results: MonitorCheckResult[];
  alerts_created: number;
  searches_consumed: number;
}
