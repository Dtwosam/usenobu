/**
 * Seed / default policy operations record from the approved Target policy snapshot.
 * Separates approved rules (TARGET_US_POLICY) from operational review metadata.
 */

import { TARGET_US_POLICY } from "../target-us-policy.js";
import { computeNextReviewAt } from "./runtime.js";
import {
  PolicyReviewState,
  type PolicyOperationsRecord,
} from "./types.js";

/**
 * Build the default ops record for the locked approved Target policy.
 * `approved_at` / `source_last_checked_at` come from the approved snapshot verification time.
 */
export function buildDefaultPolicyOperationsRecord(
  nowIso?: string,
): PolicyOperationsRecord {
  const approvedAt = TARGET_US_POLICY.verified_at;
  const sourceLastChecked = TARGET_US_POLICY.verified_at;
  const nextReview = computeNextReviewAt(
    sourceLastChecked,
    TARGET_US_POLICY.review_interval_hours,
  );
  const updated = nowIso ?? new Date().toISOString();

  return {
    policy_id: TARGET_US_POLICY.policy_id,
    policy_version: TARGET_US_POLICY.policy_version,
    approved_at: approvedAt,
    source_url: TARGET_US_POLICY.source_url,
    source_last_checked_at: sourceLastChecked,
    next_review_at: nextReview,
    review_state: PolicyReviewState.CURRENT,
    source_fingerprint: TARGET_US_POLICY.source_fingerprint ?? null,
    last_owner_alert_at: null,
    review_note: null,
    retired_at: null,
    updated_at: updated,
  };
}
