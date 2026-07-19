/**
 * Durable policy operations + owner alerts (SQLite).
 * Owner UNCHANGED reviews update runtime state without code changes.
 */

import { createHash, randomUUID } from "node:crypto";
import type { NobuDatabase } from "../../db/index.js";
import { buildDefaultPolicyOperationsRecord } from "./seed.js";
import {
  computeNextReviewAt,
  ownerAlertKey,
  resolvePolicyRuntime,
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

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function rowToRecord(row: Record<string, unknown>): PolicyOperationsRecord {
  return {
    policy_id: String(row.policy_id),
    policy_version: String(row.policy_version),
    approved_at: String(row.approved_at),
    source_url: String(row.source_url),
    source_last_checked_at: String(row.source_last_checked_at),
    next_review_at: String(row.next_review_at),
    review_state: String(row.review_state) as PolicyOperationsRecord["review_state"],
    source_fingerprint:
      row.source_fingerprint == null ? null : String(row.source_fingerprint),
    last_owner_alert_at:
      row.last_owner_alert_at == null ? null : String(row.last_owner_alert_at),
    review_note: row.review_note == null ? null : String(row.review_note),
    retired_at: row.retired_at == null ? null : String(row.retired_at),
    updated_at: String(row.updated_at),
  };
}

function rowToAlert(row: Record<string, unknown>): PolicyOwnerAlert {
  return {
    id: String(row.id),
    policy_id: String(row.policy_id),
    policy_version: String(row.policy_version),
    alert_key: String(row.alert_key),
    alert_type: String(row.alert_type),
    status: String(row.status) as PolicyOwnerAlert["status"],
    message: String(row.message),
    created_at: String(row.created_at),
    cleared_at: row.cleared_at == null ? null : String(row.cleared_at),
    last_notified_at:
      row.last_notified_at == null ? null : String(row.last_notified_at),
  };
}

export function ensureDefaultPolicyOperations(
  db: NobuDatabase,
  nowIso = new Date().toISOString(),
): PolicyOperationsRecord {
  const existing = getActivePolicyOperations(db);
  if (existing) return existing;

  const seed = buildDefaultPolicyOperationsRecord(nowIso);
  upsertPolicyOperations(db, seed);
  return seed;
}

export function getActivePolicyOperations(
  db: NobuDatabase,
  policyId = TARGET_US_POLICY.policy_id,
): PolicyOperationsRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM policy_operations
       WHERE policy_id = ?
       ORDER BY CASE WHEN review_state = 'RETIRED' THEN 1 ELSE 0 END ASC,
                updated_at DESC
       LIMIT 1`,
    )
    .get(policyId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToRecord(row);
}

export function upsertPolicyOperations(
  db: NobuDatabase,
  record: PolicyOperationsRecord,
): void {
  db.prepare(
    `INSERT INTO policy_operations (
      policy_id, policy_version, approved_at, source_url,
      source_last_checked_at, next_review_at, review_state,
      source_fingerprint, last_owner_alert_at, review_note,
      retired_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(policy_id, policy_version) DO UPDATE SET
      approved_at = excluded.approved_at,
      source_url = excluded.source_url,
      source_last_checked_at = excluded.source_last_checked_at,
      next_review_at = excluded.next_review_at,
      review_state = excluded.review_state,
      source_fingerprint = excluded.source_fingerprint,
      last_owner_alert_at = excluded.last_owner_alert_at,
      review_note = excluded.review_note,
      retired_at = excluded.retired_at,
      updated_at = excluded.updated_at`,
  ).run(
    record.policy_id,
    record.policy_version,
    record.approved_at,
    record.source_url,
    record.source_last_checked_at,
    record.next_review_at,
    record.review_state,
    record.source_fingerprint,
    record.last_owner_alert_at,
    record.review_note,
    record.retired_at,
    record.updated_at,
  );
}

export function getPolicyRuntime(
  db: NobuDatabase,
  nowIso = new Date().toISOString(),
): PolicyRuntimeView {
  const record = ensureDefaultPolicyOperations(db, nowIso);
  return resolvePolicyRuntime(record, nowIso, {
    review_interval_hours: TARGET_US_POLICY.review_interval_hours,
    source_unavailable_grace_hours:
      TARGET_US_POLICY.source_unavailable_grace_hours,
  });
}

/**
 * Scheduler task: mark overdue CURRENT → CHECK_DUE; create at most one active owner alert.
 * Idempotent. Does not fetch Target. Does not auto-approve policy changes.
 */
export function runPolicyReviewScheduler(
  db: NobuDatabase,
  nowIso = new Date().toISOString(),
): {
  transitioned: boolean;
  alert_created: boolean;
  runtime: PolicyRuntimeView;
} {
  const record = ensureDefaultPolicyOperations(db, nowIso);
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
    };
    upsertPolicyOperations(db, working);
    transitioned = true;
  }

  let alertCreated = false;
  if (runtime.owner_action_required && working.review_state !== PolicyReviewState.RETIRED) {
    const type =
      working.review_state === PolicyReviewState.CURRENT
        ? PolicyReviewState.CHECK_DUE
        : working.review_state;
    const created = ensureOwnerAlert(db, {
      policy_id: working.policy_id,
      policy_version: working.policy_version,
      alert_type: type,
      message:
        runtime.warning ??
        `Owner action required for policy ${working.policy_id} (${type})`,
      nowIso,
    });
    if (created) {
      alertCreated = true;
      working = {
        ...working,
        last_owner_alert_at: nowIso,
        updated_at: nowIso,
      };
      upsertPolicyOperations(db, working);
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
}

export function ensureOwnerAlert(
  db: NobuDatabase,
  args: {
    policy_id: string;
    policy_version: string;
    alert_type: string;
    message: string;
    nowIso: string;
  },
): boolean {
  const key = ownerAlertKey(
    args.policy_id,
    args.policy_version,
    args.alert_type,
  );
  const existing = db
    .prepare(
      `SELECT * FROM policy_owner_alerts
       WHERE alert_key = ? AND status = ?`,
    )
    .get(key, OwnerAlertStatus.ACTIVE) as Record<string, unknown> | undefined;

  if (existing) {
    // Idempotent: refresh last_notified_at only
    db.prepare(
      `UPDATE policy_owner_alerts SET last_notified_at = ? WHERE id = ?`,
    ).run(args.nowIso, String(existing.id));
    return false;
  }

  const id = newId("poa");
  db.prepare(
    `INSERT INTO policy_owner_alerts (
      id, policy_id, policy_version, alert_key, alert_type,
      status, message, created_at, cleared_at, last_notified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    id,
    args.policy_id,
    args.policy_version,
    key,
    args.alert_type,
    OwnerAlertStatus.ACTIVE,
    args.message,
    args.nowIso,
    args.nowIso,
  );
  return true;
}

export function clearActiveOwnerAlerts(
  db: NobuDatabase,
  policyId: string,
  policyVersion: string,
  nowIso: string,
): number {
  const result = db
    .prepare(
      `UPDATE policy_owner_alerts
       SET status = ?, cleared_at = ?
       WHERE policy_id = ? AND policy_version = ? AND status = ?`,
    )
    .run(
      OwnerAlertStatus.CLEARED,
      nowIso,
      policyId,
      policyVersion,
      OwnerAlertStatus.ACTIVE,
    );
  return Number(result.changes ?? 0);
}

export function countActiveOwnerAlerts(db: NobuDatabase): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM policy_owner_alerts WHERE status = ?`,
    )
    .get(OwnerAlertStatus.ACTIVE) as { c: number };
  return Number(row?.c ?? 0);
}

export function listActiveOwnerAlerts(db: NobuDatabase): PolicyOwnerAlert[] {
  const rows = db
    .prepare(
      `SELECT * FROM policy_owner_alerts WHERE status = ? ORDER BY created_at DESC`,
    )
    .all(OwnerAlertStatus.ACTIVE) as Array<Record<string, unknown>>;
  return rows.map(rowToAlert);
}

function recordReviewEvent(
  db: NobuDatabase,
  args: {
    policy_id: string;
    policy_version: string;
    action: string;
    note: string | null;
    actor: string;
    nowIso: string;
    payload?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO policy_review_events (
      id, policy_id, policy_version, action, note, actor, created_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("pre"),
    args.policy_id,
    args.policy_version,
    args.action,
    args.note,
    args.actor,
    args.nowIso,
    JSON.stringify(args.payload ?? {}),
  );
}

/**
 * Authorized owner review. Never silently applies new eligibility rules.
 */
export function applyOwnerReview(
  db: NobuDatabase,
  args: {
    action: OwnerReviewActionType;
    note?: string | null;
    actor: string;
    nowIso?: string;
  },
): {
  ok: true;
  record: PolicyOperationsRecord;
  pending_review_id?: string;
} {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const record = ensureDefaultPolicyOperations(db, nowIso);

  if (record.review_state === PolicyReviewState.RETIRED) {
    throw new Error("policy_already_retired");
  }

  const note = args.note?.trim() ? args.note.trim() : null;

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
      };
      upsertPolicyOperations(db, next);
      clearActiveOwnerAlerts(db, next.policy_id, next.policy_version, nowIso);
      recordReviewEvent(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        action: OwnerReviewAction.UNCHANGED,
        note: next.review_note,
        actor: args.actor,
        nowIso,
      });
      return { ok: true, record: next };
    }

    case OwnerReviewAction.MATERIAL_CHANGE_DETECTED: {
      // Preserve old approved policy; create pending review; never auto-apply rules.
      const pendingId = newId("ppr");
      db.prepare(
        `INSERT INTO policy_pending_reviews (
          id, policy_id, from_version, status, note, created_at, resolved_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, NULL)`,
      ).run(
        pendingId,
        record.policy_id,
        record.policy_version,
        note ?? "Material change detected by owner; eligibility rules unchanged until new version approved",
        nowIso,
      );

      const next: PolicyOperationsRecord = {
        ...record,
        review_state: PolicyReviewState.REVIEW_REQUIRED,
        review_note:
          note ??
          "Material change flagged; last approved rules preserved; positive eligibility suppressed",
        updated_at: nowIso,
      };
      upsertPolicyOperations(db, next);
      ensureOwnerAlert(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        alert_type: PolicyReviewState.REVIEW_REQUIRED,
        message:
          next.review_note ??
          "Material policy change requires owner follow-up before eligibility conclusions resume",
        nowIso,
      });
      recordReviewEvent(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        action: OwnerReviewAction.MATERIAL_CHANGE_DETECTED,
        note: next.review_note,
        actor: args.actor,
        nowIso,
        payload: { pending_review_id: pendingId },
      });
      return { ok: true, record: next, pending_review_id: pendingId };
    }

    case OwnerReviewAction.SOURCE_UNAVAILABLE: {
      const next: PolicyOperationsRecord = {
        ...record,
        review_state: PolicyReviewState.SOURCE_UNAVAILABLE,
        // Do not pretend a successful source check — leave source_last_checked_at unchanged.
        review_note: note ?? "Official source marked unavailable by owner",
        updated_at: nowIso,
      };
      upsertPolicyOperations(db, next);
      ensureOwnerAlert(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        alert_type: PolicyReviewState.SOURCE_UNAVAILABLE,
        message: next.review_note ?? "Policy source unavailable",
        nowIso,
      });
      recordReviewEvent(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        action: OwnerReviewAction.SOURCE_UNAVAILABLE,
        note: next.review_note,
        actor: args.actor,
        nowIso,
      });
      return { ok: true, record: next };
    }

    case OwnerReviewAction.RETIRED: {
      const next: PolicyOperationsRecord = {
        ...record,
        review_state: PolicyReviewState.RETIRED,
        retired_at: nowIso,
        review_note: note ?? "Policy version retired by owner",
        updated_at: nowIso,
      };
      upsertPolicyOperations(db, next);
      clearActiveOwnerAlerts(db, next.policy_id, next.policy_version, nowIso);
      ensureOwnerAlert(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        alert_type: PolicyReviewState.RETIRED,
        message: next.review_note ?? "Policy retired",
        nowIso,
      });
      recordReviewEvent(db, {
        policy_id: next.policy_id,
        policy_version: next.policy_version,
        action: OwnerReviewAction.RETIRED,
        note: next.review_note,
        actor: args.actor,
        nowIso,
      });
      return { ok: true, record: next };
    }

    default:
      throw new Error("invalid_owner_review_action");
  }
}

export function listPendingReviews(db: NobuDatabase): PolicyPendingReview[] {
  const rows = db
    .prepare(
      `SELECT * FROM policy_pending_reviews WHERE status = 'pending' ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    policy_id: String(row.policy_id),
    from_version: String(row.from_version),
    status: "pending" as const,
    note: row.note == null ? null : String(row.note),
    created_at: String(row.created_at),
    resolved_at: null,
  }));
}

export function policyStatusSnapshot(
  db: NobuDatabase,
  nowIso = new Date().toISOString(),
): {
  runtime: PolicyRuntimeView;
  active_owner_alerts: number;
  pending_reviews: number;
  alerts: PolicyOwnerAlert[];
} {
  // Apply overdue transition so status page reflects CHECK_DUE
  const scheduled = runPolicyReviewScheduler(db, nowIso);
  return {
    runtime: scheduled.runtime,
    active_owner_alerts: countActiveOwnerAlerts(db),
    pending_reviews: listPendingReviews(db).length,
    alerts: listActiveOwnerAlerts(db),
  };
}

/** Stable hash helper for optional source fingerprints (owner-supplied, not scraped). */
export function fingerprintText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}
