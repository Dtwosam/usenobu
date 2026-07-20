import type { StatusTone } from "@/ui/StatusBadge";

/** Plain-English status for UI — never use raw enums as main headings. */
export function statusLabel(status: string): string {
  switch (status) {
    case "MONITORING_ACTIVE":
      return "Monitoring active";
    case "PRICE_DROP_DETECTED":
    case "ALERT_SENT":
    case "POTENTIALLY_ELIGIBLE":
      return "Possible price difference found";
    case "NO_PRICE_DROP":
      return "No lower price safely identified";
    case "WINDOW_EXPIRED":
      return "Monitoring period ended";
    case "MATCH_REVIEW_REQUIRED":
      return "Confirm your exact product";
    case "NO_RELIABLE_PRICE":
      return "No reliable Target price found";
    case "UNSUPPORTED_PURCHASE":
    case "POLICY_EXCLUSION":
      return "This purchase isn’t supported";
    case "DATA_SOURCE_UNAVAILABLE":
      return "Price check temporarily unavailable";
    case "MONITORING_PAYMENT_READY":
      return "Preparing monitoring";
    case "MONITORING_STOPPED":
    case "STOPPED":
      return "Monitoring stopped";
    case "ACTIVATION_PENDING":
    case "PENDING_PROJECTION":
      return "Activation pending";
    default:
      return "Status update";
  }
}

/** Supporting copy for stopped monitors. */
export const MONITORING_STOPPED_COPY =
  "Nobu will no longer run scheduled checks for this purchase.";

/** Supporting copy for activation-pending durable state only. */
export const ACTIVATION_PENDING_COPY =
  "Your payment was recorded, but monitoring activation is still being completed. You will not be asked to pay again for this activation.";

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
