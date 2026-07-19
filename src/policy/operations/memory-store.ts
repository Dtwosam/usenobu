/**
 * In-process policy operations store for A2MCP/stateless paths and unit tests.
 * When SQLite is available, prefer store.ts. This keeps free A2MCP working without
 * requiring a request-path hard-coded freshness shutdown.
 */

import { buildDefaultPolicyOperationsRecord } from "./seed.js";
import {
  computeNextReviewAt,
  ownerAlertKey,
  resolvePolicyRuntime,
  warningForState,
} from "./runtime.js";
import {
  OwnerAlertStatus,
  OwnerReviewAction,
  PolicyReviewState,
  type OwnerReviewAction as OwnerReviewActionType,
  type PolicyOperationsRecord,
  type PolicyOwnerAlert,
  type PolicyPendingReview,
  type PolicyRuntimeView,
} from "./types.js";
import { TARGET_US_POLICY } from "../target-us-policy.js";
import { randomUUID } from "node:crypto";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

interface MemoryState {
  record: PolicyOperationsRecord;
  alerts: PolicyOwnerAlert[];
  pending: PolicyPendingReview[];
}

let memory: MemoryState | null = null;

export function resetMemoryPolicyOps(): void {
  memory = null;
}

function ensureMemory(nowIso = new Date().toISOString()): MemoryState {
  if (!memory) {
    memory = {
      record: buildDefaultPolicyOperationsRecord(nowIso),
      alerts: [],
      pending: [],
    };
  }
  return memory;
}

export function getMemoryPolicyRuntime(
  nowIso = new Date().toISOString(),
): PolicyRuntimeView {
  const state = ensureMemory(nowIso);
  return resolvePolicyRuntime(state.record, nowIso, {
    review_interval_hours: TARGET_US_POLICY.review_interval_hours,
    source_unavailable_grace_hours:
      TARGET_US_POLICY.source_unavailable_grace_hours,
  });
}

export function setMemoryPolicyRecord(record: PolicyOperationsRecord): void {
  const state = ensureMemory(record.updated_at);
  state.record = record;
}

export function runMemoryPolicyReviewScheduler(
  nowIso = new Date().toISOString(),
): {
  transitioned: boolean;
  alert_created: boolean;
  runtime: PolicyRuntimeView;
} {
  const state = ensureMemory(nowIso);
  const runtime = resolvePolicyRuntime(state.record, nowIso, {
    review_interval_hours: TARGET_US_POLICY.review_interval_hours,
    source_unavailable_grace_hours:
      TARGET_US_POLICY.source_unavailable_grace_hours,
  });

  let transitioned = false;
  if (
    state.record.review_state === PolicyReviewState.CURRENT &&
    runtime.effective_state === PolicyReviewState.CHECK_DUE
  ) {
    state.record = {
      ...state.record,
      review_state: PolicyReviewState.CHECK_DUE,
      updated_at: nowIso,
      review_note: state.record.review_note ?? "Scheduled review overdue",
    };
    transitioned = true;
  }

  let alertCreated = false;
  const effectiveRuntime = resolvePolicyRuntime(state.record, nowIso, {
    review_interval_hours: TARGET_US_POLICY.review_interval_hours,
    source_unavailable_grace_hours:
      TARGET_US_POLICY.source_unavailable_grace_hours,
  });

  if (effectiveRuntime.owner_action_required) {
    const alertType =
      state.record.review_state === PolicyReviewState.CURRENT
        ? PolicyReviewState.CHECK_DUE
        : state.record.review_state;
    const key = ownerAlertKey(
      state.record.policy_id,
      state.record.policy_version,
      alertType,
    );
    const existing = state.alerts.find(
      (a) => a.alert_key === key && a.status === OwnerAlertStatus.ACTIVE,
    );
    if (existing) {
      existing.last_notified_at = nowIso;
    } else {
      state.alerts.push({
        id: newId("poa"),
        policy_id: state.record.policy_id,
        policy_version: state.record.policy_version,
        alert_key: key,
        alert_type: alertType,
        status: OwnerAlertStatus.ACTIVE,
        message:
          effectiveRuntime.warning ??
          warningForState(effectiveRuntime.effective_state) ??
          "Owner action required",
        created_at: nowIso,
        cleared_at: null,
        last_notified_at: nowIso,
      });
      state.record = {
        ...state.record,
        last_owner_alert_at: nowIso,
        updated_at: nowIso,
      };
      alertCreated = true;
    }
  }

  return {
    transitioned,
    alert_created: alertCreated,
    runtime: resolvePolicyRuntime(state.record, nowIso, {
      review_interval_hours: TARGET_US_POLICY.review_interval_hours,
      source_unavailable_grace_hours:
        TARGET_US_POLICY.source_unavailable_grace_hours,
    }),
  };
}

export function applyMemoryOwnerReview(args: {
  action: OwnerReviewActionType;
  note?: string | null;
  actor: string;
  nowIso?: string;
}): {
  ok: true;
  record: PolicyOperationsRecord;
  pending_review_id?: string;
} {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const state = ensureMemory(nowIso);
  const record = state.record;
  const note = args.note?.trim() ? args.note.trim() : null;

  if (record.review_state === PolicyReviewState.RETIRED) {
    throw new Error("policy_already_retired");
  }

  switch (args.action) {
    case OwnerReviewAction.UNCHANGED: {
      state.record = {
        ...record,
        source_last_checked_at: nowIso,
        next_review_at: computeNextReviewAt(
          nowIso,
          TARGET_US_POLICY.review_interval_hours,
        ),
        review_state: PolicyReviewState.CURRENT,
        review_note: note ?? "Owner confirmed policy unchanged",
        updated_at: nowIso,
      };
      for (const a of state.alerts) {
        if (
          a.policy_id === record.policy_id &&
          a.policy_version === record.policy_version &&
          a.status === OwnerAlertStatus.ACTIVE
        ) {
          a.status = OwnerAlertStatus.CLEARED;
          a.cleared_at = nowIso;
        }
      }
      return { ok: true, record: state.record };
    }
    case OwnerReviewAction.MATERIAL_CHANGE_DETECTED: {
      const pendingId = newId("ppr");
      state.pending.push({
        id: pendingId,
        policy_id: record.policy_id,
        from_version: record.policy_version,
        status: "pending",
        note:
          note ??
          "Material change detected; last approved rules preserved",
        created_at: nowIso,
        resolved_at: null,
      });
      state.record = {
        ...record,
        review_state: PolicyReviewState.REVIEW_REQUIRED,
        review_note:
          note ??
          "Material change flagged; positive eligibility suppressed",
        updated_at: nowIso,
      };
      return {
        ok: true,
        record: state.record,
        pending_review_id: pendingId,
      };
    }
    case OwnerReviewAction.SOURCE_UNAVAILABLE: {
      state.record = {
        ...record,
        review_state: PolicyReviewState.SOURCE_UNAVAILABLE,
        review_note: note ?? "Official source marked unavailable by owner",
        updated_at: nowIso,
      };
      return { ok: true, record: state.record };
    }
    case OwnerReviewAction.RETIRED: {
      state.record = {
        ...record,
        review_state: PolicyReviewState.RETIRED,
        retired_at: nowIso,
        review_note: note ?? "Policy version retired by owner",
        updated_at: nowIso,
      };
      return { ok: true, record: state.record };
    }
    default:
      throw new Error("invalid_owner_review_action");
  }
}

export function countMemoryActiveOwnerAlerts(): number {
  const state = ensureMemory();
  return state.alerts.filter((a) => a.status === OwnerAlertStatus.ACTIVE)
    .length;
}

export function getMemoryRecord(): PolicyOperationsRecord {
  return ensureMemory().record;
}
