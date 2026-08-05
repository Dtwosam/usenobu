/**
 * Lane 7.3B — consented price-drop email notification types.
 * Matching/policy/alert eligibility remain outside this module (deterministic, fail closed).
 */

export type EmailNotificationKind = "immediate" | "summary";

export type EmailNotificationStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed_retryable"
  | "failed_terminal"
  | "suppressed"
  | "combined"
  | "failed";

/** Non-sensitive reasons only — never full email addresses. */
export type EmailNotificationReason =
  | "sent_immediate"
  | "sent_summary"
  | "no_consent"
  | "consent_disabled"
  | "not_account_owned"
  | "account_unverified"
  | "missing_verified_email"
  | "duplicate_opportunity"
  | "purchase_cooldown"
  | "account_immediate_cap"
  | "summary_cooldown"
  | "alert_not_new"
  | "missing_alert_evidence"
  | "missing_purchase_evidence"
  | "provider_send_failed"
  | "not_configured"
  | "combined_into_summary";

export interface PurchaseEmailAlertPref {
  purchase_id: string;
  account_id: string;
  enabled: boolean;
  consent_at: string | null;
  disabled_at: string | null;
  updated_at: string;
}

export interface EmailNotificationRecord {
  id: string;
  purchase_id: string;
  account_id: string;
  alert_id: string | null;
  opportunity_key: string;
  kind: EmailNotificationKind;
  status: EmailNotificationStatus;
  reason: EmailNotificationReason | string;
  initiated_by: "nobu";
  recipient_email_hash: string | null;
  created_at: string;
}

export interface PriceDropEmailEvidence {
  purchase_id: string;
  product_title: string;
  purchase_price: number;
  observed_price: number;
  potential_recovery: number;
  currency: string;
  monitoring_deadline: string | null;
  observed_at: string;
  alert_id: string;
  opportunity_key: string;
  review_path: string;
}

export interface NotificationProcessResult {
  attempted: boolean;
  status: EmailNotificationStatus | "skipped";
  reason: EmailNotificationReason | string;
  notification_id?: string;
  kind?: EmailNotificationKind;
}
