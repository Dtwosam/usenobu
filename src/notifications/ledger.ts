/**
 * Durable email notification ledger — idempotency + rate limits.
 */
import { randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/migrator.js";
import type {
  EmailNotificationKind,
  EmailNotificationRecord,
  EmailNotificationReason,
  EmailNotificationStatus,
} from "./types.js";

const MS_24H = 24 * 60 * 60 * 1000;

export const MAX_IMMEDIATE_PER_PURCHASE_24H = 1;
export const MAX_IMMEDIATE_PER_ACCOUNT_24H = 3;
export const MAX_SUMMARY_PER_ACCOUNT_24H = 1;

function newId(): string {
  return `enot_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function findNotificationByOpportunity(
  db: NobuDatabase,
  opportunityKey: string,
): EmailNotificationRecord | null {
  try {
    const row = db
      .prepare(`SELECT * FROM email_notifications WHERE opportunity_key = ?`)
      .get(opportunityKey) as EmailNotificationRecord | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function insertNotification(args: {
  db: NobuDatabase;
  purchase_id: string;
  account_id: string;
  alert_id: string | null;
  opportunity_key: string;
  kind: EmailNotificationKind;
  status: EmailNotificationStatus;
  reason: EmailNotificationReason | string;
  recipient_email_hash?: string | null;
  created_at?: string;
}): { id: string; created: boolean } {
  const existing = findNotificationByOpportunity(
    args.db,
    args.opportunity_key,
  );
  if (existing) {
    return { id: existing.id, created: false };
  }

  const id = newId();
  const created_at = args.created_at ?? new Date().toISOString();
  try {
    args.db
      .prepare(
        `INSERT INTO email_notifications (
          id, purchase_id, account_id, alert_id, opportunity_key, kind,
          status, reason, initiated_by, recipient_email_hash, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        args.purchase_id,
        args.account_id,
        args.alert_id,
        args.opportunity_key,
        args.kind,
        args.status,
        args.reason,
        "nobu",
        args.recipient_email_hash ?? null,
        created_at,
      );
    return { id, created: true };
  } catch (err) {
    // Unique race — treat as existing
    const again = findNotificationByOpportunity(
      args.db,
      args.opportunity_key,
    );
    if (again) return { id: again.id, created: false };
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`email_notification_insert_failed: ${message}`);
  }
}

export function countSentSince(args: {
  db: NobuDatabase;
  accountId?: string;
  purchaseId?: string;
  kind?: EmailNotificationKind;
  status?: EmailNotificationStatus;
  sinceIso: string;
}): number {
  try {
    const clauses: string[] = ["created_at >= ?"];
    const params: unknown[] = [args.sinceIso];
    if (args.accountId) {
      clauses.push("account_id = ?");
      params.push(args.accountId);
    }
    if (args.purchaseId) {
      clauses.push("purchase_id = ?");
      params.push(args.purchaseId);
    }
    if (args.kind) {
      clauses.push("kind = ?");
      params.push(args.kind);
    }
    if (args.status) {
      clauses.push("status = ?");
      params.push(args.status);
    } else {
      clauses.push("status IN ('sent', 'combined')");
    }
    const row = args.db
      .prepare(
        `SELECT COUNT(*) AS c FROM email_notifications WHERE ${clauses.join(" AND ")}`,
      )
      .get(...(params as never[])) as { c: number };
    return row.c;
  } catch {
    return 0;
  }
}

export function windowStart24h(nowIso: string): string {
  const t = Date.parse(nowIso);
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base - MS_24H).toISOString();
}

export function isOpportunityClosed(
  db: NobuDatabase,
  opportunityKey: string,
): boolean {
  try {
    const row = db
      .prepare(
        `SELECT opportunity_key FROM closed_price_opportunities WHERE opportunity_key = ?`,
      )
      .get(opportunityKey) as { opportunity_key: string } | undefined;
    return Boolean(row);
  } catch {
    return false;
  }
}

export function closeOpportunity(args: {
  db: NobuDatabase;
  opportunity_key: string;
  purchase_id: string;
  closed_at: string;
  close_reason: string;
}): void {
  try {
    args.db
      .prepare(
        `INSERT OR IGNORE INTO closed_price_opportunities
         (opportunity_key, purchase_id, closed_at, close_reason)
         VALUES (?,?,?,?)`,
      )
      .run(
        args.opportunity_key,
        args.purchase_id,
        args.closed_at,
        args.close_reason,
      );
  } catch {
    /* ignore */
  }
}
