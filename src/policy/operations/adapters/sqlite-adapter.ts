/**
 * SQLite PolicyOperationsStore for local development and isolated tests.
 * Not for production Vercel (/tmp forbidden as production backend).
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  migrateUp,
  openDatabase,
  type NobuDatabase,
} from "../../../db/index.js";
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

function rowToRecord(row: Record<string, unknown>): PolicyOperationsRecord {
  return {
    policy_id: String(row.policy_id),
    policy_version: String(row.policy_version),
    approved_at: String(row.approved_at),
    source_url: String(row.source_url),
    source_last_checked_at: String(row.source_last_checked_at),
    next_review_at: String(row.next_review_at),
    review_state: String(
      row.review_state,
    ) as PolicyOperationsRecord["review_state"],
    source_fingerprint:
      row.source_fingerprint == null ? null : String(row.source_fingerprint),
    last_owner_alert_at:
      row.last_owner_alert_at == null ? null : String(row.last_owner_alert_at),
    review_note: row.review_note == null ? null : String(row.review_note),
    retired_at: row.retired_at == null ? null : String(row.retired_at),
    updated_at: String(row.updated_at),
    created_at:
      row.created_at == null ? String(row.approved_at) : String(row.created_at),
    state_version:
      row.state_version == null ? 1 : Number(row.state_version) || 1,
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

function applyR2aColumns(db: NobuDatabase): void {
  const cols = db
    .prepare(`PRAGMA table_info(policy_operations)`)
    .all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("created_at")) {
    db.exec(
      `ALTER TABLE policy_operations ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`,
    );
    db.exec(
      `UPDATE policy_operations SET created_at = approved_at WHERE created_at = '' OR created_at IS NULL`,
    );
  }
  if (!names.has("state_version")) {
    db.exec(
      `ALTER TABLE policy_operations ADD COLUMN state_version INTEGER NOT NULL DEFAULT 1`,
    );
  }

  const pendingCols = db
    .prepare(`PRAGMA table_info(policy_pending_reviews)`)
    .all() as Array<{ name: string }>;
  const pnames = new Set(pendingCols.map((c) => c.name));
  if (!pnames.has("previous_approved_state")) {
    db.exec(
      `ALTER TABLE policy_pending_reviews ADD COLUMN previous_approved_state TEXT`,
    );
  }
  if (!pnames.has("detected_state")) {
    db.exec(`ALTER TABLE policy_pending_reviews ADD COLUMN detected_state TEXT`);
  }
  if (!pnames.has("resolution")) {
    db.exec(`ALTER TABLE policy_pending_reviews ADD COLUMN resolution TEXT`);
  }

  const eventCols = db
    .prepare(`PRAGMA table_info(policy_review_events)`)
    .all() as Array<{ name: string }>;
  const enames = new Set(eventCols.map((c) => c.name));
  if (!enames.has("previous_state")) {
    db.exec(`ALTER TABLE policy_review_events ADD COLUMN previous_state TEXT`);
  }
  if (!enames.has("resulting_state")) {
    db.exec(`ALTER TABLE policy_review_events ADD COLUMN resulting_state TEXT`);
  }
}

export function createSqlitePolicyStore(
  dbPath: string,
): PolicyOperationsStore {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = openDatabase(dbPath);
  migrateUp(db);
  applyR2aColumns(db);

  const store: PolicyOperationsStore = {
    kind: "sqlite",

    async ensureSchema() {
      migrateUp(db);
      applyR2aColumns(db);
    },

    async ensureInitialized(nowIso = new Date().toISOString()) {
      const existing = await store.getActiveRecord();
      if (existing) return existing;
      const seed = buildDefaultPolicyOperationsRecord(nowIso);
      await store.upsertRecord(seed);
      return seed;
    },

    async getActiveRecord(policyId = TARGET_US_POLICY.policy_id) {
      const row = db
        .prepare(
          `SELECT * FROM policy_operations
           WHERE policy_id = ?
           ORDER BY CASE WHEN review_state = 'RETIRED' THEN 1 ELSE 0 END ASC,
                    updated_at DESC
           LIMIT 1`,
        )
        .get(policyId) as Record<string, unknown> | undefined;
      return row ? rowToRecord(row) : null;
    },

    async upsertRecord(record) {
      const created = record.created_at ?? record.approved_at;
      const version = record.state_version ?? 1;
      db.prepare(
        `INSERT INTO policy_operations (
          policy_id, policy_version, approved_at, source_url,
          source_last_checked_at, next_review_at, review_state,
          source_fingerprint, last_owner_alert_at, review_note,
          retired_at, updated_at, created_at, state_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          updated_at = excluded.updated_at,
          state_version = excluded.state_version`,
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
        created,
        version,
      );
    },

    async ensureOwnerAlert(args: EnsureOwnerAlertArgs) {
      const key = ownerAlertKey(
        args.policy_id,
        args.policy_version,
        args.alert_type,
      );
      const existing = db
        .prepare(
          `SELECT * FROM policy_owner_alerts WHERE alert_key = ? AND status = ?`,
        )
        .get(key, OwnerAlertStatus.ACTIVE) as
        | Record<string, unknown>
        | undefined;
      if (existing) {
        db.prepare(
          `UPDATE policy_owner_alerts SET last_notified_at = ? WHERE id = ?`,
        ).run(args.nowIso, String(existing.id));
        return false;
      }
      try {
        db.prepare(
          `INSERT INTO policy_owner_alerts (
            id, policy_id, policy_version, alert_key, alert_type,
            status, message, created_at, cleared_at, last_notified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        ).run(
          newId("poa"),
          args.policy_id,
          args.policy_version,
          key,
          args.alert_type,
          OwnerAlertStatus.ACTIVE,
          args.message.slice(0, 500),
          args.nowIso,
          args.nowIso,
        );
        return true;
      } catch {
        // Unique race: treat as idempotent hit
        return false;
      }
    },

    async clearActiveOwnerAlerts(policyId, policyVersion, nowIso) {
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
    },

    async countActiveOwnerAlerts() {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS c FROM policy_owner_alerts WHERE status = ?`,
        )
        .get(OwnerAlertStatus.ACTIVE) as { c: number };
      return Number(row?.c ?? 0);
    },

    async listActiveOwnerAlerts() {
      const rows = db
        .prepare(
          `SELECT * FROM policy_owner_alerts WHERE status = ? ORDER BY created_at DESC`,
        )
        .all(OwnerAlertStatus.ACTIVE) as Array<Record<string, unknown>>;
      return rows.map(rowToAlert);
    },

    async insertPendingReview(args: InsertPendingReviewArgs) {
      const id = newId("ppr");
      db.prepare(
        `INSERT INTO policy_pending_reviews (
          id, policy_id, from_version, status, note, created_at, resolved_at,
          previous_approved_state, detected_state, resolution
        ) VALUES (?, ?, ?, 'pending', ?, ?, NULL, ?, ?, NULL)`,
      ).run(
        id,
        args.policy_id,
        args.from_version,
        args.note,
        args.nowIso,
        args.previous_approved_state,
        args.detected_state,
      );
      return id;
    },

    async listPendingReviews() {
      const rows = db
        .prepare(
          `SELECT * FROM policy_pending_reviews WHERE status = 'pending' ORDER BY created_at DESC`,
        )
        .all() as Array<Record<string, unknown>>;
      return rows.map(
        (row): PolicyPendingReview => ({
          id: String(row.id),
          policy_id: String(row.policy_id),
          from_version: String(row.from_version),
          status: "pending",
          note: row.note == null ? null : String(row.note),
          created_at: String(row.created_at),
          resolved_at: null,
          previous_approved_state:
            row.previous_approved_state == null
              ? null
              : String(row.previous_approved_state),
          detected_state:
            row.detected_state == null ? null : String(row.detected_state),
          resolution: row.resolution == null ? null : String(row.resolution),
        }),
      );
    },

    async insertReviewEvent(args: InsertReviewEventArgs) {
      db.prepare(
        `INSERT INTO policy_review_events (
          id, policy_id, policy_version, action, note, actor, created_at, payload_json,
          previous_state, resulting_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId("pre"),
        args.policy_id,
        args.policy_version,
        args.action,
        args.note,
        args.actor,
        args.nowIso,
        JSON.stringify(args.payload ?? {}),
        args.previous_state,
        args.resulting_state,
      );
    },

    async listRecentReviewEvents(limit = 20) {
      const rows = db
        .prepare(
          `SELECT * FROM policy_review_events ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>;
      return rows.map(
        (row): PolicyReviewEvent => ({
          id: String(row.id),
          policy_id: String(row.policy_id),
          policy_version: String(row.policy_version),
          action: String(row.action),
          note: row.note == null ? null : String(row.note),
          actor: String(row.actor),
          created_at: String(row.created_at),
          payload_json: String(row.payload_json ?? "{}"),
          previous_state:
            row.previous_state == null ? null : String(row.previous_state),
          resulting_state:
            row.resulting_state == null ? null : String(row.resulting_state),
        }),
      );
    },

    async withTransaction(fn) {
      db.exec("BEGIN");
      try {
        const result = await fn(store);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }
    },
  };

  return store;
}
