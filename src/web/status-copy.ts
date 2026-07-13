import type { StatusTone } from "@/ui/StatusBadge";

/** Plain-English status for UI — never use raw enums as main headings. */
export function statusLabel(status: string): string {
  switch (status) {
    case "MONITORING_ACTIVE":
      return "Watching the price";
    case "PRICE_DROP_DETECTED":
      return "Price drop found";
    case "NO_PRICE_DROP":
      return "No lower price found yet";
    case "WINDOW_EXPIRED":
      return "Monitoring window ended";
    case "MATCH_REVIEW_REQUIRED":
      return "Confirm your exact product";
    case "NO_RELIABLE_PRICE":
      return "No reliable Target price found";
    case "UNSUPPORTED_PURCHASE":
    case "POLICY_EXCLUSION":
      return "This purchase isn’t supported";
    case "DATA_SOURCE_UNAVAILABLE":
      return "Price check temporarily unavailable";
    case "ALERT_SENT":
      return "Price drop found";
    default:
      return "Status update";
  }
}

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "MONITORING_ACTIVE":
      return "info";
    case "PRICE_DROP_DETECTED":
    case "ALERT_SENT":
      return "success";
    case "NO_PRICE_DROP":
      return "neutral";
    case "WINDOW_EXPIRED":
      return "neutral";
    case "MATCH_REVIEW_REQUIRED":
      return "warning";
    case "NO_RELIABLE_PRICE":
    case "UNSUPPORTED_PURCHASE":
    case "POLICY_EXCLUSION":
      return "danger";
    case "DATA_SOURCE_UNAVAILABLE":
      return "warning";
    default:
      return "neutral";
  }
}

export function matchDecisionLabel(decision: string): string {
  switch (decision) {
    case "EXACT_MATCH_CANDIDATE":
      return "Strong match ready to confirm";
    case "MATCH_REVIEW_REQUIRED":
      return "We need a little more detail";
    case "NO_RELIABLE_PRICE":
      return "No reliable Target product found";
    default:
      return "Review needed";
  }
}

export function formatUsd(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

/** Calendar days remaining until YYYY-MM-DD deadline (UTC date parts). */
export function daysRemaining(
  deadline: string | null | undefined,
  asOf = new Date(),
): number | null {
  if (!deadline) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  if (!m) return null;
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
