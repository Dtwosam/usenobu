/**
 * Bounded manual "Check price now".
 * Production: live SerpApi via runMonitoringPass.
 * Fixtures: only with explicit gate (tests / NOBU_FIXTURE_MODE).
 */
import type { NobuDatabase } from "../db/index.js";
import {
  canConsumeSearches,
  loadSearchBudget,
  type MonitorBatchResult,
} from "../monitoring/index.js";
import type { ObservationFetcher } from "../monitoring/types.js";
import {
  runManualPriceCheck,
} from "./purchase-service.js";
import {
  outcomeFromMonitorResult,
  type CheckOutcomeCode,
} from "./check-outcome.js";
import {
  resolveManualCheckDataSource,
  type ManualCheckDataSource,
} from "./manual-check-mode.js";

/** Demo web session owner (matches createPurchaseFlow). */
export const WEB_DEMO_USER_REF = "demo-user";

/** Seconds between manual checks for the same purchase. */
export const MANUAL_CHECK_COOLDOWN_SECONDS = 30;

const inFlight = new Set<string>();

export type ManualCheckResult =
  | {
      ok: true;
      outcome: CheckOutcomeCode;
      alert_id?: string;
      batch: MonitorBatchResult;
      data_source: ManualCheckDataSource;
      provider_called: boolean;
      match_reasons?: string[];
    }
  | {
      ok: false;
      error: string;
      outcome: CheckOutcomeCode;
      provider_called: false;
      data_source?: ManualCheckDataSource;
    };

function lastManualRunAt(
  db: NobuDatabase,
  purchaseId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT finished_at FROM monitor_runs
       WHERE purchase_id = ? AND mode = 'manual'
       ORDER BY finished_at DESC LIMIT 1`,
    )
    .get(purchaseId) as { finished_at: string } | undefined;
  return row?.finished_at ?? null;
}

export function isCooldownActive(
  db: NobuDatabase,
  purchaseId: string,
  nowMs = Date.now(),
  cooldownSeconds = MANUAL_CHECK_COOLDOWN_SECONDS,
): boolean {
  const last = lastManualRunAt(db, purchaseId);
  if (!last) return false;
  const t = Date.parse(last);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < cooldownSeconds * 1000;
}

export function tryAcquireCheckLock(purchaseId: string): boolean {
  if (inFlight.has(purchaseId)) return false;
  inFlight.add(purchaseId);
  return true;
}

export function releaseCheckLock(purchaseId: string): void {
  inFlight.delete(purchaseId);
}

/** Test helper */
export function clearCheckLocks(): void {
  inFlight.clear();
}

export async function runBoundedManualCheck(args: {
  db: NobuDatabase;
  purchase_id: string;
  /** Caller-asserted owner (session user_ref). */
  user_ref: string;
  now?: Date;
  /**
   * Prefer fixture path (tests/e2e only). Production omits this → LIVE.
   * Silently ignored when fixture gate is closed.
   */
  prefer_fixture?: boolean;
  /** Inject live fetcher for unit tests (no network). */
  fetchObservation?: ObservationFetcher;
}): Promise<ManualCheckResult> {
  const purchase = args.db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(args.purchase_id) as Record<string, unknown> | undefined;

  if (!purchase) {
    return {
      ok: false,
      error: "not_found",
      outcome: "not_found",
      provider_called: false,
    };
  }

  const owner = String(purchase.user_ref ?? "");
  if (owner && owner !== args.user_ref) {
    return {
      ok: false,
      error: "unauthorized",
      outcome: "unauthorized",
      provider_called: false,
    };
  }

  if (!purchase.fingerprint_id || purchase.status !== "MONITORING_ACTIVE") {
    return {
      ok: false,
      error: "not_confirmed",
      outcome: "not_confirmed",
      provider_called: false,
    };
  }

  // Budget gate before any provider call (also enforced again in runner)
  if (!hasSearchBudget(args.db, (args.now ?? new Date()).toISOString())) {
    return {
      ok: false,
      error: "budget",
      outcome: "budget",
      provider_called: false,
    };
  }

  const now = args.now ?? new Date();
  if (isCooldownActive(args.db, args.purchase_id, now.getTime())) {
    return {
      ok: false,
      error: "cooldown",
      outcome: "cooldown",
      provider_called: false,
    };
  }

  if (!tryAcquireCheckLock(args.purchase_id)) {
    return {
      ok: false,
      error: "busy",
      outcome: "busy",
      provider_called: false,
    };
  }

  const data_source = resolveManualCheckDataSource({
    prefer_fixture: args.prefer_fixture,
  });

  try {
    const result = await runManualPriceCheck({
      purchase_id: args.purchase_id,
      data_source,
      fetchObservation: args.fetchObservation,
      db: args.db,
      now,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        outcome:
          result.error === "not_confirmed"
            ? "not_confirmed"
            : result.error === "not_found"
              ? "not_found"
              : result.error === "fixture_path_denied"
                ? "provider_unavailable"
                : "provider_unavailable",
        provider_called: false,
        data_source:
          "data_source" in result
            ? (result.data_source as ManualCheckDataSource)
            : data_source,
      };
    }

    const check = result.batch.results[0];
    if (!check) {
      return {
        ok: true,
        outcome: "no_lower",
        batch: result.batch,
        data_source: result.data_source,
        provider_called: result.batch.searches_consumed > 0,
      };
    }

    const outcome = outcomeFromMonitorResult({
      skip_reason: check.skip_reason,
      match_ok: check.match_ok,
      match_reasons: check.match_reasons,
      alert_created: check.alert_created,
      notes: check.notes,
      provider_status: check.provider_status,
      potential_recovery: check.potential_recovery,
    });

    return {
      ok: true,
      outcome,
      alert_id: check.alert_id,
      batch: result.batch,
      data_source: result.data_source,
      provider_called: check.searches_consumed > 0,
      match_reasons: check.match_reasons,
    };
  } finally {
    releaseCheckLock(args.purchase_id);
  }
}

/** Count completed provider checks (not precondition skips). */
export function countCompletedProviderChecks(
  runs: Array<Record<string, unknown>>,
): number {
  return runs.filter(
    (r) =>
      String(r.outcome) === "checked" && Number(r.searches_consumed ?? 0) > 0,
  ).length;
}

export function lastSuccessfulCheckAt(
  runs: Array<Record<string, unknown>>,
): string | null {
  const hit = runs.find(
    (r) =>
      String(r.outcome) === "checked" && Number(r.searches_consumed ?? 0) > 0,
  );
  return hit?.finished_at ? String(hit.finished_at) : null;
}

export function lastAttemptedCheckAt(
  runs: Array<Record<string, unknown>>,
): string | null {
  return runs[0]?.finished_at ? String(runs[0].finished_at) : null;
}

/**
 * Whether the dashboard may offer "Check price now".
 * Must match preconditions so we never show a dead button that would hit the provider.
 */
export function canOfferManualCheck(args: {
  status: string;
  fingerprint_id: string | null | undefined;
  monitoring_deadline?: string | null;
  cooldownActive: boolean;
  budgetOk: boolean;
  now?: Date;
}): boolean {
  if (!args.fingerprint_id) return false;
  if (args.status !== "MONITORING_ACTIVE") return false;
  if (args.cooldownActive) return false;
  if (!args.budgetOk) return false;
  if (args.monitoring_deadline) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(args.monitoring_deadline);
    if (m) {
      const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const now = args.now ?? new Date();
      const start = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      );
      if (start > end) return false;
    }
  }
  return true;
}

/** Monthly search budget remaining (no provider call). */
export function hasSearchBudget(
  db: NobuDatabase,
  asOfIso = new Date().toISOString(),
): boolean {
  const budget = loadSearchBudget(db, asOfIso);
  return canConsumeSearches(budget, 1);
}

/** Human label for monitoring status (compact panel). */
export function monitoringStatusLabel(status: string): string {
  switch (status) {
    case "MONITORING_ACTIVE":
      return "Watching";
    case "PRICE_DROP_DETECTED":
    case "ALERT_SENT":
      return "Price difference found";
    case "NO_PRICE_DROP":
      return "No lower price";
    case "WINDOW_EXPIRED":
      return "Window ended";
    case "MATCH_REVIEW_REQUIRED":
      return "Confirm product";
    case "NO_RELIABLE_PRICE":
      return "No reliable price";
    case "UNSUPPORTED_PURCHASE":
    case "POLICY_EXCLUSION":
      return "Not supported";
    case "DATA_SOURCE_UNAVAILABLE":
      return "Source unavailable";
    default:
      return "Status update";
  }
}

/** Compact timestamp for default panel (UTC, short). */
export function formatCheckedAt(iso: string | null | undefined): string {
  if (!iso) return "Not checked yet";
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return String(iso);
  return new Date(d).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export {
  isFixtureCheckAllowed,
  resolveManualCheckDataSource,
  shouldShowFixtureUiLabel,
  FIXTURE_UI_LABEL,
} from "./manual-check-mode.js";
