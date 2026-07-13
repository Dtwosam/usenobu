import {
  calendarDaysSincePurchase,
  toUtcCalendarDateString,
} from "../policy/dates.js";
import { TARGET_US_POLICY } from "../policy/target-us-policy.js";
import type { ActivePurchase } from "./types.js";

export interface PurchaseSelectionRow {
  id: string;
  status: string;
  purchase_price: number;
  currency: string;
  purchase_date: string;
  purchase_channel: string;
  country: string;
  region: string | null;
  fingerprint_id: string | null;
  monitoring_deadline: string | null;
  is_target_plus: number;
  known_exclusion: string | null;
}

/**
 * A purchase is monitorable only when:
 * - status is MONITORING_ACTIVE
 * - locked fingerprint_id is present
 * - still inside the 14-day policy window (or monitoring_deadline if set)
 */
export function isWithinMonitoringWindow(
  purchase: Pick<
    PurchaseSelectionRow,
    "purchase_date" | "monitoring_deadline"
  >,
  asOfIso: string,
  windowDays = TARGET_US_POLICY.window.days,
): boolean {
  const asOfDate = toUtcCalendarDateString(asOfIso);
  if (!asOfDate) return false;

  if (purchase.monitoring_deadline) {
    const deadline = toUtcCalendarDateString(purchase.monitoring_deadline);
    if (deadline && asOfDate > deadline) return false;
  }

  const days = calendarDaysSincePurchase(purchase.purchase_date, asOfIso);
  if (days === null) return false;
  if (days < 0) return false;
  return days <= windowDays;
}

export function selectActivePurchases(
  rows: readonly PurchaseSelectionRow[],
  asOfIso: string,
): ActivePurchase[] {
  const out: ActivePurchase[] = [];
  for (const row of rows) {
    if (row.status !== "MONITORING_ACTIVE") continue;
    if (!row.fingerprint_id) continue;
    if (!isWithinMonitoringWindow(row, asOfIso)) continue;
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
    });
  }
  // Deterministic queue order by purchase id
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function isExpiredPurchase(
  purchase: Pick<PurchaseSelectionRow, "purchase_date" | "monitoring_deadline">,
  asOfIso: string,
): boolean {
  return !isWithinMonitoringWindow(purchase, asOfIso);
}
