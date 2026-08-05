/**
 * Bounded scheduled monitoring pass (Lane 7.3B).
 * Respects search budget, 24h cadence, batch size, and prioritization.
 */
import type { NobuDatabase } from "../db/migrator.js";
import { canConsumeSearches } from "./budget.js";
import { runMonitoringPass } from "./runner.js";
import {
  DEFAULT_SCHEDULED_BATCH_SIZE,
  isDueForScheduledCheck,
  prioritizeScheduledPurchases,
  type PurchaseScheduleRow,
  acquireCheckLock,
  releaseCheckLock,
  updatePurchaseSchedule,
} from "./schedule.js";
import { isExpiredPurchase, selectActivePurchases } from "./selection.js";
import {
  listPurchaseRows,
  loadSearchBudget,
  markPurchaseWindowExpired,
  insertMonitorRun,
} from "./store.js";
import type { ObservationFetcher } from "./types.js";

export interface ScheduledMonitorOptions {
  db: NobuDatabase;
  as_of?: string;
  batch_size?: number;
  monthly_search_limit?: number;
  /** Required — inject live or fixture fetcher (avoids circular imports). */
  fetchObservation: ObservationFetcher;
  /** When false, skip email side-effects (tests that only care about checks). */
  process_emails?: boolean;
  /**
   * Lane 7.4F — durable AuthStore for verified-account email lookup when
   * purchases DB is per-instance and accounts live elsewhere.
   */
  accountStore?: unknown;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * Durable AuthStore for authoritative search-budget reservation.
   * Local ledger is cache only — provider fetch requires durable reserve.
   */
  durableAuthStore?: {
    tryReserveSearchBudget: (args: {
      periodKey: string;
      limitCount: number;
      nowIso: string;
    }) => Promise<{ reserved: boolean; used: number }>;
  };
  durableBudgetPeriodKey?: string;
  durableMonthlySearchLimit?: number;
}

export interface ScheduledMonitorResult {
  as_of: string;
  considered: number;
  due: number;
  processed: number;
  skipped_not_due: number;
  skipped_budget: number;
  searches_consumed: number;
  alerts_created: number;
  emails_attempted: number;
  results: Array<{
    purchase_id: string;
    outcome: string;
    skip_reason: string | null;
    alert_created: boolean;
  }>;
}

function loadScheduleRows(db: NobuDatabase): PurchaseScheduleRow[] {
  const base = listPurchaseRows(db);
  const out: PurchaseScheduleRow[] = [];
  for (const row of base) {
    if (row.status !== "MONITORING_ACTIVE" || !row.fingerprint_id) continue;
    const extra = db
      .prepare(
        `SELECT last_checked_at, next_check_at, check_lock_until,
                provider_backoff_until, last_skip_reason
         FROM purchases WHERE id = ?`,
      )
      .get(row.id) as
      | {
          last_checked_at: string | null;
          next_check_at: string | null;
          check_lock_until: string | null;
          provider_backoff_until: string | null;
          last_skip_reason: string | null;
        }
      | undefined;
    out.push({
      id: row.id,
      status: row.status,
      purchase_price: row.purchase_price,
      currency: row.currency,
      purchase_date: row.purchase_date,
      purchase_channel: row.purchase_channel,
      country: row.country,
      region: row.region,
      fingerprint_id: row.fingerprint_id,
      monitoring_deadline: row.monitoring_deadline,
      is_target_plus: row.is_target_plus,
      known_exclusion: row.known_exclusion,
      last_checked_at: extra?.last_checked_at ?? null,
      next_check_at: extra?.next_check_at ?? null,
      check_lock_until: extra?.check_lock_until ?? null,
      provider_backoff_until: extra?.provider_backoff_until ?? null,
      last_skip_reason: extra?.last_skip_reason ?? null,
    });
  }
  return out;
}

/**
 * Run one controlled scheduler tick.
 * Does not continuously poll; processes a bounded due batch only.
 */
export async function runScheduledMonitoringTick(
  options: ScheduledMonitorOptions,
): Promise<ScheduledMonitorResult> {
  const asOf = options.as_of ?? new Date().toISOString();
  const batchSize = options.batch_size ?? DEFAULT_SCHEDULED_BATCH_SIZE;
  const processEmails = options.process_emails !== false;

  // Expire windows first
  const allRows = listPurchaseRows(options.db);
  for (const row of allRows) {
    if (
      row.status === "MONITORING_ACTIVE" &&
      row.fingerprint_id &&
      isExpiredPurchase(row, asOf)
    ) {
      markPurchaseWindowExpired(options.db, row.id, asOf);
      insertMonitorRun({
        db: options.db,
        purchase_id: row.id,
        mode: "scheduled",
        outcome: "skipped",
        skip_reason: "window_expired",
        searches_consumed: 0,
        notes: "expired_before_search",
        started_at: asOf,
        finished_at: asOf,
      });
      updatePurchaseSchedule({
        db: options.db,
        purchaseId: row.id,
        asOf,
        skipReason: "window_expired",
      });
    }
  }

  const scheduleRows = loadScheduleRows(options.db);
  // Only monitorable (active window)
  const activeIds = new Set(
    selectActivePurchases(listPurchaseRows(options.db), asOf).map((p) => p.id),
  );
  const candidates = prioritizeScheduledPurchases(
    scheduleRows.filter((r) => activeIds.has(r.id)),
  );

  let skipped_not_due = 0;
  const due: PurchaseScheduleRow[] = [];
  for (const row of candidates) {
    const check = isDueForScheduledCheck({
      next_check_at: row.next_check_at,
      provider_backoff_until: row.provider_backoff_until,
      check_lock_until: row.check_lock_until,
      as_of: asOf,
    });
    if (!check.due) {
      skipped_not_due += 1;
      updatePurchaseSchedule({
        db: options.db,
        purchaseId: row.id,
        asOf,
        skipReason: check.reason,
      });
      continue;
    }
    due.push(row);
  }

  const budget = loadSearchBudget(
    options.db,
    asOf,
    options.monthly_search_limit,
  );
  let remainingBudget = budget.remaining;
  let skipped_budget = 0;

  const toProcess: PurchaseScheduleRow[] = [];
  for (const row of due) {
    if (toProcess.length >= batchSize) break;
    if (remainingBudget <= 0 || !canConsumeSearches(budget, 1)) {
      skipped_budget += 1;
      updatePurchaseSchedule({
        db: options.db,
        purchaseId: row.id,
        asOf,
        skipReason: "budget_exhausted",
      });
      insertMonitorRun({
        db: options.db,
        purchase_id: row.id,
        mode: "scheduled",
        outcome: "skipped",
        skip_reason: "budget_exhausted",
        searches_consumed: 0,
        notes: "budget_exhausted_before_search",
        started_at: asOf,
        finished_at: asOf,
      });
      continue;
    }
    if (!acquireCheckLock(options.db, row.id, asOf)) {
      updatePurchaseSchedule({
        db: options.db,
        purchaseId: row.id,
        asOf,
        skipReason: "check_in_progress",
      });
      continue;
    }
    toProcess.push(row);
    remainingBudget -= 1;
  }

  const results: ScheduledMonitorResult["results"] = [];
  let searches_consumed = 0;
  let alerts_created = 0;
  let emails_attempted = 0;

  for (const row of toProcess) {
    try {
      // Authoritative durable budget — local ledger cannot authorize spend.
      if (options.durableAuthStore && options.durableBudgetPeriodKey) {
        const reserved = await options.durableAuthStore.tryReserveSearchBudget({
          periodKey: options.durableBudgetPeriodKey,
          limitCount:
            options.durableMonthlySearchLimit ??
            options.monthly_search_limit ??
            500,
          nowIso: asOf,
        });
        if (!reserved.reserved) {
          releaseCheckLock(options.db, row.id, asOf);
          skipped_budget += 1;
          updatePurchaseSchedule({
            db: options.db,
            purchaseId: row.id,
            asOf,
            skipReason: "budget_exhausted",
          });
          insertMonitorRun({
            db: options.db,
            purchase_id: row.id,
            mode: "scheduled",
            outcome: "skipped",
            skip_reason: "budget_exhausted",
            searches_consumed: 0,
            notes: "durable_budget_exhausted_before_provider",
            started_at: asOf,
            finished_at: asOf,
          });
          results.push({
            purchase_id: row.id,
            outcome: "skipped",
            skip_reason: "budget_exhausted",
            alert_created: false,
          });
          continue;
        }
      }

      const batch = await runMonitoringPass({
        db: options.db,
        mode: "scheduled",
        as_of: asOf,
        purchase_id: row.id,
        fetchObservation: options.fetchObservation,
        monthly_search_limit: options.monthly_search_limit,
      });

      const check = batch.results[0];
      searches_consumed += batch.searches_consumed;
      alerts_created += batch.alerts_created;

      const providerFailed =
        check?.provider_status === "PROVIDER_ERROR" ||
        check?.provider_status === "RATE_LIMITED" ||
        check?.notes?.some((n) => n.includes("provider"));

      if (check?.outcome === "checked") {
        if (providerFailed && !check.observation_id) {
          updatePurchaseSchedule({
            db: options.db,
            purchaseId: row.id,
            asOf,
            providerFailed: true,
            skipReason: "provider_failure",
          });
        } else {
          updatePurchaseSchedule({
            db: options.db,
            purchaseId: row.id,
            asOf,
            checked: true,
          });
        }
      } else {
        updatePurchaseSchedule({
          db: options.db,
          purchaseId: row.id,
          asOf,
          skipReason: check?.skip_reason ?? "skipped",
          clearLock: true,
        });
      }

      results.push({
        purchase_id: row.id,
        outcome: check?.outcome ?? "skipped",
        skip_reason: check?.skip_reason ?? null,
        alert_created: check?.alert_created ?? false,
      });

      if (processEmails && batch.alerts_created > 0) {
        const { processNewAlertsFromMonitorBatch } = await import(
          "../notifications/process.js"
        );
        const emailResults = await processNewAlertsFromMonitorBatch({
          db: options.db,
          results: batch.results,
          nowIso: asOf,
          env: options.env,
          accountStore: options.accountStore as
            | Awaited<
                ReturnType<typeof import("../auth/auth-store.js").getAuthStore>
              >
            | undefined,
        });
        emails_attempted += emailResults.filter((e) => e.attempted).length;
      }
    } finally {
      releaseCheckLock(options.db, row.id, asOf);
    }
  }

  return {
    as_of: asOf,
    considered: candidates.length,
    due: due.length,
    processed: toProcess.length,
    skipped_not_due,
    skipped_budget,
    searches_consumed,
    alerts_created,
    emails_attempted,
    results,
  };
}
