/**
 * Centralized purchase lifecycle mapping (Lane 7.3A.2B).
 * Pure functions — no I/O. Deterministic status remains the monitoring source of truth.
 */

export type LifecycleTab = "active" | "history" | "archived";

/** User-reported outcome — never alters matching, policy, or prices. */
export const UserOutcome = {
  NOT_CONTACTED: "not_contacted",
  REQUESTED_WAITING: "requested_waiting",
  TARGET_APPROVED: "target_approved",
  TARGET_DECLINED: "target_declined",
  DID_NOT_REQUEST: "did_not_request",
} as const;

export type UserOutcome = (typeof UserOutcome)[keyof typeof UserOutcome];

export const USER_OUTCOME_LABELS: Record<UserOutcome, string> = {
  not_contacted: "Not contacted",
  requested_waiting: "Requested — waiting",
  target_approved: "Target approved",
  target_declined: "Target declined",
  did_not_request: "Did not request",
};

export const USER_OUTCOME_DISCLOSURE =
  "Reported by you — not verified by Target";

export function isUserOutcome(v: string): v is UserOutcome {
  return Object.values(UserOutcome).includes(v as UserOutcome);
}

export type LifecycleInput = {
  status: string;
  /** User archived visibility preference */
  archived_at?: string | null;
  /** ISO monitoring deadline (YYYY-MM-DD or datetime) */
  monitoring_deadline?: string | null;
  /** True when a price-drop alert exists */
  has_price_drop_alert?: boolean;
  /** As-of for window checks */
  now?: Date;
};

/**
 * Map deterministic purchase state + archive flag → lifecycle tab.
 * Archive always wins (visibility only).
 */
export function mapPurchaseLifecycle(input: LifecycleInput): LifecycleTab {
  if (input.archived_at) return "archived";

  const status = String(input.status || "").toUpperCase();

  // Terminal / ended → History
  if (
    status === "WINDOW_EXPIRED" ||
    status === "UNSUPPORTED_PURCHASE" ||
    status === "POLICY_EXCLUSION" ||
    status === "POLICY_STALE"
  ) {
    return "history";
  }

  // Active window statuses
  if (
    status === "MATCH_REVIEW_REQUIRED" ||
    status === "MONITORING_ACTIVE" ||
    status === "PRICE_DROP_DETECTED" ||
    status === "POTENTIALLY_ELIGIBLE" ||
    status === "NO_PRICE_DROP" ||
    status === "NO_RELIABLE_PRICE" ||
    status === "DATA_SOURCE_UNAVAILABLE"
  ) {
    // If still in active statuses but deadline clearly past → history
    if (isDeadlinePast(input.monitoring_deadline, input.now)) {
      return "history";
    }
    return "active";
  }

  // Unknown status fail-closed to history so items are not lost from view
  return "history";
}

function isDeadlinePast(
  deadline: string | null | undefined,
  now = new Date(),
): boolean {
  if (!deadline) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  if (!m) {
    const t = Date.parse(deadline);
    return Number.isFinite(t) && t < now.getTime();
  }
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return now.getTime() > end;
}

export type PurchaseListItem = {
  id: string;
  target_product_url: string;
  purchase_price: number | string;
  currency: string;
  purchase_date: string;
  status: string;
  fingerprint_id: string | null;
  monitoring_deadline: string | null;
  updated_at: string;
  product_title: string | null;
  latest_observed_price: number | null;
  possible_difference: number | null;
  has_price_drop_alert: boolean;
  archived_at: string | null;
  user_outcome: UserOutcome | null;
  user_outcome_at: string | null;
  lifecycle: LifecycleTab;
  /** Lane 7.3B — email alert consent enabled */
  email_alerts_enabled: boolean;
};

export function partitionByLifecycle(
  items: PurchaseListItem[],
): Record<LifecycleTab, PurchaseListItem[]> {
  const out: Record<LifecycleTab, PurchaseListItem[]> = {
    active: [],
    history: [],
    archived: [],
  };
  for (const item of items) {
    out[item.lifecycle].push(item);
  }
  return out;
}
