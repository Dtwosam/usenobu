/**
 * Durable notification outbox worker (Production-capable).
 *
 * Lists due pending/failed_retryable/expired-sending rows, leases, revalidates
 * consent, reconstructs evidence, calls the real email provider, marks sent
 * only after success.
 */
import { randomUUID } from "node:crypto";
import type { AuthStore, DurableNotificationOutboxRow } from "../auth/auth-store.js";
import { getAuthStore } from "../auth/auth-store.js";
import { getAppBaseUrl, isAuthTestMode } from "../auth/config.js";
import type { NobuDatabase } from "../db/migrator.js";
import {
  sendPriceDropEmail,
  sendSummaryEmailDirect,
  buildSummaryEmailText,
} from "./email-send.js";
import type { PriceDropEmailEvidence } from "./types.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const BACKOFF_BASE_MS = 30_000;

export type OutboxEvidence = {
  product_title: string;
  purchase_price: number;
  observed_price: number;
  potential_recovery: number;
  currency: string;
  monitoring_deadline: string | null;
  observed_at: string;
  review_path: string;
  summary_items?: Array<{
    product_title: string;
    potential_recovery: number;
    reviewUrl: string;
  }>;
  /** Pre-built summary content for durable retries (not single-drop template). */
  summary_subject?: string;
  summary_text?: string;
};

export async function processDueNotificationOutbox(args: {
  store?: AuthStore;
  nowIso: string;
  env?: EnvRecord;
  limit?: number;
  db?: NobuDatabase;
  /** Inject send for tests; Production uses real provider. */
  sendFn?: (args: {
    opportunityKey: string;
    kind: string;
    accountId: string;
    evidence: OutboxEvidence | null;
    emailNormalized: string;
    subject?: string;
    text?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}): Promise<{ processed: number; sent: number; failed: number; suppressed: number }> {
  const env = args.env ?? process.env;
  const store = args.store ?? (await getAuthStore({ env }));
  const limit = args.limit ?? 20;
  const nowMs = Date.parse(args.nowIso);
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  const due = await store.listDueNotificationOutbox({
    nowIso: args.nowIso,
    limit,
  });

  const holderId = `outbox_${randomUUID().slice(0, 10)}`;
  const leaseExpires = new Date(nowMs + LEASE_MS).toISOString();

  for (const row of due) {
    if (Number(row.attempt_count ?? 0) >= MAX_ATTEMPTS) {
      await store.markNotificationOutboxStatus({
        id: row.id,
        status: "failed_terminal",
        reason: "max_attempts",
        nowIso: args.nowIso,
      });
      failed += 1;
      processed += 1;
      continue;
    }

    const leased = await store.tryLeaseNotificationOutbox({
      opportunityKey: row.opportunity_key,
      holderId,
      leaseExpiresAt: leaseExpires,
      nowIso: args.nowIso,
    });
    if (!leased) continue;
    processed += 1;

    // Revalidate consent + identity from durable store before every send.
    const consent = await revalidateOutboxConsent(store, leased);
    if (!consent.ok) {
      await store.markNotificationOutboxStatus({
        id: row.id,
        status: consent.terminal ? "failed_terminal" : "suppressed",
        reason: consent.reason,
        nowIso: args.nowIso,
      });
      if (consent.reason === "consent_revoked") suppressed += 1;
      else failed += 1;
      continue;
    }

    let evidence: OutboxEvidence | null = null;
    if (leased.evidence_json) {
      try {
        evidence = JSON.parse(leased.evidence_json) as OutboxEvidence;
      } catch {
        evidence = null;
      }
    }

    const summaryBuilt =
      row.kind === "summary" && evidence
        ? resolveSummaryContent(evidence)
        : null;

    // Summary: durable 24h account bucket shared across instances.
    let summaryRateKey: string | null = null;
    if (row.kind === "summary") {
      const windowStart = summaryWindowStart(args.nowIso);
      summaryRateKey = `summary_24h:${row.account_id}:${windowStart}`;
      const rate = await store.tryReserveNotificationRate({
        rateKey: summaryRateKey,
        accountId: row.account_id,
        kind: "summary",
        windowStart,
        limitCount: 1,
        nowIso: args.nowIso,
      });
      if (!rate.reserved) {
        await store.markNotificationOutboxStatus({
          id: row.id,
          status: "suppressed",
          reason: "summary_cooldown",
          nowIso: args.nowIso,
        });
        suppressed += 1;
        continue;
      }
    }

    const sendResult = args.sendFn
      ? await args.sendFn({
          opportunityKey: row.opportunity_key,
          kind: row.kind,
          accountId: row.account_id,
          evidence,
          emailNormalized: consent.emailNormalized,
          subject: summaryBuilt?.subject,
          text: summaryBuilt?.text,
        })
      : await productionSend({
          row: leased,
          evidence,
          emailNormalized: consent.emailNormalized,
          env,
          summaryBuilt,
        });

    if (sendResult.ok) {
      await store.markNotificationOutboxStatus({
        id: row.id,
        status: "sent",
        reason: "sent_outbox_worker",
        nowIso: args.nowIso,
        sentAt: args.nowIso,
      });
      sent += 1;
    } else {
      if (summaryRateKey) {
        await store.releaseNotificationRate({
          rateKey: summaryRateKey,
          nowIso: args.nowIso,
        });
      }
      const nextAttempt = new Date(
        nowMs +
          BACKOFF_BASE_MS *
            Math.pow(2, Math.min(Number(row.attempt_count ?? 0), 5)),
      ).toISOString();
      const terminal = sendResult.error === "not_configured";
      await store.markNotificationOutboxStatus({
        id: row.id,
        status: terminal ? "failed_terminal" : "failed_retryable",
        reason: sendResult.error ?? "provider_send_failed",
        nowIso: args.nowIso,
        nextAttemptAt: terminal ? null : nextAttempt,
      });
      failed += 1;
    }
  }

  return { processed, sent, failed, suppressed };
}

async function revalidateOutboxConsent(
  store: AuthStore,
  row: DurableNotificationOutboxRow,
): Promise<
  | { ok: true; emailNormalized: string }
  | { ok: false; reason: string; terminal: boolean }
> {
  const account = await store.getAccountById(row.account_id);
  if (!account?.email_verified_at || !account.email_normalized) {
    return {
      ok: false,
      reason: "missing_verified_email",
      terminal: true,
    };
  }

  const blob = await store.getPurchaseBlobByPurchaseId(row.purchase_id);
  if (!blob) {
    return { ok: false, reason: "missing_purchase_blob", terminal: true };
  }
  if (blob.account_id !== row.account_id) {
    return {
      ok: false,
      reason: "account_purchase_mismatch",
      terminal: true,
    };
  }
  if (Number(blob.email_alerts_enabled ?? 0) !== 1) {
    return { ok: false, reason: "consent_revoked", terminal: false };
  }

  return { ok: true, emailNormalized: account.email_normalized };
}

/** UTC calendar-day window start for durable 24h summary bucket. */
export function summaryWindowStart(nowIso: string): string {
  const d = new Date(nowIso);
  if (Number.isNaN(d.getTime())) {
    return nowIso.slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function resolveSummaryContent(evidence: OutboxEvidence): {
  subject: string;
  text: string;
} {
  if (evidence.summary_subject && evidence.summary_text) {
    return {
      subject: evidence.summary_subject,
      text: evidence.summary_text,
    };
  }
  const baseUrl = "";
  const items = evidence.summary_items ?? [
    {
      product_title: evidence.product_title,
      potential_recovery: evidence.potential_recovery,
      reviewUrl: `${baseUrl}${evidence.review_path}`,
    },
  ];
  return buildSummaryEmailText({ items });
}

async function productionSend(args: {
  row: DurableNotificationOutboxRow;
  evidence: OutboxEvidence | null;
  emailNormalized: string;
  env: EnvRecord;
  summaryBuilt: { subject: string; text: string } | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { row, evidence, emailNormalized, env, summaryBuilt } = args;
  if (!evidence) {
    return { ok: false, error: "missing_outbox_evidence" };
  }

  const baseUrl = getAppBaseUrl(env);
  const reviewUrl = `${baseUrl}${evidence.review_path}`;
  const disableAlertsUrl = `${baseUrl}/purchases/${row.purchase_id}?alerts=off`;

  if (row.kind === "summary") {
    const built =
      summaryBuilt ??
      resolveSummaryContent({
        ...evidence,
        summary_items: evidence.summary_items?.map((it) => ({
          ...it,
          reviewUrl: it.reviewUrl.startsWith("http")
            ? it.reviewUrl
            : `${baseUrl}${it.reviewUrl}`,
        })),
      });
    const send = await sendSummaryEmailDirect({
      emailNormalized,
      subject: built.subject,
      text: built.text,
      env,
      idempotencyKey: row.opportunity_key,
    });
    if (!send.ok) {
      return {
        ok: false,
        error:
          send.error === "not_configured"
            ? "not_configured"
            : "provider_send_failed",
      };
    }
    return { ok: true };
  }

  const pe: PriceDropEmailEvidence = {
    purchase_id: row.purchase_id,
    product_title: evidence.product_title,
    purchase_price: evidence.purchase_price,
    observed_price: evidence.observed_price,
    potential_recovery: evidence.potential_recovery,
    currency: evidence.currency,
    monitoring_deadline: evidence.monitoring_deadline,
    observed_at: evidence.observed_at,
    alert_id: row.alert_id ?? "unknown",
    opportunity_key: row.opportunity_key,
    review_path: evidence.review_path,
  };

  const send = await sendPriceDropEmail({
    emailNormalized,
    evidence: pe,
    reviewUrl,
    disableAlertsUrl,
    env,
    idempotencyKey: row.opportunity_key,
  });
  if (!send.ok) {
    return {
      ok: false,
      error:
        send.error === "not_configured"
          ? "not_configured"
          : "provider_send_failed",
    };
  }
  return { ok: true };
}

/** Build sanitized evidence JSON for durable outbox (no secrets). */
export function buildOutboxEvidenceJson(
  evidence: PriceDropEmailEvidence,
  extra?: Partial<OutboxEvidence>,
): string {
  const payload: OutboxEvidence = {
    product_title: evidence.product_title,
    purchase_price: evidence.purchase_price,
    observed_price: evidence.observed_price,
    potential_recovery: evidence.potential_recovery,
    currency: evidence.currency,
    monitoring_deadline: evidence.monitoring_deadline,
    observed_at: evidence.observed_at,
    review_path: evidence.review_path,
    ...extra,
  };
  return JSON.stringify(payload);
}

/** Build summary evidence with durable subject/body for retries. */
export function buildSummaryOutboxEvidenceJson(args: {
  evidence: PriceDropEmailEvidence;
  items: Array<{
    product_title: string;
    potential_recovery: number;
    reviewUrl: string;
  }>;
}): string {
  const built = buildSummaryEmailText({ items: args.items });
  return buildOutboxEvidenceJson(args.evidence, {
    summary_items: args.items,
    summary_subject: built.subject,
    summary_text: built.text,
  });
}
