/**
 * Deterministic policy-operations runtime rules (Lane 8-R1A).
 * Does not fetch or scrape Target.
 */

import { hoursBetween } from "../dates.js";
import {
  DEFAULT_REVIEW_INTERVAL_HOURS,
  DEFAULT_SOURCE_UNAVAILABLE_GRACE_HOURS,
  PolicyReviewState,
  type PolicyOperationsRecord,
  type PolicyRuntimeView,
} from "./types.js";

export function addHoursIso(iso: string, hours: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    throw new Error(`Invalid ISO datetime: ${iso}`);
  }
  return new Date(t + hours * 60 * 60 * 1000).toISOString();
}

export function computeNextReviewAt(
  sourceLastCheckedAt: string,
  reviewIntervalHours = DEFAULT_REVIEW_INTERVAL_HOURS,
): string {
  return addHoursIso(sourceLastCheckedAt, reviewIntervalHours);
}

export function warningForState(state: PolicyReviewState): string | null {
  switch (state) {
    case PolicyReviewState.CURRENT:
      return null;
    case PolicyReviewState.CHECK_DUE:
      return "Policy owner review is due. Nobu continues using the last approved Target policy. Target makes the final decision.";
    case PolicyReviewState.SOURCE_UNAVAILABLE:
      return "Official Target policy source was marked unavailable. Nobu continues on the last approved policy within a bounded grace period. This is not a successful source check.";
    case PolicyReviewState.CHANGE_DETECTED:
      return "A material Target policy change was flagged for owner review. Factual price observations continue; positive eligibility conclusions are suppressed until review. Target makes the final decision.";
    case PolicyReviewState.REVIEW_REQUIRED:
      return "Target policy owner review is required. Factual price observations continue; positive eligibility conclusions are suppressed. Target makes the final decision.";
    case PolicyReviewState.RETIRED:
      return "This Target policy version is retired. Positive Target policy evaluation is stopped. Historical observations are retained.";
    default:
      return "Policy operations warning.";
  }
}

/**
 * Resolve effective runtime view for a stored ops record at `nowIso`.
 * Overdue CURRENT becomes CHECK_DUE (no full service block).
 * Does not mutate the record; callers persist transitions via scheduler/owner actions.
 */
export function resolvePolicyRuntime(
  record: PolicyOperationsRecord,
  nowIso: string,
  options: {
    review_interval_hours?: number;
    source_unavailable_grace_hours?: number;
  } = {},
): PolicyRuntimeView {
  const graceHours =
    options.source_unavailable_grace_hours ??
    DEFAULT_SOURCE_UNAVAILABLE_GRACE_HOURS;

  let effective: PolicyReviewState = record.review_state;

  if (record.review_state === PolicyReviewState.RETIRED) {
    effective = PolicyReviewState.RETIRED;
  } else if (record.review_state === PolicyReviewState.CURRENT) {
    const next = new Date(record.next_review_at).getTime();
    const now = new Date(nowIso).getTime();
    if (!Number.isNaN(next) && !Number.isNaN(now) && now > next) {
      effective = PolicyReviewState.CHECK_DUE;
    }
  }

  let block = false;
  let suppress = false;
  let ownerAction = false;

  switch (effective) {
    case PolicyReviewState.CURRENT:
      break;
    case PolicyReviewState.CHECK_DUE:
      ownerAction = true;
      break;
    case PolicyReviewState.SOURCE_UNAVAILABLE: {
      ownerAction = true;
      const age = hoursBetween(record.source_last_checked_at, nowIso);
      if (age !== null && age > graceHours) {
        block = true;
      }
      break;
    }
    case PolicyReviewState.CHANGE_DETECTED:
    case PolicyReviewState.REVIEW_REQUIRED:
      suppress = true;
      ownerAction = true;
      break;
    case PolicyReviewState.RETIRED:
      block = true;
      suppress = true;
      ownerAction = true;
      break;
    default:
      break;
  }

  return {
    record,
    effective_state: effective,
    warning: warningForState(effective),
    suppress_positive_eligibility: suppress,
    block_positive_service: block,
    owner_action_required: ownerAction,
  };
}

/** Idempotent alert key for one active owner alert per policy version + type. */
export function ownerAlertKey(
  policyId: string,
  policyVersion: string,
  alertType: string,
): string {
  return `policy_ops|${policyId}|${policyVersion}|${alertType}`;
}
