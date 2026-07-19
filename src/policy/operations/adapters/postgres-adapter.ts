/**
 * PostgreSQL PolicyOperationsStore — production durable backend.
 * Connection string from POLICY_OPS_DATABASE_URL or DATABASE_URL.
 * Never logs connection strings or credentials.
 */

import { randomUUID } from "node:crypto";
import pg from "pg";
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

const { Pool } = pg;

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Postgres schema for policy operations (idempotent). */
export const POSTGRES_POLICY_OPS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS policy_operations (
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_last_checked_at TEXT NOT NULL,
  next_review_at TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK (review_state IN (
    'CURRENT','CHECK_DUE','SOURCE_UNAVAILABLE','CHANGE_DETECTED','REVIEW_REQUIRED','RETIRED'
  )),
  source_fingerprint TEXT,
  last_owner_alert_at TEXT,
  review_note TEXT,
  retired_at TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (policy_id, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_policy_operations_review_state
  ON policy_operations (review_state);
CREATE INDEX IF NOT EXISTS idx_policy_operations_next_review
  ON policy_operations (next_review_at);

CREATE TABLE IF NOT EXISTS policy_owner_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  alert_key TEXT NOT NULL UNIQUE,
  alert_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cleared')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleared_at TEXT,
  last_notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_owner_alerts_status
  ON policy_owner_alerts (status);
CREATE INDEX IF NOT EXISTS idx_policy_owner_alerts_policy
  ON policy_owner_alerts (policy_id, policy_version);

CREATE TABLE IF NOT EXISTS policy_pending_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  from_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
  note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  previous_approved_state TEXT,
  detected_state TEXT,
  resolution TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_pending_reviews_status
  ON policy_pending_reviews (status);

CREATE TABLE IF NOT EXISTS policy_review_events (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  previous_state TEXT,
  resulting_state TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_review_events_policy
  ON policy_review_events (policy_id, created_at);
`;

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

type Queryable = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<pg.QueryResult<Record<string, unknown>>>;
};

export function createPostgresPolicyStore(
  connectionString: string,
): PolicyOperationsStore {
  // ssl: prefer for hosted Postgres; local often needs rejectUnauthorized false only when sslmode=require
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 10_000,
    ssl: connectionString.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Never attach connectionString to errors thrown upward with raw text
  const safeQuery = async (
    client: Queryable,
    text: string,
    params?: unknown[],
  ) => {
    try {
      return await client.query(text, params);
    } catch (err) {
      const message =
        err instanceof Error ? err.message.replace(connectionString, "[redacted]") : "query_failed";
      throw new Error(`policy_ops_postgres_error: ${message.slice(0, 200)}`);
    }
  };

  function makeStore(client: Queryable): PolicyOperationsStore {
    const store: PolicyOperationsStore = {
      kind: "postgres",

      async ensureSchema() {
        await safeQuery(client, POSTGRES_POLICY_OPS_SCHEMA_SQL);
      },

      async ensureInitialized(nowIso = new Date().toISOString()) {
        const existing = await store.getActiveRecord();
        if (existing) return existing;
        const seed = buildDefaultPolicyOperationsRecord(nowIso);
        // Race-safe insert: only if missing
        await safeQuery(
          client,
          `INSERT INTO policy_operations (
            policy_id, policy_version, approved_at, source_url,
            source_last_checked_at, next_review_at, review_state,
            source_fingerprint, last_owner_alert_at, review_note,
            retired_at, updated_at, created_at, state_version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (policy_id, policy_version) DO NOTHING`,
          [
            seed.policy_id,
            seed.policy_version,
            seed.approved_at,
            seed.source_url,
            seed.source_last_checked_at,
            seed.next_review_at,
            seed.review_state,
            seed.source_fingerprint,
            seed.last_owner_alert_at,
            seed.review_note,
            seed.retired_at,
            seed.updated_at,
            seed.created_at ?? seed.approved_at,
            seed.state_version ?? 1,
          ],
        );
        const again = await store.getActiveRecord();
        if (!again) throw new Error("policy_ops_init_failed");
        return again;
      },

      async getActiveRecord(policyId = TARGET_US_POLICY.policy_id) {
        const res = await safeQuery(
          client,
          `SELECT * FROM policy_operations
           WHERE policy_id = $1
           ORDER BY CASE WHEN review_state = 'RETIRED' THEN 1 ELSE 0 END ASC,
                    updated_at DESC
           LIMIT 1`,
          [policyId],
        );
        const row = res.rows[0];
        return row ? rowToRecord(row) : null;
      },

      async upsertRecord(record) {
        await safeQuery(
          client,
          `INSERT INTO policy_operations (
            policy_id, policy_version, approved_at, source_url,
            source_last_checked_at, next_review_at, review_state,
            source_fingerprint, last_owner_alert_at, review_note,
            retired_at, updated_at, created_at, state_version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (policy_id, policy_version) DO UPDATE SET
            approved_at = EXCLUDED.approved_at,
            source_url = EXCLUDED.source_url,
            source_last_checked_at = EXCLUDED.source_last_checked_at,
            next_review_at = EXCLUDED.next_review_at,
            review_state = EXCLUDED.review_state,
            source_fingerprint = EXCLUDED.source_fingerprint,
            last_owner_alert_at = EXCLUDED.last_owner_alert_at,
            review_note = EXCLUDED.review_note,
            retired_at = EXCLUDED.retired_at,
            updated_at = EXCLUDED.updated_at,
            state_version = EXCLUDED.state_version`,
          [
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
            record.created_at ?? record.approved_at,
            record.state_version ?? 1,
          ],
        );
      },

      async ensureOwnerAlert(args: EnsureOwnerAlertArgs) {
        const key = ownerAlertKey(
          args.policy_id,
          args.policy_version,
          args.alert_type,
        );
        const existing = await safeQuery(
          client,
          `SELECT * FROM policy_owner_alerts WHERE alert_key = $1 AND status = $2`,
          [key, OwnerAlertStatus.ACTIVE],
        );
        if (existing.rows[0]) {
          await safeQuery(
            client,
            `UPDATE policy_owner_alerts SET last_notified_at = $1 WHERE id = $2`,
            [args.nowIso, String(existing.rows[0].id)],
          );
          return false;
        }
        try {
          await safeQuery(
            client,
            `INSERT INTO policy_owner_alerts (
              id, policy_id, policy_version, alert_key, alert_type,
              status, message, created_at, cleared_at, last_notified_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)`,
            [
              newId("poa"),
              args.policy_id,
              args.policy_version,
              key,
              args.alert_type,
              OwnerAlertStatus.ACTIVE,
              args.message.slice(0, 500),
              args.nowIso,
              args.nowIso,
            ],
          );
          return true;
        } catch {
          return false;
        }
      },

      async clearActiveOwnerAlerts(policyId, policyVersion, nowIso) {
        const res = await safeQuery(
          client,
          `UPDATE policy_owner_alerts
           SET status = $1, cleared_at = $2
           WHERE policy_id = $3 AND policy_version = $4 AND status = $5`,
          [
            OwnerAlertStatus.CLEARED,
            nowIso,
            policyId,
            policyVersion,
            OwnerAlertStatus.ACTIVE,
          ],
        );
        return res.rowCount ?? 0;
      },

      async countActiveOwnerAlerts() {
        const res = await safeQuery(
          client,
          `SELECT COUNT(*)::int AS c FROM policy_owner_alerts WHERE status = $1`,
          [OwnerAlertStatus.ACTIVE],
        );
        return Number(res.rows[0]?.c ?? 0);
      },

      async listActiveOwnerAlerts() {
        const res = await safeQuery(
          client,
          `SELECT * FROM policy_owner_alerts WHERE status = $1 ORDER BY created_at DESC`,
          [OwnerAlertStatus.ACTIVE],
        );
        return res.rows.map(rowToAlert);
      },

      async insertPendingReview(args: InsertPendingReviewArgs) {
        const id = newId("ppr");
        await safeQuery(
          client,
          `INSERT INTO policy_pending_reviews (
            id, policy_id, from_version, status, note, created_at, resolved_at,
            previous_approved_state, detected_state, resolution
          ) VALUES ($1,$2,$3,'pending',$4,$5,NULL,$6,$7,NULL)`,
          [
            id,
            args.policy_id,
            args.from_version,
            args.note,
            args.nowIso,
            args.previous_approved_state,
            args.detected_state,
          ],
        );
        return id;
      },

      async listPendingReviews() {
        const res = await safeQuery(
          client,
          `SELECT * FROM policy_pending_reviews WHERE status = 'pending' ORDER BY created_at DESC`,
        );
        return res.rows.map(
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
            resolution:
              row.resolution == null ? null : String(row.resolution),
          }),
        );
      },

      async insertReviewEvent(args: InsertReviewEventArgs) {
        await safeQuery(
          client,
          `INSERT INTO policy_review_events (
            id, policy_id, policy_version, action, note, actor, created_at, payload_json,
            previous_state, resulting_state
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
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
          ],
        );
      },

      async listRecentReviewEvents(limit = 20) {
        const res = await safeQuery(
          client,
          `SELECT * FROM policy_review_events ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );
        return res.rows.map(
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
        // Nested: if already inside a client transaction via outer store, just run
        if (client !== pool) {
          return fn(store);
        }
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const txStore = makeStore(c);
          const result = await fn(txStore);
          await c.query("COMMIT");
          return result;
        } catch (err) {
          try {
            await c.query("ROLLBACK");
          } catch {
            /* ignore */
          }
          throw err;
        } finally {
          c.release();
        }
      },
    };
    return store;
  }

  return makeStore(pool);
}
