/**
 * Policy-operations business logic on top of PolicyOperationsStore.
 * Shared by A2MCP, health, owner APIs, and scheduler.
 */

import { TARGET_US_POLICY } from "../target-us-policy.js";
import { computeNextReviewAt, resolvePolicyRuntime } from "./runtime.js";
import type {
  ApplyOwnerReviewArgs,
  ApplyOwnerReviewResult,
  PolicyOperationsStore,
  PolicyStatusSnapshot,
  SchedulerResult,
} from "./contract.js";
import {
  OwnerReviewAction,
  PolicyReviewState,
  type PolicyOperationsRecord,
  type PolicyRuntimeView,
} from "./types.js";

export async function getPolicyRuntimeFromStore(
  store: PolicyOperationsStore,
  nowIso = new Date().toISOString(),
): Promise<PolicyRuntimeView> {
  const record = await store.ensureInitialized(nowIso);
  return resolvePolicyRuntime(record, nowIso, {
    review_interval_hours: TARGET_US_POLICY.review_interval_hours,
    source_unavailable_grace_hours:
      TARGET_US_POLICY.source_unavailable_grace_hours,
  });
}

/**
 * Idempotent overdue CURRENT → CHECK_DUE + at most one active owner alert.
 * Does not fetch Target. Does not auto-approve policy changes.
 */
export async function runPolicyReviewSchedulerOnStore(
  store: PolicyOperationsStore,
  nowIso = new Date().toISOString(),
): Promise<SchedulerResult> {
  return store.withTransaction(async (tx) => {
    const record = await tx.ensureInitialized(nowIso);
    const runtime = resolvePolicyRuntime(record, nowIso, {
      review_interval_hours: TARGET_US_POLICY.review_interval_hours,
      source_unavailable_grace_hours:
        TARGET_US_POLICY.source_unavailable_grace_hours,
    });

    let transitioned = false;
    let working = record;

    if (
      record.review_state === PolicyReviewState.CURRENT &&
      runtime.effective_state === PolicyReviewState.CHECK_DUE
    ) {
      working = {
        ...record,
        review_state: PolicyReviewState.CHECK_DUE,
        updated_at: nowIso,
        review_note: record.review_note ?? "Scheduled review overdue",
        state_version: (record.state_version ?? 1) + 1,
      };
      await tx.upsertRecord(working);
      await tx.insertReviewEvent({
        policy_id: working.policy_id,
        policy_version: working.policy_version,
        action: "SCHEDULER_CHECK_DUE",
        note: working.review_note,
        actor: "scheduler",
        previous_state: PolicyReviewState.CURRENT,
        resulting_state: PolicyReviewState.CHECK_DUE,
        nowIso,
      });
      transitioned = true;
    }

    let alertCreated = false;
    const effective = resolvePolicyRuntime(working, nowIso, {
      review_interval_hours: TARGET_US_POLICY.review_interval_hours,
      source_unavailable_grace_hours:
        TARGET_US_POLICY.source_unavailable_grace_hours,
    });

    if (
      effective.owner_action_required &&
      working.review_state !== PolicyReviewState.RETIRED
    ) {
      const type =
        working.review_state === PolicyReviewState.CURRENT
          ? PolicyReviewState.CHECK_DUE
          : working.review_state;
      const created = await tx.ensureOwnerAlert({
        policy_id: working.policy_id,
        policy_version: working.policy_version,
        alert_type: type,
        message:
          effective.warning ??
          `Owner action required for policy ${working.policy_id} (${type})`,
        nowIso,
      });
      if (created) {
        alertCreated = true;
        working = {
          ...working,
          last_owner_alert_at: nowIso,
          updated_at: nowIso,
          state_version: (working.state_version ?? 1) + 1,
        };
        await tx.upsertRecord(working);
      }
    }

    return {
      transitioned,
      alert_created: alertCreated,
      runtime: resolvePolicyRuntime(working, nowIso, {
        review_interval_hours: TARGET_US_POLICY.review_interval_hours,
        source_unavailable_grace_hours:
          TARGET_US_POLICY.source_unavailable_grace_hours,
      }),
    };
  });
}

/**
 * Authorized owner review. Never silently applies new eligibility rules.
 */
export async function applyOwnerReviewOnStore(
  store: PolicyOperationsStore,
  args: ApplyOwnerReviewArgs,
): Promise<ApplyOwnerReviewResult> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  return store.withTransaction(async (tx) => {
    const record = await tx.ensureInitialized(nowIso);
    if (record.review_state === PolicyReviewState.RETIRED) {
      throw new Error("policy_already_retired");
    }
    const note = args.note?.trim() ? args.note.trim() : null;
    const previous = record.review_state;

    switch (args.action) {
      case OwnerReviewAction.UNCHANGED: {
        const next: PolicyOperationsRecord = {
          ...record,
          source_last_checked_at: nowIso,
          next_review_at: computeNextReviewAt(
            nowIso,
            TARGET_US_POLICY.review_interval_hours,
          ),
          review_state: PolicyReviewState.CURRENT,
          review_note: note ?? "Owner confirmed policy unchanged",
          updated_at: nowIso,
          state_version: (record.state_version ?? 1) + 1,
        };
        await tx.upsertRecord(next);
        await tx.clearActiveOwnerAlerts(
          next.policy_id,
          next.policy_version,
          nowIso,
        );
        await tx.insertReviewEvent({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          action: OwnerReviewAction.UNCHANGED,
          note: next.review_note,
          actor: args.actor,
          previous_state: previous,
          resulting_state: next.review_state,
          nowIso,
        });
        return { ok: true as const, record: next };
      }

      case OwnerReviewAction.MATERIAL_CHANGE_DETECTED: {
        const pendingId = await tx.insertPendingReview({
          policy_id: record.policy_id,
          from_version: record.policy_version,
          note:
            note ??
            "Material change detected by owner; eligibility rules unchanged until new version approved",
          previous_approved_state: record.review_state,
          detected_state: PolicyReviewState.CHANGE_DETECTED,
          nowIso,
        });
        const next: PolicyOperationsRecord = {
          ...record,
          review_state: PolicyReviewState.REVIEW_REQUIRED,
          review_note:
            note ??
            "Material change flagged; last approved rules preserved; positive eligibility suppressed",
          updated_at: nowIso,
          state_version: (record.state_version ?? 1) + 1,
        };
        await tx.upsertRecord(next);
        await tx.ensureOwnerAlert({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          alert_type: PolicyReviewState.REVIEW_REQUIRED,
          message:
            next.review_note ??
            "Material policy change requires owner follow-up before eligibility conclusions resume",
          nowIso,
        });
        await tx.insertReviewEvent({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          action: OwnerReviewAction.MATERIAL_CHANGE_DETECTED,
          note: next.review_note,
          actor: args.actor,
          previous_state: previous,
          resulting_state: next.review_state,
          nowIso,
          payload: { pending_review_id: pendingId },
        });
        return {
          ok: true as const,
          record: next,
          pending_review_id: pendingId,
        };
      }

      case OwnerReviewAction.SOURCE_UNAVAILABLE: {
        const next: PolicyOperationsRecord = {
          ...record,
          review_state: PolicyReviewState.SOURCE_UNAVAILABLE,
          review_note: note ?? "Official source marked unavailable by owner",
          updated_at: nowIso,
          state_version: (record.state_version ?? 1) + 1,
        };
        await tx.upsertRecord(next);
        await tx.ensureOwnerAlert({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          alert_type: PolicyReviewState.SOURCE_UNAVAILABLE,
          message: next.review_note ?? "Policy source unavailable",
          nowIso,
        });
        await tx.insertReviewEvent({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          action: OwnerReviewAction.SOURCE_UNAVAILABLE,
          note: next.review_note,
          actor: args.actor,
          previous_state: previous,
          resulting_state: next.review_state,
          nowIso,
        });
        return { ok: true as const, record: next };
      }

      case OwnerReviewAction.RETIRED: {
        const next: PolicyOperationsRecord = {
          ...record,
          review_state: PolicyReviewState.RETIRED,
          retired_at: nowIso,
          review_note: note ?? "Policy version retired by owner",
          updated_at: nowIso,
          state_version: (record.state_version ?? 1) + 1,
        };
        await tx.upsertRecord(next);
        await tx.clearActiveOwnerAlerts(
          next.policy_id,
          next.policy_version,
          nowIso,
        );
        await tx.ensureOwnerAlert({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          alert_type: PolicyReviewState.RETIRED,
          message: next.review_note ?? "Policy retired",
          nowIso,
        });
        await tx.insertReviewEvent({
          policy_id: next.policy_id,
          policy_version: next.policy_version,
          action: OwnerReviewAction.RETIRED,
          note: next.review_note,
          actor: args.actor,
          previous_state: previous,
          resulting_state: next.review_state,
          nowIso,
        });
        return { ok: true as const, record: next };
      }

      default:
        throw new Error("invalid_owner_review_action");
    }
  });
}

export async function policyStatusSnapshotOnStore(
  store: PolicyOperationsStore,
  nowIso = new Date().toISOString(),
): Promise<PolicyStatusSnapshot> {
  const scheduled = await runPolicyReviewSchedulerOnStore(store, nowIso);
  return {
    runtime: scheduled.runtime,
    active_owner_alerts: await store.countActiveOwnerAlerts(),
    pending_reviews: (await store.listPendingReviews()).length,
    alerts: await store.listActiveOwnerAlerts(),
    store_kind: store.kind,
  };
}
