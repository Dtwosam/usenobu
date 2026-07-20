/**
 * Controlled monitoring schedule (Lane 7.3B).
 * No continuous polling. At most one scheduled provider check per purchase / 24h.
 */
import type { NobuDatabase } from "../db/migrator.js";
import type { ActivePurchase, MonitorSkipReason } from "./types.js";

export const SCHEDULED_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SCHEDULED_BATCH_SIZE = 10;
/** Provider failure backoff before next eligible check. */
export const PROVIDER_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const CHECK_LOCK_TTL_MS = 5 * 60 * 1000;

export type ScheduleSkipReason =
  | MonitorSkipReason
  | "not_due"
  | "check_in_progress"
  | "provider_backoff"
  | "deleted_or_unmonitorable";

export function addMs(iso: string, ms: number): string {
  const t = Date.parse(iso);
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base + ms).toISOString();
}

export function isDueForScheduledCheck(args: {
  next_check_at: string | null | undefined;
  provider_backoff_until: string | null | undefined;
  check_lock_until: string | null | undefined;
  as_of: string;
}): { due: boolean; reason: ScheduleSkipReason | null } {
  const asOfMs = Date.parse(args.as_of);
  if (!Number.isFinite(asOfMs)) {
    return { due: false, reason: "not_due" };
  }

  if (args.check_lock_until) {
    const lockMs = Date.parse(args.check_lock_until);
    if (Number.isFinite(lockMs) && lockMs > asOfMs) {
      return { due: false, reason: "check_in_progress" };
    }
  }

  if (args.provider_backoff_until) {
    const backMs = Date.parse(args.provider_backoff_until);
    if (Number.isFinite(backMs) && backMs > asOfMs) {
      return { due: false, reason: "provider_backoff" };
    }
  }

  if (!args.next_check_at) {
    // First scheduled check after confirmation: due immediately
    return { due: true, reason: null };
  }

  const nextMs = Date.parse(args.next_check_at);
  if (!Number.isFinite(nextMs) || nextMs <= asOfMs) {
    return { due: true, reason: null };
  }
  return { due: false, reason: "not_due" };
}

export interface PurchaseScheduleRow extends ActivePurchase {
  last_checked_at: string | null;
  next_check_at: string | null;
  check_lock_until: string | null;
  provider_backoff_until: string | null;
  last_skip_reason: string | null;
  monitoring_deadline: string | null;
}

/**
 * Prioritize: closest to expiry, then least recently checked.
 */
export function prioritizeScheduledPurchases(
  rows: PurchaseScheduleRow[],
): PurchaseScheduleRow[] {
  return [...rows].sort((a, b) => {
    const da = a.monitoring_deadline || "9999-12-31";
    const db = b.monitoring_deadline || "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    const la = a.last_checked_at || "";
    const lb = b.last_checked_at || "";
    if (la !== lb) return la.localeCompare(lb);
    return a.id.localeCompare(b.id);
  });
}

export function updatePurchaseSchedule(args: {
  db: NobuDatabase;
  purchaseId: string;
  asOf: string;
  /** After a completed check */
  checked?: boolean;
  /** Provider failure (no observation usable) */
  providerFailed?: boolean;
  skipReason?: string | null;
  clearLock?: boolean;
}): void {
  const nextCheck = args.checked
    ? addMs(args.asOf, SCHEDULED_CHECK_INTERVAL_MS)
    : args.providerFailed
      ? addMs(args.asOf, PROVIDER_BACKOFF_MS)
      : null;
  const backoff = args.providerFailed
    ? addMs(args.asOf, PROVIDER_BACKOFF_MS)
    : null;

  try {
    if (args.checked) {
      args.db
        .prepare(
          `UPDATE purchases SET
             last_checked_at = ?,
             next_check_at = ?,
             check_lock_until = NULL,
             provider_backoff_until = NULL,
             last_skip_reason = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          args.asOf,
          nextCheck,
          args.skipReason ?? null,
          args.asOf,
          args.purchaseId,
        );
      return;
    }

    if (args.providerFailed) {
      args.db
        .prepare(
          `UPDATE purchases SET
             last_checked_at = ?,
             next_check_at = ?,
             check_lock_until = NULL,
             provider_backoff_until = ?,
             last_skip_reason = ?,
             updated_at = ?
           WHERE id = ?`,
        )
        .run(
          args.asOf,
          nextCheck,
          backoff,
          args.skipReason ?? "provider_failure",
          args.asOf,
          args.purchaseId,
        );
      return;
    }

    if (args.skipReason) {
      args.db
        .prepare(
          `UPDATE purchases SET last_skip_reason = ?, updated_at = ? WHERE id = ?`,
        )
        .run(args.skipReason, args.asOf, args.purchaseId);
    }

    if (args.clearLock) {
      args.db
        .prepare(
          `UPDATE purchases SET check_lock_until = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(args.asOf, args.purchaseId);
    }
  } catch {
    /* columns may not exist on pre-migration DBs */
  }
}

export function acquireCheckLock(
  db: NobuDatabase,
  purchaseId: string,
  asOf: string,
): boolean {
  try {
    const row = db
      .prepare(
        `SELECT check_lock_until FROM purchases WHERE id = ?`,
      )
      .get(purchaseId) as { check_lock_until: string | null } | undefined;
    if (row?.check_lock_until) {
      const lockMs = Date.parse(row.check_lock_until);
      const asOfMs = Date.parse(asOf);
      if (Number.isFinite(lockMs) && Number.isFinite(asOfMs) && lockMs > asOfMs) {
        return false;
      }
    }
    const until = addMs(asOf, CHECK_LOCK_TTL_MS);
    db.prepare(
      `UPDATE purchases SET check_lock_until = ?, updated_at = ? WHERE id = ?`,
    ).run(until, asOf, purchaseId);
    return true;
  } catch {
    return true; // pre-migration: allow check
  }
}

export function releaseCheckLock(
  db: NobuDatabase,
  purchaseId: string,
  asOf: string,
): void {
  try {
    db.prepare(
      `UPDATE purchases SET check_lock_until = NULL, updated_at = ? WHERE id = ?`,
    ).run(asOf, purchaseId);
  } catch {
    /* ignore */
  }
}

/** After confirmation, seed first scheduled check as due (next_check_at null). */
export function seedMonitoringScheduleOnConfirm(
  db: NobuDatabase,
  purchaseId: string,
  confirmedAt: string,
): void {
  try {
    db.prepare(
      `UPDATE purchases SET
         last_checked_at = NULL,
         next_check_at = NULL,
         check_lock_until = NULL,
         provider_backoff_until = NULL,
         last_skip_reason = NULL,
         updated_at = ?
       WHERE id = ?`,
    ).run(confirmedAt, purchaseId);
  } catch {
    /* ignore */
  }
}
