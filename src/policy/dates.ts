const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse YYYY-MM-DD as UTC midnight. Returns null if invalid. */
export function parseUtcCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

/** Extract UTC calendar date YYYY-MM-DD from a date or ISO datetime string. */
export function toUtcCalendarDateString(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseUtcCalendarDate(value) ? value : null;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Calendar days after purchase (UTC), matching policy window type
 * `calendar_days_after_purchase`.
 * Day 0 = purchase day; day 14 still in window; day 15 expired.
 */
export function calendarDaysSincePurchase(
  purchaseDate: string,
  asOf: string,
): number | null {
  const purchase = parseUtcCalendarDate(
    toUtcCalendarDateString(purchaseDate) ?? "",
  );
  const asOfDate = parseUtcCalendarDate(toUtcCalendarDateString(asOf) ?? "");
  if (!purchase || !asOfDate) return null;
  return Math.floor((asOfDate.getTime() - purchase.getTime()) / MS_PER_DAY);
}

export function addCalendarDays(purchaseDate: string, days: number): string {
  const base = parseUtcCalendarDate(purchaseDate);
  if (!base) {
    throw new Error(`Invalid purchase date: ${purchaseDate}`);
  }
  const next = new Date(base.getTime() + days * MS_PER_DAY);
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function hoursBetween(earlierIso: string, laterIso: string): number | null {
  const a = new Date(earlierIso);
  const b = new Date(laterIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return (b.getTime() - a.getTime()) / (60 * 60 * 1000);
}
