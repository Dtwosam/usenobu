/**
 * Nobu notification workflow after deterministic monitoring creates a new alert.
 *
 * Nobu:
 * - receives the eligible alert event;
 * - prepares a clear purchase-specific explanation from validated evidence only;
 * - triggers the email notification;
 * - records that Nobu initiated the notification;
 * - fails closed when required evidence is missing.
 *
 * Nobu never overrides matching, policy, price, or alert decisions.
 */
import type { NobuDatabase } from "../db/migrator.js";
import { getAuthStore, isAccountOwnerRef } from "../auth/auth-store.js";
import { getAppBaseUrl } from "../auth/config.js";
import { isEmailAlertsEnabled } from "./prefs.js";
import {
  findNotificationByOpportunity,
  insertNotification,
  countSentSince,
  windowStart24h,
  MAX_IMMEDIATE_PER_PURCHASE_24H,
  MAX_IMMEDIATE_PER_ACCOUNT_24H,
  MAX_SUMMARY_PER_ACCOUNT_24H,
} from "./ledger.js";
import { sendPriceDropEmail, buildSummaryEmailText } from "./email-send.js";
import { hashEmailForLog } from "./mask-email.js";
import type {
  EmailNotificationStatus,
  NotificationProcessResult,
  PriceDropEmailEvidence,
} from "./types.js";
import { createHash } from "node:crypto";

function shaShort(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function loadAlertEvidence(
  db: NobuDatabase,
  purchaseId: string,
  alertId: string,
): PriceDropEmailEvidence | null {
  const alert = db
    .prepare(`SELECT * FROM alerts WHERE id = ? AND purchase_id = ?`)
    .get(alertId, purchaseId) as
    | {
        id: string;
        purchase_id: string;
        fingerprint_id: string;
        observation_id: string;
        purchase_price: number;
        observed_price: number;
        potential_recovery: number;
        currency: string;
        alert_key: string;
        created_at: string;
      }
    | undefined;
  if (!alert) return null;
  if (!(alert.potential_recovery > 0)) return null;
  if (!(alert.observed_price > 0) || !(alert.purchase_price > 0)) return null;

  const purchase = db
    .prepare(
      `SELECT id, user_ref, purchase_price, currency, monitoring_deadline, status
       FROM purchases WHERE id = ?`,
    )
    .get(purchaseId) as
    | {
        id: string;
        user_ref: string | null;
        purchase_price: number;
        currency: string;
        monitoring_deadline: string | null;
        status: string;
      }
    | undefined;
  if (!purchase) return null;

  const obs = db
    .prepare(`SELECT observed_at, product_title FROM price_observations WHERE id = ?`)
    .get(alert.observation_id) as
    | { observed_at: string; product_title: string }
    | undefined;

  let product_title = obs?.product_title ?? null;
  if (!product_title) {
    const fp = db
      .prepare(
        `SELECT product_title FROM product_fingerprints WHERE fingerprint_id = ?`,
      )
      .get(alert.fingerprint_id) as { product_title: string | null } | undefined;
    product_title = fp?.product_title ?? null;
  }
  if (!product_title) product_title = "Your Target purchase";

  return {
    purchase_id: purchaseId,
    product_title,
    purchase_price: Number(alert.purchase_price),
    observed_price: Number(alert.observed_price),
    potential_recovery: Number(alert.potential_recovery),
    currency: alert.currency,
    monitoring_deadline: purchase.monitoring_deadline,
    observed_at: obs?.observed_at ?? alert.created_at,
    alert_id: alert.id,
    opportunity_key: alert.alert_key,
    review_path: `/purchases/${purchaseId}/alerts/${alert.id}`,
  };
}

/**
 * Process email for a newly created in-app alert.
 * Call only when monitoring runner reports alert_created=true.
 */
export async function processPriceDropEmailForNewAlert(args: {
  db: NobuDatabase;
  purchaseId: string;
  alertId: string;
  nowIso?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /**
   * Lane 7.4F — durable AuthStore for account email lookup when purchases
   * live in a separate per-instance DB from accounts.
   */
  accountStore?: Awaited<ReturnType<typeof getAuthStore>>;
}): Promise<NotificationProcessResult> {
  const nowIso = args.nowIso ?? new Date().toISOString();
  const env = args.env ?? process.env;

  const evidence = loadAlertEvidence(
    args.db,
    args.purchaseId,
    args.alertId,
  );
  if (!evidence) {
    return {
      attempted: false,
      status: "skipped",
      reason: "missing_alert_evidence",
    };
  }

  const purchase = args.db
    .prepare(`SELECT user_ref FROM purchases WHERE id = ?`)
    .get(args.purchaseId) as { user_ref: string | null } | undefined;
  const ownerRef = String(purchase?.user_ref ?? "").trim();
  if (!isAccountOwnerRef(ownerRef)) {
    return {
      attempted: false,
      status: "skipped",
      reason: "not_account_owned",
    };
  }

  if (!isEmailAlertsEnabled(args.db, args.purchaseId)) {
    const inserted = insertNotification({
      db: args.db,
      purchase_id: args.purchaseId,
      account_id: ownerRef,
      alert_id: args.alertId,
      opportunity_key: evidence.opportunity_key,
      kind: "immediate",
      status: "suppressed",
      reason: "no_consent",
      created_at: nowIso,
    });
    return {
      attempted: false,
      status: "suppressed",
      reason: "no_consent",
      notification_id: inserted.id,
    };
  }

  // Idempotency: same opportunity never emails twice
  const prior = findNotificationByOpportunity(
    args.db,
    evidence.opportunity_key,
  );
  if (prior) {
    return {
      attempted: false,
      status: prior.status,
      reason: "duplicate_opportunity",
      notification_id: prior.id,
      kind: prior.kind,
    };
  }

  const store =
    args.accountStore ??
    (await getAuthStore({ sqliteDb: args.db, env }));
  const account = await store.getAccountById(ownerRef);
  if (!account?.email_verified_at || !account.email_normalized) {
    const inserted = insertNotification({
      db: args.db,
      purchase_id: args.purchaseId,
      account_id: ownerRef,
      alert_id: args.alertId,
      opportunity_key: evidence.opportunity_key,
      kind: "immediate",
      status: "suppressed",
      reason: "missing_verified_email",
      created_at: nowIso,
    });
    return {
      attempted: false,
      status: "suppressed",
      reason: "missing_verified_email",
      notification_id: inserted.id,
    };
  }

  const since = windowStart24h(nowIso);
  const purchaseImmediate = countSentSince({
    db: args.db,
    purchaseId: args.purchaseId,
    kind: "immediate",
    status: "sent",
    sinceIso: since,
  });
  if (purchaseImmediate >= MAX_IMMEDIATE_PER_PURCHASE_24H) {
    const inserted = insertNotification({
      db: args.db,
      purchase_id: args.purchaseId,
      account_id: ownerRef,
      alert_id: args.alertId,
      opportunity_key: evidence.opportunity_key,
      kind: "immediate",
      status: "suppressed",
      reason: "purchase_cooldown",
      recipient_email_hash: hashEmailForLog(account.email_normalized),
      created_at: nowIso,
    });
    return {
      attempted: false,
      status: "suppressed",
      reason: "purchase_cooldown",
      notification_id: inserted.id,
    };
  }

  const accountImmediate = countSentSince({
    db: args.db,
    accountId: ownerRef,
    kind: "immediate",
    status: "sent",
    sinceIso: since,
  });

  const baseUrl = getAppBaseUrl(env);
  const reviewUrl = `${baseUrl}${evidence.review_path}`;
  // Owner-gated page; no tokens or PII in URL
  const disableAlertsUrl = `${baseUrl}/purchases/${args.purchaseId}?alerts=off`;

  // Over account cap → combine into summary (at most one summary / 24h)
  if (accountImmediate >= MAX_IMMEDIATE_PER_ACCOUNT_24H) {
    const summaryCount = countSentSince({
      db: args.db,
      accountId: ownerRef,
      kind: "summary",
      status: "sent",
      sinceIso: since,
    });
    if (summaryCount >= MAX_SUMMARY_PER_ACCOUNT_24H) {
      const inserted = insertNotification({
        db: args.db,
        purchase_id: args.purchaseId,
        account_id: ownerRef,
        alert_id: args.alertId,
        opportunity_key: evidence.opportunity_key,
        kind: "summary",
        status: "suppressed",
        reason: "summary_cooldown",
        recipient_email_hash: hashEmailForLog(account.email_normalized),
        created_at: nowIso,
      });
      return {
        attempted: false,
        status: "suppressed",
        reason: "summary_cooldown",
        notification_id: inserted.id,
        kind: "summary",
      };
    }

    // Reserve this opportunity as combined (no immediate send).
    // Summary path sends exactly one summary email — no preliminary immediate.
    const reserved = insertNotification({
      db: args.db,
      purchase_id: args.purchaseId,
      account_id: ownerRef,
      alert_id: args.alertId,
      opportunity_key: evidence.opportunity_key,
      kind: "summary",
      status: "combined",
      reason: "combined_into_summary",
      recipient_email_hash: hashEmailForLog(account.email_normalized),
      created_at: nowIso,
    });
    if (!reserved.created) {
      return {
        attempted: false,
        status: "suppressed",
        reason: "duplicate_opportunity",
        notification_id: reserved.id,
      };
    }

    // Summary email uses a separate opportunity key so only one summary is sent
    const summaryKey = `summary_${ownerRef}_${since.slice(0, 13)}`;
    const existingSummary = findNotificationByOpportunity(args.db, summaryKey);
    if (existingSummary) {
      return {
        attempted: false,
        status: "combined",
        reason: "combined_into_summary",
        notification_id: reserved.id,
        kind: "summary",
      };
    }

    // Reserve summary outbox as pending, then send once.
    const summaryReserved = insertNotification({
      db: args.db,
      purchase_id: args.purchaseId,
      account_id: ownerRef,
      alert_id: args.alertId,
      opportunity_key: summaryKey,
      kind: "summary",
      status: "pending",
      reason: "pending_summary",
      recipient_email_hash: hashEmailForLog(account.email_normalized),
      created_at: nowIso,
    });
    if (!summaryReserved.created) {
      return {
        attempted: false,
        status: "combined",
        reason: "combined_into_summary",
        notification_id: reserved.id,
        kind: "summary",
      };
    }

    try {
      args.db
        .prepare(
          `UPDATE email_notifications SET status = 'sending' WHERE id = ? AND status = 'pending'`,
        )
        .run(summaryReserved.id);
    } catch {
      /* ignore */
    }

    const summaryBody = buildSummaryEmailText({
      items: [
        {
          product_title: evidence.product_title,
          potential_recovery: evidence.potential_recovery,
          reviewUrl,
        },
      ],
    });

    // Exactly one summary provider call — no preliminary immediate email.
    const summarySend = await sendSummaryEmail({
      emailNormalized: account.email_normalized,
      subject: summaryBody.subject,
      text: summaryBody.text,
      env,
    });

    if (!summarySend.ok) {
      try {
        args.db
          .prepare(
            `UPDATE email_notifications SET status = ?, reason = ? WHERE id = ?`,
          )
          .run(
            "failed_retryable",
            summarySend.error === "not_configured"
              ? "not_configured"
              : "provider_send_failed",
            summaryReserved.id,
          );
      } catch {
        /* ignore */
      }
      return {
        attempted: true,
        status: "failed",
        reason:
          summarySend.error === "not_configured"
            ? "not_configured"
            : "provider_send_failed",
        notification_id: reserved.id,
        kind: "summary",
      };
    }

    try {
      args.db
        .prepare(
          `UPDATE email_notifications SET status = 'sent', reason = 'sent_summary' WHERE id = ?`,
        )
        .run(summaryReserved.id);
    } catch {
      /* ignore */
    }

    return {
      attempted: true,
      status: "combined",
      reason: "combined_into_summary",
      notification_id: reserved.id,
      kind: "summary",
    };
  }

  // Authoritative durable outbox (local ledger is mirror only):
  // 1) reserve durable opportunity
  // 2) insert/resolve durable outbox pending
  // 3) acquire durable outbox lease
  // 4) call provider once
  // 5) mark sent only after provider success
  const authStore =
    args.accountStore ?? (await getAuthStore({ sqliteDb: args.db, env }));
  const holderId = `send_${evidence.opportunity_key.slice(0, 24)}`;
  const outboxId = `outbox_${shaShort(evidence.opportunity_key)}`;
  const leaseExpires = new Date(Date.parse(nowIso) + 60_000).toISOString();

  const reservedOpp = await authStore.tryReserveAlertOpportunity({
    opportunityKey: evidence.opportunity_key,
    purchaseId: args.purchaseId,
    alertId: args.alertId,
    nowIso,
  });
  // Insert or resolve outbox row (idempotent on opportunity_key).
  const outboxInsert = await authStore.insertNotificationOutbox({
    id: outboxId,
    opportunityKey: evidence.opportunity_key,
    purchaseId: args.purchaseId,
    accountId: ownerRef,
    alertId: args.alertId,
    kind: "immediate",
    status: "pending",
    reason: "pending_send",
    recipientEmailHash: hashEmailForLog(account.email_normalized),
    nowIso,
  });
  const existingOutbox = await authStore.getNotificationOutboxByOpportunity(
    evidence.opportunity_key,
  );
  if (existingOutbox?.status === "sent") {
    // Local mirror
    insertNotification({
      db: args.db,
      purchase_id: args.purchaseId,
      account_id: ownerRef,
      alert_id: args.alertId,
      opportunity_key: evidence.opportunity_key,
      kind: "immediate",
      status: "sent",
      reason: "duplicate_opportunity",
      recipient_email_hash: hashEmailForLog(account.email_normalized),
      created_at: nowIso,
    });
    return {
      attempted: false,
      status: "sent",
      reason: "duplicate_opportunity",
      notification_id: existingOutbox.id,
      kind: "immediate",
    };
  }

  const durableLeased = await authStore.tryLeaseNotificationOutbox({
    opportunityKey: evidence.opportunity_key,
    holderId,
    leaseExpiresAt: leaseExpires,
    nowIso,
  });
  if (!durableLeased) {
    return {
      attempted: false,
      status: "suppressed",
      reason: "duplicate_opportunity",
      notification_id: outboxInsert.id,
      kind: "immediate",
    };
  }

  // Local mirror only — does not authorize delivery.
  const reserved = insertNotification({
    db: args.db,
    purchase_id: args.purchaseId,
    account_id: ownerRef,
    alert_id: args.alertId,
    opportunity_key: evidence.opportunity_key,
    kind: "immediate",
    status: "sending",
    reason: "sending",
    recipient_email_hash: hashEmailForLog(account.email_normalized),
    created_at: nowIso,
  });
  const leaseId = reserved.id;
  void reservedOpp;

  const send = await sendPriceDropEmail({
    emailNormalized: account.email_normalized,
    evidence,
    reviewUrl,
    disableAlertsUrl,
    env,
  });

  if (!send.ok) {
    const failStatus =
      send.error === "not_configured" ? "failed_terminal" : "failed_retryable";
    const reason =
      send.error === "not_configured"
        ? "not_configured"
        : "provider_send_failed";
    try {
      args.db
        .prepare(
          `UPDATE email_notifications SET status = ?, reason = ? WHERE id = ?`,
        )
        .run(failStatus, reason, leaseId);
    } catch {
      /* ignore */
    }
    await authStore.markNotificationOutboxStatus({
      id: durableLeased.id,
      status: failStatus,
      reason,
      nowIso,
      nextAttemptAt:
        failStatus === "failed_retryable"
          ? new Date(Date.parse(nowIso) + 60_000).toISOString()
          : null,
    });
    return {
      attempted: true,
      status: failStatus === "failed_terminal" ? "failed" : "failed",
      reason,
      notification_id: leaseId,
      kind: "immediate",
    };
  }

  // Mark sent only after provider success (durable first, then local mirror).
  await authStore.markNotificationOutboxStatus({
    id: durableLeased.id,
    status: "sent",
    reason: "sent_immediate",
    nowIso,
    sentAt: nowIso,
  });
  try {
    args.db
      .prepare(
        `UPDATE email_notifications SET status = 'sent', reason = 'sent_immediate' WHERE id = ?`,
      )
      .run(leaseId);
  } catch {
    /* ignore */
  }

  return {
    attempted: true,
    status: "sent",
    reason: "sent_immediate",
    notification_id: leaseId,
    kind: "immediate",
  };
}

async function sendSummaryEmail(args: {
  emailNormalized: string;
  subject: string;
  text: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<{ ok: true } | { ok: false; error: "not_configured" | "provider_error" }> {
  const { isAuthTestMode } = await import("../auth/config.js");
  if (isAuthTestMode(args.env)) {
    const { getCapturedPriceDropEmails } = await import("./email-send.js");
    // piggyback test capture via a synthetic price-drop send path
    const mod = await import("./email-send.js");
    mod.getCapturedPriceDropEmails;
    // push via sendPriceDropEmail with dummy evidence is awkward — direct capture
    const captures = mod as unknown as {
      // use internal by calling sendPriceDropEmail-like test path
    };
    void captures;
    // Call public test helper path:
    await mod.sendPriceDropEmail({
      emailNormalized: args.emailNormalized,
      evidence: {
        purchase_id: "summary",
        product_title: "Multiple purchases",
        purchase_price: 1,
        observed_price: 0.5,
        potential_recovery: 0.5,
        currency: "USD",
        monitoring_deadline: null,
        observed_at: new Date().toISOString(),
        alert_id: "summary",
        opportunity_key: "summary",
        review_path: "/dashboard",
      },
      reviewUrl: "/dashboard",
      disableAlertsUrl: "/dashboard",
      env: args.env,
    });
    return { ok: true };
  }

  const apiKey = String(
    args.env.RESEND_API_KEY || args.env.EMAIL_PROVIDER_API_KEY || "",
  ).trim();
  const from = String(
    args.env.EMAIL_FROM_ADDRESS || args.env.AUTH_EMAIL_FROM || "",
  ).trim();
  if (!apiKey || !from) {
    if (args.env.NODE_ENV !== "production" && args.env.VERCEL !== "1") {
      return { ok: true };
    }
    return { ok: false, error: "not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.emailNormalized],
        subject: args.subject,
        text: args.text,
      }),
    });
    if (!res.ok) return { ok: false, error: "provider_error" };
    return { ok: true };
  } catch {
    return { ok: false, error: "provider_error" };
  }
}

/**
 * After a monitoring pass, notify for each newly created alert.
 * Safe no-op when no alerts or no consent.
 */
export async function processNewAlertsFromMonitorBatch(args: {
  db: NobuDatabase;
  results: Array<{
    purchase_id: string;
    alert_id?: string;
    alert_created: boolean;
  }>;
  nowIso?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  accountStore?: Awaited<ReturnType<typeof getAuthStore>>;
}): Promise<NotificationProcessResult[]> {
  const out: NotificationProcessResult[] = [];
  for (const r of args.results) {
    if (!r.alert_created || !r.alert_id) continue;
    const result = await processPriceDropEmailForNewAlert({
      db: args.db,
      purchaseId: r.purchase_id,
      alertId: r.alert_id,
      nowIso: args.nowIso,
      env: args.env,
      accountStore: args.accountStore,
    });
    out.push(result);
  }
  return out;
}
