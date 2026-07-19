/**
 * Versioned policy operations — approved rules vs operational review metadata.
 * Lane 8-R1A. Does not invent Target eligibility rules.
 */

export const PolicyReviewState = {
  CURRENT: "CURRENT",
  CHECK_DUE: "CHECK_DUE",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  CHANGE_DETECTED: "CHANGE_DETECTED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  RETIRED: "RETIRED",
} as const;

export type PolicyReviewState =
  (typeof PolicyReviewState)[keyof typeof PolicyReviewState];

export const OwnerReviewAction = {
  UNCHANGED: "UNCHANGED",
  MATERIAL_CHANGE_DETECTED: "MATERIAL_CHANGE_DETECTED",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  RETIRED: "RETIRED",
} as const;

export type OwnerReviewAction =
  (typeof OwnerReviewAction)[keyof typeof OwnerReviewAction];

export const OwnerAlertStatus = {
  ACTIVE: "active",
  CLEARED: "cleared",
} as const;

export type OwnerAlertStatus =
  (typeof OwnerAlertStatus)[keyof typeof OwnerAlertStatus];

/** Operational review interval (hackathon reminder). Not a production shutdown timer. */
export const DEFAULT_REVIEW_INTERVAL_HOURS = 24;

/** Bound grace while source is unavailable before non-positive block. */
export const DEFAULT_SOURCE_UNAVAILABLE_GRACE_HOURS = 72;

export interface PolicyOperationsRecord {
  policy_id: string;
  policy_version: string;
  approved_at: string;
  source_url: string;
  source_last_checked_at: string;
  next_review_at: string;
  review_state: PolicyReviewState;
  source_fingerprint: string | null;
  last_owner_alert_at: string | null;
  review_note: string | null;
  retired_at: string | null;
  updated_at: string;
}

export interface PolicyOwnerAlert {
  id: string;
  policy_id: string;
  policy_version: string;
  alert_key: string;
  alert_type: string;
  status: OwnerAlertStatus;
  message: string;
  created_at: string;
  cleared_at: string | null;
  last_notified_at: string | null;
}

export interface PolicyPendingReview {
  id: string;
  policy_id: string;
  from_version: string;
  status: "pending" | "resolved";
  note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface PolicyReviewEvent {
  id: string;
  policy_id: string;
  policy_version: string;
  action: string;
  note: string | null;
  actor: string;
  created_at: string;
  payload_json: string;
}

/**
 * Runtime view used by evaluation and API — derived deterministically from ops record.
 */
export interface PolicyRuntimeView {
  record: PolicyOperationsRecord;
  /** Effective state after applying overdue → CHECK_DUE rules for this evaluation clock. */
  effective_state: PolicyReviewState;
  /** Visible warning for API/UI when not fully CURRENT. */
  warning: string | null;
  /** True when positive eligibility conclusions must not be issued. */
  suppress_positive_eligibility: boolean;
  /**
   * True when Target policy evaluation must return a non-positive service state
   * (RETIRED, or SOURCE_UNAVAILABLE past grace).
   */
  block_positive_service: boolean;
  /** Owner should act; scheduler may create at most one active alert. */
  owner_action_required: boolean;
}

export function isPolicyReviewState(value: string): value is PolicyReviewState {
  return Object.values(PolicyReviewState).includes(value as PolicyReviewState);
}

export function isOwnerReviewAction(value: string): value is OwnerReviewAction {
  return Object.values(OwnerReviewAction).includes(value as OwnerReviewAction);
}
