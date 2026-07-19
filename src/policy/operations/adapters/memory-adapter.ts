/**
 * In-memory PolicyOperationsStore — explicit unit tests only.
 * Forbidden as a production fallback.
 */

import { randomUUID } from "node:crypto";
import { buildDefaultPolicyOperationsRecord } from "../seed.js";
import { ownerAlertKey } from "../runtime.js";
import type {
  EnsureOwnerAlertArgs,
  InsertPendingReviewArgs,
  InsertReviewEventArgs,
  PolicyOperationsStore,
} from "../contract.js";
import {
  OwnerAlertStatus,
  type PolicyOperationsRecord,
  type PolicyOwnerAlert,
  type PolicyPendingReview,
  type PolicyReviewEvent,
} from "../types.js";
import { TARGET_US_POLICY } from "../../target-us-policy.js";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function createMemoryPolicyStore(): PolicyOperationsStore {
  let record: PolicyOperationsRecord | null = null;
  const alerts: PolicyOwnerAlert[] = [];
  const pending: PolicyPendingReview[] = [];
  const events: PolicyReviewEvent[] = [];

  const store: PolicyOperationsStore = {
    kind: "memory",

    async ensureSchema() {
      /* no-op */
    },

    async ensureInitialized(nowIso = new Date().toISOString()) {
      if (record) return record;
      const seed = buildDefaultPolicyOperationsRecord(nowIso);
      record = {
        ...seed,
        created_at: seed.created_at ?? seed.approved_at,
        state_version: seed.state_version ?? 1,
      };
      return record;
    },

    async getActiveRecord(policyId = TARGET_US_POLICY.policy_id) {
      if (!record || record.policy_id !== policyId) return null;
      return record;
    },

    async upsertRecord(next) {
      record = { ...next };
    },

    async ensureOwnerAlert(args: EnsureOwnerAlertArgs) {
      const key = ownerAlertKey(
        args.policy_id,
        args.policy_version,
        args.alert_type,
      );
      const existing = alerts.find(
        (a) => a.alert_key === key && a.status === OwnerAlertStatus.ACTIVE,
      );
      if (existing) {
        existing.last_notified_at = args.nowIso;
        return false;
      }
      alerts.push({
        id: newId("poa"),
        policy_id: args.policy_id,
        policy_version: args.policy_version,
        alert_key: key,
        alert_type: args.alert_type,
        status: OwnerAlertStatus.ACTIVE,
        message: args.message.slice(0, 500),
        created_at: args.nowIso,
        cleared_at: null,
        last_notified_at: args.nowIso,
      });
      return true;
    },

    async clearActiveOwnerAlerts(policyId, policyVersion, nowIso) {
      let n = 0;
      for (const a of alerts) {
        if (
          a.policy_id === policyId &&
          a.policy_version === policyVersion &&
          a.status === OwnerAlertStatus.ACTIVE
        ) {
          a.status = OwnerAlertStatus.CLEARED;
          a.cleared_at = nowIso;
          n += 1;
        }
      }
      return n;
    },

    async countActiveOwnerAlerts() {
      return alerts.filter((a) => a.status === OwnerAlertStatus.ACTIVE).length;
    },

    async listActiveOwnerAlerts() {
      return alerts
        .filter((a) => a.status === OwnerAlertStatus.ACTIVE)
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    async insertPendingReview(args: InsertPendingReviewArgs) {
      const id = newId("ppr");
      pending.push({
        id,
        policy_id: args.policy_id,
        from_version: args.from_version,
        status: "pending",
        note: args.note,
        created_at: args.nowIso,
        resolved_at: null,
        previous_approved_state: args.previous_approved_state,
        detected_state: args.detected_state,
        resolution: null,
      });
      return id;
    },

    async listPendingReviews() {
      return pending.filter((p) => p.status === "pending");
    },

    async insertReviewEvent(args: InsertReviewEventArgs) {
      events.push({
        id: newId("pre"),
        policy_id: args.policy_id,
        policy_version: args.policy_version,
        action: args.action,
        note: args.note,
        actor: args.actor,
        created_at: args.nowIso,
        payload_json: JSON.stringify(args.payload ?? {}),
        previous_state: args.previous_state,
        resulting_state: args.resulting_state,
      });
    },

    async listRecentReviewEvents(limit = 20) {
      return events
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    },

    async withTransaction(fn) {
      return fn(store);
    },
  };

  return store;
}
