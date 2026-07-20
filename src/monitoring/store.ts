import { randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/migrator.js";
import type { LockedProductFingerprint } from "../domain/product-fingerprint.js";
import {
  DEFAULT_MONTHLY_SEARCH_LIMIT,
  budgetPeriodKey,
  snapshotBudget,
} from "./budget.js";
import type {
  ActivePurchase,
  MonitorMode,
  MonitorRunOutcome,
  MonitorSkipReason,
  PriceDropAlert,
  SearchBudgetSnapshot,
} from "./types.js";
import type { PurchaseSelectionRow } from "./selection.js";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function loadSearchBudget(
  db: NobuDatabase,
  asOfIso: string,
  limit = DEFAULT_MONTHLY_SEARCH_LIMIT,
): SearchBudgetSnapshot {
  const period = budgetPeriodKey(asOfIso);
  const row = db
    .prepare(
      `SELECT period_key, used_count, limit_count FROM search_budget_ledger WHERE period_key = ?`,
    )
    .get(period) as
    | { period_key: string; used_count: number; limit_count: number }
    | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO search_budget_ledger (period_key, used_count, limit_count, updated_at)
       VALUES (?, 0, ?, ?)`,
    ).run(period, limit, asOfIso);
    return snapshotBudget({ period_key: period, limit, used: 0 });
  }

  return snapshotBudget({
    period_key: row.period_key,
    limit: row.limit_count,
    used: row.used_count,
  });
}

export function saveSearchBudget(
  db: NobuDatabase,
  budget: SearchBudgetSnapshot,
  asOfIso: string,
): void {
  db.prepare(
    `INSERT INTO search_budget_ledger (period_key, used_count, limit_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(period_key) DO UPDATE SET
       used_count = excluded.used_count,
       limit_count = excluded.limit_count,
       updated_at = excluded.updated_at`,
  ).run(budget.period_key, budget.used, budget.limit, asOfIso);
}

export function listPurchaseRows(db: NobuDatabase): PurchaseSelectionRow[] {
  return db
    .prepare(
      `SELECT id, status, purchase_price, currency, purchase_date, purchase_channel,
              country, region, fingerprint_id, monitoring_deadline, is_target_plus,
              known_exclusion
       FROM purchases`,
    )
    .all() as unknown as PurchaseSelectionRow[];
}

/** Optional schedule columns (Lane 7.3B). Missing columns → nulls. */
export function loadPurchaseScheduleFields(
  db: NobuDatabase,
  purchaseId: string,
): {
  last_checked_at: string | null;
  next_check_at: string | null;
  check_lock_until: string | null;
  provider_backoff_until: string | null;
} {
  try {
    const row = db
      .prepare(
        `SELECT last_checked_at, next_check_at, check_lock_until, provider_backoff_until
         FROM purchases WHERE id = ?`,
      )
      .get(purchaseId) as
      | {
          last_checked_at: string | null;
          next_check_at: string | null;
          check_lock_until: string | null;
          provider_backoff_until: string | null;
        }
      | undefined;
    return {
      last_checked_at: row?.last_checked_at ?? null,
      next_check_at: row?.next_check_at ?? null,
      check_lock_until: row?.check_lock_until ?? null,
      provider_backoff_until: row?.provider_backoff_until ?? null,
    };
  } catch {
    return {
      last_checked_at: null,
      next_check_at: null,
      check_lock_until: null,
      provider_backoff_until: null,
    };
  }
}

export function loadFingerprint(
  db: NobuDatabase,
  fingerprintId: string,
): LockedProductFingerprint | null {
  const row = db
    .prepare(
      `SELECT fingerprint_json FROM product_fingerprints WHERE fingerprint_id = ?`,
    )
    .get(fingerprintId) as { fingerprint_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.fingerprint_json) as LockedProductFingerprint;
}

export function markPurchaseWindowExpired(
  db: NobuDatabase,
  purchaseId: string,
  asOfIso: string,
): void {
  db.prepare(
    `UPDATE purchases SET status = ?, updated_at = ? WHERE id = ?`,
  ).run("WINDOW_EXPIRED", asOfIso, purchaseId);
}

export function insertMonitorRun(args: {
  db: NobuDatabase;
  purchase_id: string;
  mode: MonitorMode;
  outcome: MonitorRunOutcome;
  skip_reason: MonitorSkipReason;
  searches_consumed: number;
  observation_id?: string | null;
  alert_id?: string | null;
  provider_status?: string | null;
  match_result?: string | null;
  notes?: string;
  started_at: string;
  finished_at: string;
}): string {
  const id = newId("run");
  args.db
    .prepare(
      `INSERT INTO monitor_runs (
        id, purchase_id, mode, outcome, skip_reason, searches_consumed,
        observation_id, alert_id, provider_status, match_result, notes,
        started_at, finished_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      args.purchase_id,
      args.mode,
      args.outcome,
      args.skip_reason,
      args.searches_consumed,
      args.observation_id ?? null,
      args.alert_id ?? null,
      args.provider_status ?? null,
      args.match_result ?? null,
      args.notes ?? null,
      args.started_at,
      args.finished_at,
    );
  return id;
}

export function insertPriceObservation(args: {
  db: NobuDatabase;
  purchase: ActivePurchase;
  fingerprint_id: string;
  offer_title: string;
  seller_kind: string;
  seller_text: string;
  product_url?: string | null;
  target_item_id?: string | null;
  model_number?: string | null;
  upc_or_gtin?: string | null;
  observed_price?: number | null;
  currency?: string | null;
  observed_at: string;
  is_target_plus: boolean;
  provider_status: string;
  query?: string | null;
  raw_result_hash?: string | null;
  matching_rule_version?: string | null;
  provenance_json: string;
}): string {
  const id = newId("obs");
  args.db
    .prepare(
      `INSERT INTO price_observations (
        id, purchase_id, fingerprint_id, provider_status, seller_kind, seller_text,
        product_title, product_url, target_item_id, model_number, upc_or_gtin,
        observed_price, currency, observed_at, is_target_plus, price_source_type,
        provider, engine, query, location, country, language, device,
        raw_result_hash, matching_rule_version, provenance_json, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      args.purchase.id,
      args.fingerprint_id,
      args.provider_status,
      args.seller_kind,
      args.seller_text,
      args.offer_title,
      args.product_url ?? null,
      args.target_item_id ?? null,
      args.model_number ?? null,
      args.upc_or_gtin ?? null,
      args.observed_price ?? null,
      args.currency ?? args.purchase.currency,
      args.observed_at,
      args.is_target_plus ? 1 : 0,
      "THIRD_PARTY_SEARCH_OBSERVATION",
      "SerpApi",
      "google_shopping",
      args.query ?? null,
      null,
      args.purchase.country,
      "en",
      "desktop",
      args.raw_result_hash ?? null,
      args.matching_rule_version ?? null,
      args.provenance_json,
      args.observed_at,
    );
  return id;
}

/** Insert alert if alert_key is new; returns { id, created }. */
export function insertAlertIdempotent(
  db: NobuDatabase,
  alert: PriceDropAlert,
): { id: string; created: boolean } {
  const existing = db
    .prepare(`SELECT id FROM alerts WHERE alert_key = ?`)
    .get(alert.alert_key) as { id: string } | undefined;
  if (existing) {
    return { id: existing.id, created: false };
  }

  db.prepare(
    `INSERT INTO alerts (
      id, purchase_id, fingerprint_id, observation_id, purchase_price,
      observed_price, potential_recovery, currency, alert_key, status,
      disclaimer, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    alert.id,
    alert.purchase_id,
    alert.fingerprint_id,
    alert.observation_id,
    alert.purchase_price,
    alert.observed_price,
    alert.potential_recovery,
    alert.currency,
    alert.alert_key,
    alert.status,
    alert.disclaimer,
    alert.created_at,
  );
  return { id: alert.id, created: true };
}

export function countAlertsForPurchase(
  db: NobuDatabase,
  purchaseId: string,
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM alerts WHERE purchase_id = ?`)
    .get(purchaseId) as { c: number };
  return row.c;
}
