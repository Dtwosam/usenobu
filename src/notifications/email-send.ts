/**
 * Price-drop email delivery via Resend.
 * Resend is only the delivery provider — Nobu prepares content and initiates.
 */
import { isAuthTestMode } from "../auth/config.js";
import { hashEmailForLog } from "./mask-email.js";
import {
  DISABLE_ALERTS_LABEL,
  PRICE_DROP_EMAIL_DISCLOSURE,
  PRICE_DROP_EMAIL_OPENING,
  PRICE_DROP_EMAIL_PRIMARY_CTA,
  PRICE_DROP_EMAIL_SUBJECT,
} from "./copy.js";
import type { PriceDropEmailEvidence } from "./types.js";

export type CapturedPriceDropEmail = {
  toHash: string;
  subject: string;
  text: string;
  purchase_id: string;
  alert_id: string;
  at: string;
};

const testCaptures: CapturedPriceDropEmail[] = [];

export function clearCapturedPriceDropEmails(): void {
  testCaptures.length = 0;
}

export function getCapturedPriceDropEmails(): readonly CapturedPriceDropEmail[] {
  return testCaptures;
}

export function peekLastPriceDropEmail(): CapturedPriceDropEmail | null {
  return testCaptures[testCaptures.length - 1] ?? null;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function buildPriceDropEmailText(args: {
  evidence: PriceDropEmailEvidence;
  reviewUrl: string;
  disableAlertsUrl: string;
}): { subject: string; text: string } {
  const e = args.evidence;
  const remaining = e.monitoring_deadline
    ? `Monitoring window through ${e.monitoring_deadline}`
    : "Monitoring window still open";

  const text = [
    PRICE_DROP_EMAIL_OPENING,
    "",
    `Product: ${e.product_title}`,
    `Price paid: ${formatUsd(e.purchase_price)}`,
    `Latest reliable observed price: ${formatUsd(e.observed_price)}`,
    `Possible difference: ${formatUsd(e.potential_recovery)}`,
    remaining,
    `Observed at: ${e.observed_at}`,
    "",
    PRICE_DROP_EMAIL_DISCLOSURE,
    "",
    `${PRICE_DROP_EMAIL_PRIMARY_CTA}:`,
    args.reviewUrl,
    "",
    `${DISABLE_ALERTS_LABEL}:`,
    args.disableAlertsUrl,
    "",
    "— Nobu",
  ].join("\n");

  return { subject: PRICE_DROP_EMAIL_SUBJECT, text };
}

export type SendPriceDropEmailResult =
  | { ok: true; mode: "test" | "resend" | "dev_log" }
  | { ok: false; error: "not_configured" | "provider_error" };

export async function sendPriceDropEmail(args: {
  emailNormalized: string;
  evidence: PriceDropEmailEvidence;
  reviewUrl: string;
  disableAlertsUrl: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Deterministic provider key (typically opportunity_key). */
  idempotencyKey?: string;
}): Promise<SendPriceDropEmailResult> {
  const env = args.env ?? process.env;
  const built = buildPriceDropEmailText({
    evidence: args.evidence,
    reviewUrl: args.reviewUrl,
    disableAlertsUrl: args.disableAlertsUrl,
  });

  if (isAuthTestMode(env)) {
    testCaptures.push({
      toHash: hashEmailForLog(args.emailNormalized),
      subject: built.subject,
      text: built.text,
      purchase_id: args.evidence.purchase_id,
      alert_id: args.evidence.alert_id,
      at: new Date().toISOString(),
    });
    return { ok: true, mode: "test" };
  }

  const apiKey = String(
    env.RESEND_API_KEY || env.EMAIL_PROVIDER_API_KEY || "",
  ).trim();
  const from = String(
    env.EMAIL_FROM_ADDRESS || env.AUTH_EMAIL_FROM || "",
  ).trim();

  if (!apiKey || !from) {
    if (env.NODE_ENV !== "production" && env.VERCEL !== "1") {
      console.info("nobu_price_drop_email_dev", {
        email_hash: hashEmailForLog(args.emailNormalized),
        purchase_id: args.evidence.purchase_id,
      });
      testCaptures.push({
        toHash: hashEmailForLog(args.emailNormalized),
        subject: built.subject,
        text: built.text,
        purchase_id: args.evidence.purchase_id,
        alert_id: args.evidence.alert_id,
        at: new Date().toISOString(),
      });
      return { ok: true, mode: "dev_log" };
    }
    return { ok: false, error: "not_configured" };
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    const idem =
      args.idempotencyKey?.trim() || args.evidence.opportunity_key?.trim();
    if (idem) {
      headers["Idempotency-Key"] = idem.slice(0, 256);
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [args.emailNormalized],
        subject: built.subject,
        text: built.text,
      }),
    });
    if (!res.ok) {
      console.error("nobu_price_drop_email_provider_error", {
        status: res.status,
      });
      return { ok: false, error: "provider_error" };
    }
    return { ok: true, mode: "resend" };
  } catch (err) {
    console.error("nobu_price_drop_email_send_failed", {
      message: err instanceof Error ? err.message : "send_failed",
    });
    return { ok: false, error: "provider_error" };
  }
}

export function buildSummaryEmailText(args: {
  items: Array<{
    product_title: string;
    potential_recovery: number;
    reviewUrl: string;
  }>;
}): { subject: string; text: string } {
  const lines = [
    "Nobu found possible price drops on more than one of your purchases.",
    "",
    "Target must verify each current price and makes the final decision.",
    "These are possible price-adjustment opportunities, not guaranteed refunds.",
    "",
  ];
  for (const item of args.items) {
    lines.push(
      `• ${item.product_title} — possible difference ${formatUsd(item.potential_recovery)}`,
    );
    lines.push(`  Review: ${item.reviewUrl}`);
    lines.push("");
  }
  lines.push("— Nobu");
  return {
    subject: "Nobu found possible price drops on your purchases",
    text: lines.join("\n"),
  };
}

/**
 * Send a summary using the actual summary subject/body (not the single price-drop template).
 */
export async function sendSummaryEmailDirect(args: {
  emailNormalized: string;
  subject: string;
  text: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  idempotencyKey?: string;
}): Promise<SendPriceDropEmailResult> {
  const env = args.env ?? process.env;

  if (isAuthTestMode(env)) {
    testCaptures.push({
      toHash: hashEmailForLog(args.emailNormalized),
      subject: args.subject,
      text: args.text,
      purchase_id: "summary",
      alert_id: "summary",
      at: new Date().toISOString(),
    });
    return { ok: true, mode: "test" };
  }

  const apiKey = String(
    env.RESEND_API_KEY || env.EMAIL_PROVIDER_API_KEY || "",
  ).trim();
  const from = String(
    env.EMAIL_FROM_ADDRESS || env.AUTH_EMAIL_FROM || "",
  ).trim();

  if (!apiKey || !from) {
    if (env.NODE_ENV !== "production" && env.VERCEL !== "1") {
      testCaptures.push({
        toHash: hashEmailForLog(args.emailNormalized),
        subject: args.subject,
        text: args.text,
        purchase_id: "summary",
        alert_id: "summary",
        at: new Date().toISOString(),
      });
      return { ok: true, mode: "dev_log" };
    }
    return { ok: false, error: "not_configured" };
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (args.idempotencyKey) {
      headers["Idempotency-Key"] = args.idempotencyKey.slice(0, 256);
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [args.emailNormalized],
        subject: args.subject,
        text: args.text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: "provider_error" };
    }
    return { ok: true, mode: "resend" };
  } catch {
    return { ok: false, error: "provider_error" };
  }
}
