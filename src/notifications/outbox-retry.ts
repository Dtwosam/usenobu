/**
 * Durable notification outbox worker (Production-capable).
 *
 * All deliveries (including the first-attempt summary path) go through
 * processNotificationOutboxOpportunity so rolling 24h summary reservation
 * and outbox state stay consistent across workers.
 */
import { randomUUID } from "node:crypto";
import type { AuthStore, DurableNotificationOutboxRow } from "../auth/auth-store.js";
import { getAuthStore } from "../auth/auth-store.js";
import { getAppBaseUrl } from "../auth/config.js";
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
/** Rolling summary cooldown: last successful send + 24 hours. */
export const SUMMARY_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

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

export type OutboxSendFn = (args: {
  opportunityKey: string;
  kind: string;
  accountId: string;
  evidence: OutboxEvidence | null;
  emailNormalized: string;
  subject?: string;
  text?: string;
}) => Promise<{ ok: boolean; error?: string }>;

export type ProcessOutboxOpportunityResult = {
  outcome:
    | "sent"
    | "failed_retryable"
    | "failed_terminal"
    | "suppressed"
    | "skipped"
    | "lease_miss";
  reason?: string;
  opportunityKey: string;
};

/**
 * Process exactly one durable outbox opportunity.
 * Order: load → reject terminal → lease → revalidate account/consent →
 * parse evidence → (summary) reserve rolling 24h → provider send → mark sent
 * / release reserve on failure.
 */
export async function processNotificationOutboxOpportunity(args: {
  store: AuthStore;
  opportunityKey: string;
  nowIso: string;
  env?: EnvRecord;
  /** Inject send for tests; Production uses real provider. */
  sendFn?: OutboxSendFn;
  /** Optional fixed lease holder for concurrent-test determinism. */
  holderId?: string;
}): Promise<ProcessOutboxOpportunityResult> {
  const env = args.env ?? process.env;
  const nowMs = Date.parse(args.nowIso);
  const opportunityKey = String(args.opportunityKey || "").trim();
  if (!opportunityKey) {
    return { outcome: "skipped", reason: "missing_opportunity_key", opportunityKey };
  }

  const existing = await args.store.getNotificationOutboxByOpportunity(
    opportunityKey,
  );
  if (!existing) {
    return { outcome: "skipped", reason: "outbox_not_found", opportunityKey };
  }
  if (existing.status === "sent") {
    return { outcome: "skipped", reason: "already_sent", opportunityKey };
  }
  if (
    existing.status === "failed_terminal" ||
    existing.status === "suppressed"
  ) {
    return {
      outcome: "skipped",
      reason: existing.reason ?? existing.status,
      opportunityKey,
    };
  }
  if (Number(existing.attempt_count ?? 0) >= MAX_ATTEMPTS) {
    await args.store.markNotificationOutboxStatus({
      id: existing.id,
      status: "failed_terminal",
      reason: "max_attempts",
      nowIso: args.nowIso,
    });
    return {
      outcome: "failed_terminal",
      reason: "max_attempts",
      opportunityKey,
    };
  }

  const holderId = args.holderId ?? `outbox_${randomUUID().slice(0, 10)}`;
  const leaseExpires = new Date(nowMs + LEASE_MS).toISOString();
  const leased = await args.store.tryLeaseNotificationOutbox({
    opportunityKey,
    holderId,
    leaseExpiresAt: leaseExpires,
    nowIso: args.nowIso,
  });
  if (!leased) {
    return { outcome: "lease_miss", reason: "lease_not_acquired", opportunityKey };
  }

  // Reload account, purchase ownership, consent.
  const consent = await revalidateOutboxConsent(args.store, leased);
  if (!consent.ok) {
    await args.store.markNotificationOutboxStatus({
      id: leased.id,
      status: consent.terminal ? "failed_terminal" : "suppressed",
      reason: consent.reason,
      nowIso: args.nowIso,
    });
    return {
      outcome: consent.terminal ? "failed_terminal" : "suppressed",
      reason: consent.reason,
      opportunityKey,
    };
  }

  let evidence: OutboxEvidence | null = null;
  if (leased.evidence_json) {
    try {
      evidence = JSON.parse(leased.evidence_json) as OutboxEvidence;
    } catch {
      evidence = null;
    }
  }
  if (!evidence) {
    await args.store.markNotificationOutboxStatus({
      id: leased.id,
      status: "failed_terminal",
      reason: "missing_outbox_evidence",
      nowIso: args.nowIso,
    });
    return {
      outcome: "failed_terminal",
      reason: "missing_outbox_evidence",
      opportunityKey,
    };
  }

  const summaryBuilt =
    leased.kind === "summary" ? resolveSummaryContent(evidence) : null;

  // Summary: durable rolling 24h is the only rate authority.
  let summaryReserved = false;
  if (leased.kind === "summary") {
    const rate = await args.store.tryReserveRollingSummarySend({
      accountId: leased.account_id,
      holderId,
      nowIso: args.nowIso,
      windowMs: SUMMARY_ROLLING_WINDOW_MS,
      reserveTtlMs: LEASE_MS,
    });
    if (!rate.reserved) {
      await args.store.markNotificationOutboxStatus({
        id: leased.id,
        status: "suppressed",
        reason:
          rate.reason === "summary_cooldown"
            ? "summary_cooldown"
            : "summary_reserve_held",
        nowIso: args.nowIso,
      });
      return {
        outcome: "suppressed",
        reason:
          rate.reason === "summary_cooldown"
            ? "summary_cooldown"
            : "summary_reserve_held",
        opportunityKey,
      };
    }
    summaryReserved = true;
  }

  const sendResult = args.sendFn
    ? await args.sendFn({
        opportunityKey,
        kind: leased.kind,
        accountId: leased.account_id,
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
    if (summaryReserved) {
      await args.store.markRollingSummarySent({
        accountId: leased.account_id,
        holderId,
        nowIso: args.nowIso,
      });
    }
    await args.store.markNotificationOutboxStatus({
      id: leased.id,
      status: "sent",
      reason: "sent_outbox_worker",
      nowIso: args.nowIso,
      sentAt: args.nowIso,
    });
    return { outcome: "sent", reason: "sent", opportunityKey };
  }

  if (summaryReserved) {
    await args.store.releaseRollingSummaryReserve({
      accountId: leased.account_id,
      holderId,
      nowIso: args.nowIso,
    });
  }
  const nextAttempt = new Date(
    nowMs +
      BACKOFF_BASE_MS *
        Math.pow(2, Math.min(Number(leased.attempt_count ?? 0), 5)),
  ).toISOString();
  const terminal = sendResult.error === "not_configured";
  await args.store.markNotificationOutboxStatus({
    id: leased.id,
    status: terminal ? "failed_terminal" : "failed_retryable",
    reason: sendResult.error ?? "provider_send_failed",
    nowIso: args.nowIso,
    nextAttemptAt: terminal ? null : nextAttempt,
  });
  return {
    outcome: terminal ? "failed_terminal" : "failed_retryable",
    reason: sendResult.error ?? "provider_send_failed",
    opportunityKey,
  };
}

export async function processDueNotificationOutbox(args: {
  store?: AuthStore;
  nowIso: string;
  env?: EnvRecord;
  limit?: number;
  db?: NobuDatabase;
  /** Inject send for tests; Production uses real provider. */
  sendFn?: OutboxSendFn;
}): Promise<{ processed: number; sent: number; failed: number; suppressed: number }> {
  const env = args.env ?? process.env;
  const store = args.store ?? (await getAuthStore({ env }));
  const limit = args.limit ?? 20;
  void args.db;

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let suppressed = 0;

  const due = await store.listDueNotificationOutbox({
    nowIso: args.nowIso,
    limit,
  });

  for (const row of due) {
    const result = await processNotificationOutboxOpportunity({
      store,
      opportunityKey: row.opportunity_key,
      nowIso: args.nowIso,
      env,
      sendFn: args.sendFn,
    });
    if (result.outcome === "lease_miss" || result.outcome === "skipped") {
      if (result.reason === "max_attempts") {
        failed += 1;
        processed += 1;
      }
      continue;
    }
    processed += 1;
    if (result.outcome === "sent") sent += 1;
    else if (result.outcome === "suppressed") suppressed += 1;
    else failed += 1;
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

/**
 * @deprecated Calendar-day bucket — prefer rolling SUMMARY_ROLLING_WINDOW_MS.
 * Kept for stable opportunity_key shaping only (not the rate authority).
 */
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
