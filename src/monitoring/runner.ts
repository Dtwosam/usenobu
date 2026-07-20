import type { NobuDatabase } from "../db/migrator.js";
import { MATCH_RULE_VERSION } from "../matching/rules.js";
import { canConsumeSearches, consumeSearches } from "./budget.js";
import { createPriceDropAlert } from "./alerts.js";
import { evaluateObservationAgainstFingerprint } from "./detect.js";
import { isExpiredPurchase, selectActivePurchases } from "./selection.js";
import {
  insertAlertIdempotent,
  insertMonitorRun,
  insertPriceObservation,
  listPurchaseRows,
  loadFingerprint,
  loadPurchaseScheduleFields,
  loadSearchBudget,
  markPurchaseWindowExpired,
  saveSearchBudget,
} from "./store.js";
import {
  isDueForScheduledCheck,
  updatePurchaseSchedule,
} from "./schedule.js";
import type {
  MonitorBatchResult,
  MonitorCheckResult,
  MonitorMode,
  ObservationFetcher,
  SearchBudgetSnapshot,
} from "./types.js";

export interface RunMonitoringOptions {
  db: NobuDatabase;
  mode: MonitorMode;
  as_of?: string;
  /** Optional single purchase for manual check. */
  purchase_id?: string;
  fetchObservation: ObservationFetcher;
  monthly_search_limit?: number;
}

/**
 * Manual or schedulable monitoring runner.
 * - Only MONITORING_ACTIVE purchases with locked fingerprints
 * - Expiry: no search; mark WINDOW_EXPIRED
 * - Budget: skip with recorded reason; never silent overspend
 * - Observations validated against locked fingerprint only
 * - Alerts idempotent by alert_key
 */
export async function runMonitoringPass(
  options: RunMonitoringOptions,
): Promise<MonitorBatchResult> {
  const asOf = options.as_of ?? new Date().toISOString();
  let budget = loadSearchBudget(
    options.db,
    asOf,
    options.monthly_search_limit,
  );
  const budget_before: SearchBudgetSnapshot = { ...budget };

  let rows = listPurchaseRows(options.db);
  if (options.purchase_id) {
    rows = rows.filter((r) => r.id === options.purchase_id);
  }

  // Expired active purchases: mark and skip without searching
  const results: MonitorCheckResult[] = [];
  for (const row of rows) {
    if (
      row.status === "MONITORING_ACTIVE" &&
      row.fingerprint_id &&
      isExpiredPurchase(row, asOf)
    ) {
      markPurchaseWindowExpired(options.db, row.id, asOf);
      const runId = insertMonitorRun({
        db: options.db,
        purchase_id: row.id,
        mode: options.mode,
        outcome: "skipped",
        skip_reason: "window_expired",
        searches_consumed: 0,
        notes: "expired_before_search",
        started_at: asOf,
        finished_at: asOf,
      });
      results.push({
        purchase_id: row.id,
        outcome: "skipped",
        skip_reason: "window_expired",
        searches_consumed: 0,
        alert_created: false,
        match_ok: false,
        match_reasons: ["window_expired"],
        notes: ["expired_before_search"],
        monitor_run_id: runId,
      });
    }
  }

  // Refresh rows after expiry updates
  rows = listPurchaseRows(options.db);
  if (options.purchase_id) {
    rows = rows.filter((r) => r.id === options.purchase_id);
  }

  const active = selectActivePurchases(rows, asOf);
  let searches_consumed = 0;
  let alerts_created = 0;

  for (const purchase of active) {
    const started = asOf;
    const notes: string[] = [];

    // Scheduled mode: enforce 24h cadence + backoff (manual checks bypass).
    // check_lock_until is owned by the outer scheduler loop (Lane 7.3B/7.4F) —
    // it is set before this runner is invoked, so treating it as "not due" here
    // would permanently skip every locked purchase.
    if (options.mode === "scheduled") {
      const sched = loadPurchaseScheduleFields(options.db, purchase.id);
      const due = isDueForScheduledCheck({
        next_check_at: sched.next_check_at,
        provider_backoff_until: sched.provider_backoff_until,
        check_lock_until: null,
        as_of: asOf,
      });
      if (!due.due) {
        const skip = (due.reason ?? "not_due") as
          | "not_due"
          | "check_in_progress"
          | "provider_backoff";
        const runId = insertMonitorRun({
          db: options.db,
          purchase_id: purchase.id,
          mode: options.mode,
          outcome: "skipped",
          skip_reason: skip,
          searches_consumed: 0,
          notes: `schedule_skip:${skip}`,
          started_at: started,
          finished_at: asOf,
        });
        updatePurchaseSchedule({
          db: options.db,
          purchaseId: purchase.id,
          asOf,
          skipReason: skip,
        });
        results.push({
          purchase_id: purchase.id,
          outcome: "skipped",
          skip_reason: skip,
          searches_consumed: 0,
          alert_created: false,
          match_ok: false,
          match_reasons: [skip],
          notes: [`schedule_skip:${skip}`],
          monitor_run_id: runId,
        });
        continue;
      }
    }

    if (!canConsumeSearches(budget, 1)) {
      const runId = insertMonitorRun({
        db: options.db,
        purchase_id: purchase.id,
        mode: options.mode,
        outcome: "skipped",
        skip_reason: "budget_exhausted",
        searches_consumed: 0,
        notes: "budget_exhausted_before_search",
        started_at: started,
        finished_at: asOf,
      });
      results.push({
        purchase_id: purchase.id,
        outcome: "skipped",
        skip_reason: "budget_exhausted",
        searches_consumed: 0,
        alert_created: false,
        match_ok: false,
        match_reasons: ["budget_exhausted"],
        notes: ["budget_exhausted_before_search"],
        monitor_run_id: runId,
      });
      continue;
    }

    const fingerprint = loadFingerprint(options.db, purchase.fingerprint_id);
    if (!fingerprint) {
      const runId = insertMonitorRun({
        db: options.db,
        purchase_id: purchase.id,
        mode: options.mode,
        outcome: "skipped",
        skip_reason: "missing_locked_fingerprint",
        searches_consumed: 0,
        started_at: started,
        finished_at: asOf,
      });
      results.push({
        purchase_id: purchase.id,
        outcome: "skipped",
        skip_reason: "missing_locked_fingerprint",
        searches_consumed: 0,
        alert_created: false,
        match_ok: false,
        match_reasons: ["missing_locked_fingerprint"],
        notes: [],
        monitor_run_id: runId,
      });
      continue;
    }

    // Reserve budget before fetching (no silent overspend)
    budget = consumeSearches(budget, 1);
    saveSearchBudget(options.db, budget, asOf);
    searches_consumed += 1;

    const observation = await options.fetchObservation({
      purchase,
      fingerprint,
      as_of: asOf,
    });

    const evalResult = evaluateObservationAgainstFingerprint({
      fingerprint,
      offers: observation.offers,
      purchase_price: purchase.purchase_price,
    });

    const observedAt = observation.observed_at ?? asOf;
    const matched = evalResult.matched_offer;
    const observationId = insertPriceObservation({
      db: options.db,
      purchase,
      fingerprint_id: purchase.fingerprint_id,
      offer_title: matched?.title ?? observation.offers[0]?.title ?? "n/a",
      seller_kind: matched?.seller_kind
        ? String(matched.seller_kind)
        : observation.offers[0]
          ? String(observation.offers[0].seller_kind)
          : "unknown",
      seller_text:
        matched?.seller_text ?? observation.offers[0]?.seller_text ?? "unknown",
      product_url:
        matched?.merchant_link ??
        matched?.link ??
        matched?.product_link ??
        null,
      target_item_id: matched?.target_item_id ?? null,
      model_number: matched?.model_number ?? null,
      upc_or_gtin: matched?.upc_or_gtin ?? null,
      observed_price: evalResult.observed_price ?? matched?.observed_price ?? null,
      currency: matched?.currency ?? purchase.currency,
      observed_at: observedAt,
      is_target_plus: matched?.is_target_plus ?? false,
      provider_status: String(
        observation.provider_status ??
          (evalResult.ambiguous
            ? "AMBIGUOUS_TARGET_RESULTS"
            : evalResult.match_ok
              ? "LIVE_TARGET_MATCH"
              : "NO_TARGET_RESULT"),
      ),
      query: observation.query ?? null,
      raw_result_hash: observation.raw_result_hash ?? null,
      matching_rule_version: MATCH_RULE_VERSION,
      provenance_json: JSON.stringify({
        price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION",
        provider: "SerpApi",
        engine: "google_shopping",
        match_reasons: evalResult.match_reasons,
        suppress_alert_reason: evalResult.suppress_alert_reason ?? null,
        fingerprint_id: purchase.fingerprint_id,
      }),
    });

    let alertId: string | undefined;
    let alertCreated = false;

    if (
      evalResult.match_ok &&
      !evalResult.ambiguous &&
      !evalResult.suppress_alert_reason &&
      evalResult.observed_price !== undefined &&
      evalResult.potential_recovery !== undefined &&
      evalResult.potential_recovery > 0
    ) {
      const alert = createPriceDropAlert({
        purchase_id: purchase.id,
        fingerprint_id: purchase.fingerprint_id,
        observation_id: observationId,
        purchase_price: purchase.purchase_price,
        observed_price: evalResult.observed_price,
        currency: purchase.currency,
        potential_recovery: evalResult.potential_recovery,
        created_at: observedAt,
      });
      const inserted = insertAlertIdempotent(options.db, alert);
      alertId = inserted.id;
      alertCreated = inserted.created;
      if (alertCreated) {
        alerts_created += 1;
        notes.push("alert_created");
      } else {
        notes.push("alert_idempotent_replay");
      }
    } else if (evalResult.suppress_alert_reason) {
      notes.push(`alert_suppressed:${evalResult.suppress_alert_reason}`);
    }

    const runId = insertMonitorRun({
      db: options.db,
      purchase_id: purchase.id,
      mode: options.mode,
      outcome: "checked",
      skip_reason: null,
      searches_consumed: 1,
      observation_id: observationId,
      alert_id: alertId ?? null,
      provider_status: String(observation.provider_status ?? ""),
      match_result: evalResult.match_ok
        ? evalResult.ambiguous
          ? "ambiguous"
          : "matched"
        : "no_match",
      notes: notes.join("|"),
      started_at: started,
      finished_at: asOf,
    });

    const providerStatus = String(observation.provider_status ?? "");
    const providerFailed =
      providerStatus === "PROVIDER_ERROR" ||
      providerStatus === "RATE_LIMITED" ||
      providerStatus === "DATA_SOURCE_UNAVAILABLE";

    if (providerFailed && !evalResult.match_ok) {
      updatePurchaseSchedule({
        db: options.db,
        purchaseId: purchase.id,
        asOf,
        providerFailed: true,
        skipReason: "provider_failure",
      });
    } else {
      updatePurchaseSchedule({
        db: options.db,
        purchaseId: purchase.id,
        asOf,
        checked: true,
      });
    }

    results.push({
      purchase_id: purchase.id,
      outcome: "checked",
      skip_reason: null,
      searches_consumed: 1,
      observation_id: observationId,
      alert_id: alertId,
      alert_created: alertCreated,
      match_ok: evalResult.match_ok && !evalResult.ambiguous,
      match_reasons: evalResult.match_reasons,
      observed_price: evalResult.observed_price,
      potential_recovery: evalResult.potential_recovery,
      provider_status: providerStatus,
      notes,
      monitor_run_id: runId,
    });
  }

  return {
    as_of: asOf,
    mode: options.mode,
    budget_before,
    budget_after: budget,
    results,
    alerts_created,
    searches_consumed,
  };
}
