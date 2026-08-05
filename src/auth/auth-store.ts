/**
 * Durable auth store interface + Postgres / SQLite adapters.
 *
 * Production: PostgreSQL via DATABASE_URL or POLICY_OPS_DATABASE_URL.
 * Tests/local without Postgres: SQLite web DB (not cookie snapshot).
 */
import pg from "pg";
import type { NobuDatabase } from "../db/index.js";
import {
  AUTH_DURABLE_SCHEMA_PATCHES,
  AUTH_DURABLE_SCHEMA_SQL,
} from "./durable-schema.js";
import {
  ACCOUNT_ID_RE,
  AUTH_LOGIN_TOKEN_TTL_MS,
  AUTH_RATE_LIMIT_MAX,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_SESSION_MAX_AGE_SECONDS,
  isAuthTestMode,
} from "./config.js";
import { newId, sha256Hex } from "./crypto.js";

const { Pool } = pg;

/**
 * True for a UNIQUE-constraint conflict (SQLite message shape or Postgres
 * error code 23505). Used by recordSettledPaymentAndActivation to treat a
 * concurrent settlement race as "someone else already recorded this" rather
 * than a hard failure — the post-transaction read then resolves the true
 * outcome from durable state.
 */
function isUniqueViolationError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string } | null;
  if (!anyErr) return false;
  if (anyErr.code === "23505") return true;
  return typeof anyErr.message === "string" && /UNIQUE constraint failed/i.test(anyErr.message);
}

export type AccountRow = {
  id: string;
  email_normalized: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LoginTokenRow = {
  id: string;
  email_normalized: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  guest_owner_ref: string | null;
};

export type SessionRow = {
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string;
};

export type AgentConnectionRow = {
  id: string;
  account_id: string | null;
  email_normalized: string;
  connection_token_hash: string | null;
  credential_expires_at: string | null;
  credential_rotated_at: string | null;
  status: string;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

export type AgentEmailCodeRow = {
  id: string;
  connection_id: string;
  email_normalized: string;
  code_hash: string;
  expires_at: string;
  attempt_count: number;
  used_at: string | null;
  created_at: string;
};

export type DiscoverySessionRow = {
  id: string;
  structured_snapshot_json: string;
  purchase_text_hash: string | null;
  candidates_snapshot_json: string | null;
  selected_candidate_id: string | null;
  locked_fingerprint_snapshot_json: string | null;
  status: string;
  materialized_purchase_id: string | null;
  created_at: string;
  expires_at: string;
};

export type MonitoringEnrollmentQuoteRow = {
  id: string;
  connection_id: string;
  account_id: string;
  purchase_id: string;
  fingerprint_id: string;
  price_amount: number;
  price_currency: string;
  settlement_asset: string | null;
  settlement_network: string | null;
  monitoring_deadline: string | null;
  consent_monitoring_at: string;
  consent_email_alerts_at: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export type PaymentAttemptRow = {
  id: string;
  quote_id: string;
  x402_challenge_ref: string | null;
  status: string;
  settlement_ref: string | null;
  created_at: string;
  settled_at: string | null;
};

export type MonitorActivationRow = {
  id: string;
  quote_id: string;
  activation_key: string;
  payment_attempt_id: string;
  purchase_id: string;
  fingerprint_id: string;
  monitor_id: string;
  status: string;
  created_at: string;
  projected_at: string | null;
  /** Lane 8R.3B — set when a Monitoring Pass authorized this activation. */
  monitoring_pass_id?: string | null;
};

/** Durable Monitoring Pass payment lifecycle states. */
export type MonitoringPassPaymentStatus =
  | "authorization_received"
  | "verifying"
  | "settlement_pending"
  | "settlement_unknown"
  | "settlement_review_required"
  | "settled"
  | "rejected"
  | "failed";

/** Lane 8R.3B — an in-flight or completed Monitoring Pass payment. */
export type MonitoringPassPaymentRow = {
  id: string;
  authorization_digest: string;
  status: string;
  settlement_ref: string | null;
  payer_address?: string | null;
  sanitized_verify_reason?: string | null;
  sanitized_settle_reason?: string | null;
  last_provider_operation?: string | null;
  attempt_count?: number | null;
  /** Opaque facilitator payment id (not Nobu payment.id). */
  provider_payment_id?: string | null;
  /** Opaque facilitator authorization id (not authorization_digest). */
  provider_authorization_id?: string | null;
  created_at: string;
  updated_at: string;
};

/** Lane 8R.3B — one issued Monitoring Pass. */
export type MonitoringPassRow = {
  id: string;
  pass_token_hash: string;
  settlement_ref: string;
  payment_id: string;
  price_amount: number;
  price_currency: string;
  status: string;
  payer_address?: string | null;
  redeemed_at: string | null;
  redeemed_quote_id: string | null;
  redeemed_purchase_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Customer-safe handoff after paid settlement. High-entropy id is not a
 * redemption credential — redemption still requires connection + quote.
 * claim_credential_hash binds a single-use secret returned only to the paid caller.
 */
export type MonitoringPassContinuationRow = {
  id: string;
  payment_id: string;
  monitoring_pass_id: string | null;
  status: string;
  claim_credential_hash?: string | null;
  claim_credential_consumed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type DurableMonitorScheduleRow = {
  purchase_id: string;
  activation_id: string | null;
  account_id: string | null;
  status: string;
  next_check_at: string | null;
  last_checked_at: string | null;
  provider_backoff_until: string | null;
  last_skip_reason: string | null;
  hydration_blocker_json: string | null;
  created_at: string;
  updated_at: string;
};

export type DurableNotificationOutboxRow = {
  id: string;
  opportunity_key: string;
  purchase_id: string;
  account_id: string;
  alert_id: string | null;
  kind: string;
  status: string;
  reason: string | null;
  attempt_count: number;
  lease_holder: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string | null;
  recipient_email_hash: string | null;
  evidence_json?: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};

export type MarketplacePurchaseJourneyRow = {
  id: string;
  monitoring_pass_id: string;
  pass_continuation_id: string | null;
  stage: string;
  /** Structured purchase fields after extract; used for product discovery resume. */
  purchase_snapshot_json: string | null;
  discovery_session_id: string | null;
  fingerprint_id: string | null;
  connection_id: string | null;
  quote_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseBlobRow = {
  purchase_id: string;
  account_id: string;
  blob_json: string;
  updated_at: string;
  archived_at: string | null;
  user_outcome: string | null;
  user_outcome_at: string | null;
  /** Lane 7.3B — purchase-level email alert consent (0/1). */
  email_alerts_enabled?: number | null;
  email_alerts_consent_at?: string | null;
  email_alerts_disabled_at?: string | null;
};

export interface AuthStore {
  kind: "postgres" | "sqlite";
  ensureSchema(): Promise<void>;
  getAccountById(id: string): Promise<AccountRow | null>;
  getAccountByEmail(emailNormalized: string): Promise<AccountRow | null>;
  upsertAccountForEmail(
    emailNormalized: string,
    nowIso: string,
  ): Promise<AccountRow>;
  markAccountVerified(accountId: string, nowIso: string): Promise<void>;
  insertLoginToken(args: {
    emailNormalized: string;
    rawToken: string;
    guestOwnerRef: string | null;
    now?: Date;
    ttlMs?: number;
  }): Promise<LoginTokenRow>;
  /** Peek only — never marks used (safe for GET preview). */
  findLoginTokenByHash(tokenHash: string): Promise<LoginTokenRow | null>;
  /** Atomic one-time consume. Returns false if already used/missing. */
  markLoginTokenUsed(tokenId: string, nowIso: string): Promise<boolean>;
  createSession(args: {
    accountId: string;
    rawSessionToken: string;
    now?: Date;
    maxAgeSeconds?: number;
  }): Promise<SessionRow>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null>;
  revokeSession(sessionId: string, nowIso: string): Promise<void>;
  touchSession(sessionId: string, nowIso: string): Promise<void>;
  consumeRateLimit(args: {
    bucketKey: string;
    now?: Date;
    windowMs?: number;
    maxHits?: number;
  }): Promise<boolean>;
  recordClaimEvent(args: {
    accountId: string;
    guestOwnerRef: string;
    purchasesClaimed: number;
    nowIso: string;
  }): Promise<{ already: boolean; claimed: number }>;
  savePurchaseBlob(args: {
    accountId: string;
    purchaseId: string;
    blobJson: string;
    nowIso: string;
    /** Preserve existing lifecycle meta unless provided */
    archived_at?: string | null;
    user_outcome?: string | null;
    user_outcome_at?: string | null;
  }): Promise<void>;
  listPurchaseBlobs(accountId: string): Promise<PurchaseBlobRow[]>;
  getPurchaseBlob(
    accountId: string,
    purchaseId: string,
  ): Promise<PurchaseBlobRow | null>;
  updatePurchaseLifecycleMeta(args: {
    accountId: string;
    purchaseId: string;
    archived_at?: string | null;
    user_outcome?: string | null;
    user_outcome_at?: string | null;
    email_alerts_enabled?: number | null;
    email_alerts_consent_at?: string | null;
    email_alerts_disabled_at?: string | null;
    nowIso: string;
  }): Promise<boolean>;
  deletePurchaseBlob(args: {
    accountId: string;
    purchaseId: string;
  }): Promise<boolean>;

  // --- Lane 7.4B: agent connections + conversational email verification ---
  insertAgentConnection(args: {
    emailNormalized: string;
    now?: Date;
  }): Promise<AgentConnectionRow>;
  getAgentConnectionById(id: string): Promise<AgentConnectionRow | null>;
  /** Activation and rotation are the same primitive: replace the credential. */
  setAgentConnectionCredential(args: {
    connectionId: string;
    tokenHash: string;
    expiresAt: string;
    nowIso: string;
    accountId?: string;
  }): Promise<boolean>;
  revokeAgentConnection(args: {
    connectionId: string;
    nowIso: string;
  }): Promise<boolean>;
  touchAgentConnectionLastUsed(args: {
    connectionId: string;
    nowIso: string;
  }): Promise<void>;
  insertAgentEmailCode(args: {
    connectionId: string;
    emailNormalized: string;
    rawCode: string;
    now?: Date;
    ttlMs?: number;
  }): Promise<AgentEmailCodeRow>;
  /** Latest not-yet-used challenge for a connection (may be expired/attempt-exhausted). */
  findLatestAgentEmailCode(
    connectionId: string,
  ): Promise<AgentEmailCodeRow | null>;
  /** Atomic one-time consume. Returns false if already used/missing. */
  markAgentEmailCodeUsed(codeId: string, nowIso: string): Promise<boolean>;
  /** Returns the attempt count after incrementing. */
  incrementAgentEmailCodeAttempt(codeId: string): Promise<number>;

  // --- Lane 7.4C: discovery sessions + monitoring enrollment quotes ---
  insertDiscoverySession(args: {
    structuredSnapshotJson: string;
    purchaseTextHash: string | null;
    candidatesSnapshotJson: string;
    now?: Date;
    ttlMs?: number;
  }): Promise<DiscoverySessionRow>;
  getDiscoverySessionById(id: string): Promise<DiscoverySessionRow | null>;
  /** Atomic: only succeeds from 'discovering' or 'confirmed'. */
  confirmDiscoverySession(args: {
    sessionId: string;
    selectedCandidateId: string;
    lockedFingerprintSnapshotJson: string;
  }): Promise<boolean>;
  /** Atomic reservation: only succeeds from 'confirmed'. First caller wins. */
  reserveDiscoverySessionMaterialization(args: {
    sessionId: string;
    purchaseId: string;
  }): Promise<boolean>;

  insertMonitoringEnrollmentQuote(args: {
    connectionId: string;
    accountId: string;
    purchaseId: string;
    fingerprintId: string;
    priceAmount: number;
    priceCurrency: string;
    monitoringDeadline: string | null;
    consentMonitoringAt: string;
    consentEmailAlertsAt: string;
    now?: Date;
    ttlMs?: number;
  }): Promise<MonitoringEnrollmentQuoteRow>;
  /** Active (status='issued', unexpired as of nowIso) quote for a purchase, if any. */
  getActiveMonitoringEnrollmentQuote(
    purchaseId: string,
    nowIso: string,
  ): Promise<MonitoringEnrollmentQuoteRow | null>;
  getMonitoringEnrollmentQuoteById(
    quoteId: string,
  ): Promise<MonitoringEnrollmentQuoteRow | null>;

  // --- Lane 7.4D: payment attempts + monitor activations ---
  /** Reuses the latest non-terminal challenge for a quote when present. */
  getLatestPaymentAttemptForQuote(
    quoteId: string,
  ): Promise<PaymentAttemptRow | null>;
  insertPaymentAttempt(args: {
    quoteId: string;
    challengeRef: string;
    now?: Date;
  }): Promise<PaymentAttemptRow>;
  /**
   * Lane 8R.0 — store opaque pending settlement tx hash only.
   * status becomes 'verifying' (awaiting official settle/status).
   */
  markPaymentAttemptVerifying(args: {
    attemptId: string;
    settlementRef: string;
    nowIso: string;
  }): Promise<boolean>;
  getMonitorActivationByQuoteId(
    quoteId: string,
  ): Promise<MonitorActivationRow | null>;
  /** Active activation for a purchase, if any. */
  getActiveMonitorActivationByPurchaseId(
    purchaseId: string,
  ): Promise<MonitorActivationRow | null>;
  /**
   * The Lane 7.4D durable saga step 1 — one atomic transaction within this
   * store only (never spans the separate purchases database): marks the
   * payment attempt settled, consumes the quote (only if still 'issued'),
   * and inserts exactly one monitor_activations row (status
   * 'pending_projection'). Idempotent: a concurrent/duplicate call that
   * loses the race returns the winner's existing row rather than erroring.
   */
  recordSettledPaymentAndActivation(args: {
    paymentAttemptId: string;
    quoteId: string;
    settlementRef: string;
    activationId: string;
    activationKey: string;
    purchaseId: string;
    fingerprintId: string;
    nowIso: string;
  }): Promise<
    | { outcome: "recorded" | "already_existed"; activation: MonitorActivationRow }
    | { outcome: "quote_not_issued" }
  >;
  /** Idempotent — only transitions pending_projection -> active. */
  markMonitorActivationActive(args: {
    activationId: string;
    nowIso: string;
  }): Promise<boolean>;
  /** For reconciliation — every activation still awaiting projection. */
  listPendingProjectionActivations(): Promise<MonitorActivationRow[]>;

  // --- Lane 8R.3B: Nobu Monitoring Pass ---
  /**
   * Resolves an in-flight or completed payment by the sha256 digest of the
   * replayed authorization header. The raw header is never stored — the
   * digest exists only so a repeated replay of the same signed payment
   * resolves to the same record instead of settling twice.
   */
  getMonitoringPassPaymentByDigest(
    authorizationDigest: string,
  ): Promise<MonitoringPassPaymentRow | null>;
  /** Load one payment by durable id (continuation-targeted reconcile). */
  getMonitoringPassPaymentById(
    paymentId: string,
  ): Promise<MonitoringPassPaymentRow | null>;
  /** Insert-or-return: a concurrent duplicate returns the winner's row. */
  upsertMonitoringPassPayment(args: {
    id: string;
    authorizationDigest: string;
    nowIso: string;
    status?: MonitoringPassPaymentStatus;
  }): Promise<MonitoringPassPaymentRow>;
  updateMonitoringPassPayment(args: {
    id: string;
    status: MonitoringPassPaymentStatus;
    settlementRef: string | null;
    nowIso: string;
    payerAddress?: string | null;
    sanitizedVerifyReason?: string | null;
    sanitizedSettleReason?: string | null;
    lastProviderOperation?: string | null;
    incrementAttempt?: boolean;
    /** Opaque facilitator payment id — sanitized, max ~200 chars. */
    providerPaymentId?: string | null;
    /** Opaque facilitator authorization id — sanitized, max ~200 chars. */
    providerAuthorizationId?: string | null;
  }): Promise<boolean>;
  /**
   * Payments still awaiting official settle/status confirmation. Each row
   * already holds an opaque settlement_ref (pending tx hash). Reconciliation
   * polls that reference only — never re-verifies a signed payment header.
   */
  listVerifyingMonitoringPassPayments(): Promise<MonitoringPassPaymentRow[]>;
  /**
   * Pending, unknown, or settled-without-pass payments for reconciliation.
   */
  listReconcileableMonitoringPassPayments(): Promise<MonitoringPassPaymentRow[]>;
  /**
   * Settled payments that never received a Monitoring Pass (crash between
   * mark-settled and issue). Recovery issues from the stored settlement_ref
   * alone — no second charge, no signed-header replay.
   */
  listSettledMonitoringPassPaymentsWithoutPass(): Promise<
    MonitoringPassPaymentRow[]
  >;
  getMonitoringPassBySettlementRef(
    settlementRef: string,
  ): Promise<MonitoringPassRow | null>;
  getMonitoringPassById(passId: string): Promise<MonitoringPassRow | null>;
  /**
   * Exactly one pass per verified settlement (UNIQUE settlement_ref). A
   * duplicate or concurrent replay of the same settlement returns the
   * existing pass rather than issuing a second one.
   */
  issueMonitoringPass(args: {
    id: string;
    passTokenHash: string;
    settlementRef: string;
    paymentId: string;
    priceAmount: number;
    priceCurrency: string;
    nowIso: string;
    payerAddress?: string | null;
  }): Promise<{
    outcome: "issued" | "already_existed";
    pass: MonitoringPassRow;
  }>;
  /**
   * Ensure exactly one continuation row per payment. Concurrent callers share
   * the winner. Optionally links an already-issued pass (reconciliation /
   * historical backfill). claimCredentialHash is stored only when first created.
   */
  ensureMonitoringPassContinuation(args: {
    id: string;
    paymentId: string;
    monitoringPassId?: string | null;
    status?: "pending" | "issued" | "claimed";
    claimCredentialHash?: string | null;
    nowIso: string;
  }): Promise<MonitoringPassContinuationRow>;
  markMonitoringPassContinuationIssued(args: {
    paymentId: string;
    monitoringPassId: string;
    nowIso: string;
  }): Promise<MonitoringPassContinuationRow | null>;
  /**
   * Consume single-use claim credential. Returns false if missing/used/wrong.
   * Does not authorize redemption — only journey claim after paid handoff.
   */
  consumeContinuationClaimCredential(args: {
    continuationId: string;
    claimCredentialHash: string;
    nowIso: string;
  }): Promise<boolean>;
  /**
   * Atomic: validate claim hash → create/resolve journey → mark claim consumed
   * and link journey. Crash-safe: claim is never consumed without a journey.
   */
  claimPassAndCreateJourney(args: {
    continuationId: string;
    claimCredentialHash: string;
    journeyId: string;
    monitoringPassId: string;
    nowIso: string;
  }): Promise<
    | {
        outcome: "created" | "already_existed";
        journey: MarketplacePurchaseJourneyRow;
      }
    | { outcome: "claim_invalid" }
    | { outcome: "pass_mismatch" }
  >;
  getMonitoringPassContinuationById(
    id: string,
  ): Promise<MonitoringPassContinuationRow | null>;
  getMonitoringPassContinuationByPaymentId(
    paymentId: string,
  ): Promise<MonitoringPassContinuationRow | null>;
  getMonitoringPassContinuationByPassId(
    passId: string,
  ): Promise<MonitoringPassContinuationRow | null>;
  getMonitoringPassByPaymentId(
    paymentId: string,
  ): Promise<MonitoringPassRow | null>;
  ensureMarketplacePurchaseJourney(args: {
    id: string;
    monitoringPassId: string;
    passContinuationId?: string | null;
    nowIso: string;
  }): Promise<MarketplacePurchaseJourneyRow>;
  getMarketplacePurchaseJourneyById(
    id: string,
  ): Promise<MarketplacePurchaseJourneyRow | null>;
  getMarketplacePurchaseJourneyByPassId(
    passId: string,
  ): Promise<MarketplacePurchaseJourneyRow | null>;
  updateMarketplacePurchaseJourney(args: {
    id: string;
    stage: string;
    purchaseSnapshotJson?: string | null;
    discoverySessionId?: string | null;
    fingerprintId?: string | null;
    connectionId?: string | null;
    quoteId?: string | null;
    nowIso: string;
  }): Promise<MarketplacePurchaseJourneyRow | null>;
  /**
   * Settled payments that have a pass but no continuation row (historical
   * recovery before handoff existed).
   */
  listSettledPassPaymentsMissingContinuation(): Promise<
    MonitoringPassPaymentRow[]
  >;
  /**
   * Atomically expire all currently-issued quotes for a purchase, then insert
   * a fresh issued quote. Guarantees the partial unique index only ever sees
   * one usable issued row.
   */
  replaceIssuedEnrollmentQuote(args: {
    id: string;
    connectionId: string;
    accountId: string;
    purchaseId: string;
    fingerprintId: string;
    priceAmount: number;
    priceCurrency: string;
    settlementAsset: string | null;
    settlementNetwork: string | null;
    monitoringDeadline: string | null;
    consentMonitoringAt: string;
    consentEmailAlertsAt: string;
    expiresAt: string;
    nowIso: string;
  }): Promise<{
    outcome: "issued" | "existing_unexpired";
    quote: MonitoringEnrollmentQuoteRow;
    supersededIds: string[];
  }>;
  expireIssuedEnrollmentQuotesForPurchase(args: {
    purchaseId: string;
    nowIso: string;
    exceptQuoteId?: string;
  }): Promise<number>;
  /**
   * One atomic transaction inside this store: consume the pass (only if
   * still 'issued'), consume the quote (only if still 'issued'), and insert
   * exactly one monitor_activations row. Any failure leaves the pass
   * unconsumed. Mirrors recordSettledPaymentAndActivation's race handling.
   */
  redeemMonitoringPassAndActivate(args: {
    passId: string;
    quoteId: string;
    activationId: string;
    activationKey: string;
    purchaseId: string;
    fingerprintId: string;
    nowIso: string;
  }): Promise<
    | { outcome: "recorded" | "already_existed"; activation: MonitorActivationRow }
    | { outcome: "pass_not_redeemable" }
    | { outcome: "quote_not_issued" }
  >;
  /**
   * Lane 7.4F — active agent-originated monitors for scheduler hydrate.
   * Cursor/keyset pagination for fair multi-page processing.
   */
  listActiveMonitorActivations(args?: {
    limit?: number;
    afterPurchaseId?: string | null;
  }): Promise<MonitorActivationRow[]>;
  /** Purchase blob by id only (purchase_id is primary key). */
  getPurchaseBlobByPurchaseId(
    purchaseId: string,
  ): Promise<PurchaseBlobRow | null>;

  // --- Durable scheduler control plane ---
  upsertDurableMonitorSchedule(args: {
    purchaseId: string;
    activationId?: string | null;
    accountId?: string | null;
    status: string;
    nextCheckAt?: string | null;
    lastCheckedAt?: string | null;
    providerBackoffUntil?: string | null;
    lastSkipReason?: string | null;
    hydrationBlockerJson?: string | null;
    nowIso: string;
  }): Promise<void>;
  /**
   * Bootstrap only: insert schedule when missing. Never overwrites status,
   * next_check_at, backoff, skip reason, or hydration blockers.
   */
  insertDurableMonitorScheduleIfMissing(args: {
    purchaseId: string;
    activationId?: string | null;
    accountId?: string | null;
    status?: string;
    nowIso: string;
  }): Promise<{ created: boolean }>;
  getDurableMonitorSchedule(
    purchaseId: string,
  ): Promise<DurableMonitorScheduleRow | null>;
  listDueDurableMonitorSchedules(args: {
    asOfIso: string;
    limit: number;
    afterPurchaseId?: string | null;
  }): Promise<DurableMonitorScheduleRow[]>;
  /**
   * Atomic conditional lease: succeeds only if free or expired.
   * Returns true when this holder acquired the lease.
   */
  tryAcquireGlobalLease(args: {
    leaseKey: string;
    holderId: string;
    expiresAt: string;
    nowIso: string;
  }): Promise<boolean>;
  releaseGlobalLease(args: {
    leaseKey: string;
    holderId: string;
  }): Promise<void>;
  tryReserveSearchBudget(args: {
    periodKey: string;
    limitCount: number;
    nowIso: string;
  }): Promise<{ reserved: boolean; used: number }>;
  tryReserveAlertOpportunity(args: {
    opportunityKey: string;
    purchaseId: string;
    alertId?: string | null;
    nowIso: string;
  }): Promise<boolean>;
  insertNotificationOutbox(args: {
    id: string;
    opportunityKey: string;
    purchaseId: string;
    accountId: string;
    alertId?: string | null;
    kind: string;
    status: string;
    reason?: string | null;
    recipientEmailHash?: string | null;
    evidenceJson?: string | null;
    nowIso: string;
  }): Promise<{ id: string; created: boolean }>;
  tryLeaseNotificationOutbox(args: {
    opportunityKey: string;
    holderId: string;
    leaseExpiresAt: string;
    nowIso: string;
  }): Promise<DurableNotificationOutboxRow | null>;
  insertSettlementReviewAudit(args: {
    id: string;
    paymentId: string;
    decision: string;
    evidenceSource: string;
    evidenceRefHash: string;
    reviewerKeyId?: string | null;
    nowIso: string;
  }): Promise<void>;
  /**
   * Atomically claim a settlement_ref for one payment, mark payment status,
   * and insert immutable review audit. Rejects if ref is already claimed
   * by another payment/pass/audit.
   */
  claimSettlementReviewDecision(args: {
    paymentId: string;
    settlementRef: string;
    decision: "settled" | "failed";
    evidenceSource: string;
    evidenceRefHash: string;
    reviewerKeyId?: string | null;
    payerAddress?: string | null;
    sanitizedSettleReason?: string | null;
    auditId: string;
    nowIso: string;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: "ref_already_claimed" | "payment_not_reviewable" | "conflict" }
  >;
  getSettlementRefClaim(
    settlementRef: string,
  ): Promise<{ settlement_ref: string; payment_id: string; decision: string } | null>;
  getMonitoringPassPaymentBySettlementRef(
    settlementRef: string,
  ): Promise<MonitoringPassPaymentRow | null>;
  markNotificationOutboxStatus(args: {
    id: string;
    status: string;
    reason?: string | null;
    nowIso: string;
    sentAt?: string | null;
    incrementAttempt?: boolean;
    nextAttemptAt?: string | null;
  }): Promise<boolean>;
  getNotificationOutboxByOpportunity(
    opportunityKey: string,
  ): Promise<DurableNotificationOutboxRow | null>;
  /** Due pending/failed_retryable rows, plus expired sending leases. */
  listDueNotificationOutbox(args: {
    nowIso: string;
    limit: number;
  }): Promise<DurableNotificationOutboxRow[]>;
  /**
   * Durable account-level rate limit (e.g. one summary per 24h window).
   * Returns reserved:true only for the first claim of the rate_key up to limitCount.
   */
  tryReserveNotificationRate(args: {
    rateKey: string;
    accountId: string;
    kind: string;
    windowStart: string;
    limitCount: number;
    nowIso: string;
  }): Promise<{ reserved: boolean; used: number }>;
  /** Best-effort decrement after a failed send that already reserved a slot. */
  releaseNotificationRate(args: {
    rateKey: string;
    nowIso: string;
  }): Promise<void>;
  /**
   * Rolling 24h summary: reserve send right if last_sent_at is null or
   * older than windowMs. Concurrent workers: one reserve winner.
   */
  tryReserveRollingSummarySend(args: {
    accountId: string;
    holderId: string;
    nowIso: string;
    windowMs?: number;
    reserveTtlMs?: number;
  }): Promise<{ reserved: boolean; reason?: string; last_sent_at?: string | null }>;
  markRollingSummarySent(args: {
    accountId: string;
    holderId: string;
    nowIso: string;
  }): Promise<boolean>;
  releaseRollingSummaryReserve(args: {
    accountId: string;
    holderId: string;
    nowIso: string;
  }): Promise<void>;
}

export function mintAccountId(): string {
  const hex = newId("x").replace(/^x_/, "");
  return `acct_${hex.slice(0, 32).padEnd(32, "0")}`;
}

export function isAccountOwnerRef(ref: string): boolean {
  return ACCOUNT_ID_RE.test(String(ref || "").trim());
}

function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  return (
    env.AUTH_DATABASE_URL?.trim() ||
    env.DATABASE_URL?.trim() ||
    env.POLICY_OPS_DATABASE_URL?.trim() ||
    env.POSTGRES_URL?.trim() ||
    null
  );
}

export function hasDurableDatabaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(resolveDatabaseUrl(env));
}

// --- SQLite adapter (tests / local without Postgres) ---

export function createSqliteAuthStore(db: NobuDatabase): AuthStore {
  return {
    kind: "sqlite",
    async ensureSchema() {
      db.exec(AUTH_DURABLE_SCHEMA_SQL);
      for (const patch of AUTH_DURABLE_SCHEMA_PATCHES) {
        try {
          db.exec(patch);
        } catch {
          /* column may already exist */
        }
      }
      // Legacy 0006 table names → mirror into durable names if present
      try {
        db.exec(`
          INSERT OR IGNORE INTO auth_accounts (id, email_normalized, email_verified_at, created_at, updated_at)
          SELECT id, email_normalized, email_verified_at, created_at, updated_at FROM accounts;
        `);
      } catch {
        /* legacy table may not exist */
      }
    },
    async getAccountById(id) {
      return (
        (db
          .prepare(`SELECT * FROM auth_accounts WHERE id = ?`)
          .get(id) as AccountRow | undefined) ?? null
      );
    },
    async getAccountByEmail(emailNormalized) {
      return (
        (db
          .prepare(`SELECT * FROM auth_accounts WHERE email_normalized = ?`)
          .get(emailNormalized) as AccountRow | undefined) ?? null
      );
    },
    async upsertAccountForEmail(emailNormalized, nowIso) {
      const existing = await this.getAccountByEmail(emailNormalized);
      if (existing) {
        // Keep legacy 0006 `accounts` row in sync for optional FKs
        try {
          db.prepare(
            `INSERT OR IGNORE INTO accounts (id, email_normalized, email_verified_at, created_at, updated_at)
             VALUES (?,?,?,?,?)`,
          ).run(
            existing.id,
            existing.email_normalized,
            existing.email_verified_at,
            existing.created_at,
            existing.updated_at,
          );
        } catch {
          /* legacy table may differ */
        }
        return existing;
      }
      const id = mintAccountId();
      db.prepare(
        `INSERT INTO auth_accounts (id, email_normalized, email_verified_at, created_at, updated_at)
         VALUES (?,?,NULL,?,?)`,
      ).run(id, emailNormalized, nowIso, nowIso);
      try {
        db.prepare(
          `INSERT OR IGNORE INTO accounts (id, email_normalized, email_verified_at, created_at, updated_at)
           VALUES (?,?,NULL,?,?)`,
        ).run(id, emailNormalized, nowIso, nowIso);
      } catch {
        /* ignore */
      }
      return (await this.getAccountById(id))!;
    },
    async markAccountVerified(accountId, nowIso) {
      db.prepare(
        `UPDATE auth_accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
      ).run(nowIso, nowIso, accountId);
      try {
        db.prepare(
          `UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`,
        ).run(nowIso, nowIso, accountId);
      } catch {
        /* ignore */
      }
    },
    async insertLoginToken(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? AUTH_LOGIN_TOKEN_TTL_MS),
      ).toISOString();
      const id = newId("tok");
      const token_hash = sha256Hex(args.rawToken);
      db.prepare(
        `INSERT INTO auth_login_tokens
         (id, email_normalized, token_hash, expires_at, used_at, created_at, request_ip_hash, guest_owner_ref)
         VALUES (?,?,?,?,NULL,?,NULL,?)`,
      ).run(
        id,
        args.emailNormalized,
        token_hash,
        expires,
        nowIso,
        args.guestOwnerRef,
      );
      return {
        id,
        email_normalized: args.emailNormalized,
        token_hash,
        expires_at: expires,
        used_at: null,
        created_at: nowIso,
        guest_owner_ref: args.guestOwnerRef,
      };
    },
    async findLoginTokenByHash(tokenHash) {
      return (
        (db
          .prepare(`SELECT * FROM auth_login_tokens WHERE token_hash = ?`)
          .get(tokenHash) as LoginTokenRow | undefined) ?? null
      );
    },
    async markLoginTokenUsed(tokenId, nowIso) {
      const r = db
        .prepare(
          `UPDATE auth_login_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL`,
        )
        .run(nowIso, tokenId);
      return Number(r.changes ?? 0) === 1;
    },
    async createSession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const maxAge = args.maxAgeSeconds ?? AUTH_SESSION_MAX_AGE_SECONDS;
      const expires = new Date(now.getTime() + maxAge * 1000).toISOString();
      const id = newId("sess");
      const token_hash = sha256Hex(args.rawSessionToken);
      db.prepare(
        `INSERT INTO auth_sessions
         (id, account_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         VALUES (?,?,?,?,NULL,?,?)`,
      ).run(id, args.accountId, token_hash, expires, nowIso, nowIso);
      return {
        id,
        account_id: args.accountId,
        token_hash,
        expires_at: expires,
        revoked_at: null,
        created_at: nowIso,
        last_seen_at: nowIso,
      };
    },
    async findSessionByTokenHash(tokenHash) {
      return (
        (db
          .prepare(`SELECT * FROM auth_sessions WHERE token_hash = ?`)
          .get(tokenHash) as SessionRow | undefined) ?? null
      );
    },
    async revokeSession(sessionId, nowIso) {
      db.prepare(
        `UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
      ).run(nowIso, sessionId);
    },
    async touchSession(sessionId, nowIso) {
      db.prepare(
        `UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?`,
      ).run(nowIso, sessionId);
    },
    async consumeRateLimit(args) {
      const now = args.now ?? new Date();
      const windowMs = args.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
      const maxHits = args.maxHits ?? AUTH_RATE_LIMIT_MAX;
      const row = db
        .prepare(`SELECT * FROM auth_rate_limits WHERE bucket_key = ?`)
        .get(args.bucketKey) as
        | { window_started_at: string; hit_count: number }
        | undefined;
      if (!row) {
        db.prepare(
          `INSERT INTO auth_rate_limits (bucket_key, window_started_at, hit_count) VALUES (?,?,1)`,
        ).run(args.bucketKey, now.toISOString());
        return true;
      }
      const started = Date.parse(row.window_started_at);
      if (!Number.isFinite(started) || now.getTime() - started > windowMs) {
        db.prepare(
          `UPDATE auth_rate_limits SET window_started_at = ?, hit_count = 1 WHERE bucket_key = ?`,
        ).run(now.toISOString(), args.bucketKey);
        return true;
      }
      if (row.hit_count >= maxHits) return false;
      db.prepare(
        `UPDATE auth_rate_limits SET hit_count = hit_count + 1 WHERE bucket_key = ?`,
      ).run(args.bucketKey);
      return true;
    },
    async recordClaimEvent(args) {
      const prior = db
        .prepare(
          `SELECT purchases_claimed FROM auth_claim_events
           WHERE account_id = ? AND guest_owner_ref = ?`,
        )
        .get(args.accountId, args.guestOwnerRef) as
        | { purchases_claimed: number }
        | undefined;
      if (prior) {
        return { already: true, claimed: prior.purchases_claimed };
      }
      db.prepare(
        `INSERT INTO auth_claim_events (id, account_id, guest_owner_ref, purchases_claimed, created_at)
         VALUES (?,?,?,?,?)`,
      ).run(
        newId("claim"),
        args.accountId,
        args.guestOwnerRef,
        args.purchasesClaimed,
        args.nowIso,
      );
      return { already: false, claimed: args.purchasesClaimed };
    },
    async savePurchaseBlob(args) {
      const existing = db
        .prepare(
          `SELECT archived_at, user_outcome, user_outcome_at,
                  email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at
           FROM account_purchase_blobs WHERE purchase_id = ?`,
        )
        .get(args.purchaseId) as
        | {
            archived_at: string | null;
            user_outcome: string | null;
            user_outcome_at: string | null;
            email_alerts_enabled: number | null;
            email_alerts_consent_at: string | null;
            email_alerts_disabled_at: string | null;
          }
        | undefined;
      const archived =
        args.archived_at !== undefined
          ? args.archived_at
          : (existing?.archived_at ?? null);
      const outcome =
        args.user_outcome !== undefined
          ? args.user_outcome
          : (existing?.user_outcome ?? null);
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : (existing?.user_outcome_at ?? null);
      const emailOn =
        existing?.email_alerts_enabled ?? 0;
      const emailConsent = existing?.email_alerts_consent_at ?? null;
      const emailDisabled = existing?.email_alerts_disabled_at ?? null;
      db.prepare(
        `INSERT INTO account_purchase_blobs
         (purchase_id, account_id, blob_json, updated_at, archived_at, user_outcome, user_outcome_at,
          email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(purchase_id) DO UPDATE SET
           account_id = excluded.account_id,
           blob_json = excluded.blob_json,
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at,
           user_outcome = excluded.user_outcome,
           user_outcome_at = excluded.user_outcome_at,
           email_alerts_enabled = COALESCE(account_purchase_blobs.email_alerts_enabled, excluded.email_alerts_enabled),
           email_alerts_consent_at = COALESCE(account_purchase_blobs.email_alerts_consent_at, excluded.email_alerts_consent_at),
           email_alerts_disabled_at = COALESCE(account_purchase_blobs.email_alerts_disabled_at, excluded.email_alerts_disabled_at)`,
      ).run(
        args.purchaseId,
        args.accountId,
        args.blobJson,
        args.nowIso,
        archived,
        outcome,
        outcomeAt,
        emailOn,
        emailConsent,
        emailDisabled,
      );
    },
    async listPurchaseBlobs(accountId) {
      return db
        .prepare(
          `SELECT * FROM account_purchase_blobs WHERE account_id = ? ORDER BY updated_at DESC`,
        )
        .all(accountId) as PurchaseBlobRow[];
    },
    async getPurchaseBlob(accountId, purchaseId) {
      return (
        (db
          .prepare(
            `SELECT * FROM account_purchase_blobs WHERE account_id = ? AND purchase_id = ?`,
          )
          .get(accountId, purchaseId) as PurchaseBlobRow | undefined) ?? null
      );
    },
    async updatePurchaseLifecycleMeta(args) {
      const row = await this.getPurchaseBlob(args.accountId, args.purchaseId);
      if (!row) return false;
      const archived =
        args.archived_at !== undefined ? args.archived_at : row.archived_at;
      const outcome =
        args.user_outcome !== undefined ? args.user_outcome : row.user_outcome;
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : row.user_outcome_at;
      const emailOn =
        args.email_alerts_enabled !== undefined
          ? args.email_alerts_enabled
          : (row.email_alerts_enabled ?? 0);
      const emailConsent =
        args.email_alerts_consent_at !== undefined
          ? args.email_alerts_consent_at
          : (row.email_alerts_consent_at ?? null);
      const emailDisabled =
        args.email_alerts_disabled_at !== undefined
          ? args.email_alerts_disabled_at
          : (row.email_alerts_disabled_at ?? null);
      db.prepare(
        `UPDATE account_purchase_blobs
         SET archived_at = ?, user_outcome = ?, user_outcome_at = ?,
             email_alerts_enabled = ?, email_alerts_consent_at = ?,
             email_alerts_disabled_at = ?, updated_at = ?
         WHERE account_id = ? AND purchase_id = ?`,
      ).run(
        archived,
        outcome,
        outcomeAt,
        emailOn,
        emailConsent,
        emailDisabled,
        args.nowIso,
        args.accountId,
        args.purchaseId,
      );
      return true;
    },
    async deletePurchaseBlob(args) {
      const r = db
        .prepare(
          `DELETE FROM account_purchase_blobs WHERE account_id = ? AND purchase_id = ?`,
        )
        .run(args.accountId, args.purchaseId);
      return Number(r.changes ?? 0) > 0;
    },

    async insertAgentConnection(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("conn");
      db.prepare(
        `INSERT INTO agent_connections
         (id, account_id, email_normalized, connection_token_hash, credential_expires_at,
          credential_rotated_at, status, revoked_at, created_at, last_used_at)
         VALUES (?,NULL,?,NULL,NULL,NULL,'pending',NULL,?,NULL)`,
      ).run(id, args.emailNormalized, nowIso);
      return (await this.getAgentConnectionById(id))!;
    },
    async getAgentConnectionById(id) {
      return (
        (db
          .prepare(`SELECT * FROM agent_connections WHERE id = ?`)
          .get(id) as AgentConnectionRow | undefined) ?? null
      );
    },
    async setAgentConnectionCredential(args) {
      const r = db
        .prepare(
          `UPDATE agent_connections
           SET connection_token_hash = ?,
               credential_expires_at = ?,
               credential_rotated_at = ?,
               status = 'active',
               account_id = COALESCE(?, account_id)
           WHERE id = ? AND status != 'revoked'`,
        )
        .run(
          args.tokenHash,
          args.expiresAt,
          args.nowIso,
          args.accountId ?? null,
          args.connectionId,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async revokeAgentConnection(args) {
      const r = db
        .prepare(
          `UPDATE agent_connections
           SET status = 'revoked', revoked_at = ?, connection_token_hash = NULL
           WHERE id = ? AND status != 'revoked'`,
        )
        .run(args.nowIso, args.connectionId);
      return Number(r.changes ?? 0) === 1;
    },
    async touchAgentConnectionLastUsed(args) {
      db.prepare(
        `UPDATE agent_connections SET last_used_at = ? WHERE id = ?`,
      ).run(args.nowIso, args.connectionId);
    },
    async insertAgentEmailCode(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 10 * 60 * 1000),
      ).toISOString();
      const id = newId("aec");
      const code_hash = sha256Hex(args.rawCode);
      db.prepare(
        `INSERT INTO agent_email_codes
         (id, connection_id, email_normalized, code_hash, expires_at, attempt_count, used_at, created_at)
         VALUES (?,?,?,?,?,0,NULL,?)`,
      ).run(id, args.connectionId, args.emailNormalized, code_hash, expires, nowIso);
      return {
        id,
        connection_id: args.connectionId,
        email_normalized: args.emailNormalized,
        code_hash,
        expires_at: expires,
        attempt_count: 0,
        used_at: null,
        created_at: nowIso,
      };
    },
    async findLatestAgentEmailCode(connectionId) {
      return (
        (db
          .prepare(
            `SELECT * FROM agent_email_codes
             WHERE connection_id = ? AND used_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(connectionId) as AgentEmailCodeRow | undefined) ?? null
      );
    },
    async markAgentEmailCodeUsed(codeId, nowIso) {
      const r = db
        .prepare(
          `UPDATE agent_email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL`,
        )
        .run(nowIso, codeId);
      return Number(r.changes ?? 0) === 1;
    },
    async incrementAgentEmailCodeAttempt(codeId) {
      db.prepare(
        `UPDATE agent_email_codes SET attempt_count = attempt_count + 1 WHERE id = ?`,
      ).run(codeId);
      const row = db
        .prepare(`SELECT attempt_count FROM agent_email_codes WHERE id = ?`)
        .get(codeId) as { attempt_count: number } | undefined;
      return row?.attempt_count ?? 0;
    },

    async insertDiscoverySession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 30 * 60 * 1000),
      ).toISOString();
      const id = newId("disc");
      db.prepare(
        `INSERT INTO discovery_sessions
         (id, structured_snapshot_json, purchase_text_hash, candidates_snapshot_json,
          selected_candidate_id, locked_fingerprint_snapshot_json, status,
          materialized_purchase_id, created_at, expires_at)
         VALUES (?,?,?,?,NULL,NULL,'discovering',NULL,?,?)`,
      ).run(
        id,
        args.structuredSnapshotJson,
        args.purchaseTextHash,
        args.candidatesSnapshotJson,
        nowIso,
        expires,
      );
      return (await this.getDiscoverySessionById(id))!;
    },
    async getDiscoverySessionById(id) {
      return (
        (db
          .prepare(`SELECT * FROM discovery_sessions WHERE id = ?`)
          .get(id) as DiscoverySessionRow | undefined) ?? null
      );
    },
    async confirmDiscoverySession(args) {
      const r = db
        .prepare(
          `UPDATE discovery_sessions
           SET selected_candidate_id = ?, locked_fingerprint_snapshot_json = ?, status = 'confirmed'
           WHERE id = ? AND status IN ('discovering', 'confirmed')`,
        )
        .run(
          args.selectedCandidateId,
          args.lockedFingerprintSnapshotJson,
          args.sessionId,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async reserveDiscoverySessionMaterialization(args) {
      const r = db
        .prepare(
          `UPDATE discovery_sessions
           SET status = 'materialized', materialized_purchase_id = ?
           WHERE id = ? AND status = 'confirmed'`,
        )
        .run(args.purchaseId, args.sessionId);
      return Number(r.changes ?? 0) === 1;
    },
    async insertMonitoringEnrollmentQuote(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 15 * 60 * 1000),
      ).toISOString();
      const id = newId("quote");
      db.prepare(
        `INSERT INTO monitoring_enrollment_quotes
         (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
          price_currency, settlement_asset, settlement_network, monitoring_deadline,
          consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
         VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,?,'issued',?,?)`,
      ).run(
        id,
        args.connectionId,
        args.accountId,
        args.purchaseId,
        args.fingerprintId,
        args.priceAmount,
        args.priceCurrency,
        args.monitoringDeadline,
        args.consentMonitoringAt,
        args.consentEmailAlertsAt,
        expires,
        nowIso,
      );
      return {
        id,
        connection_id: args.connectionId,
        account_id: args.accountId,
        purchase_id: args.purchaseId,
        fingerprint_id: args.fingerprintId,
        price_amount: args.priceAmount,
        price_currency: args.priceCurrency,
        settlement_asset: null,
        settlement_network: null,
        monitoring_deadline: args.monitoringDeadline,
        consent_monitoring_at: args.consentMonitoringAt,
        consent_email_alerts_at: args.consentEmailAlertsAt,
        status: "issued",
        expires_at: expires,
        created_at: nowIso,
      };
    },
    async getActiveMonitoringEnrollmentQuote(purchaseId, nowIso) {
      const row = db
        .prepare(
          `SELECT * FROM monitoring_enrollment_quotes
           WHERE purchase_id = ? AND status = 'issued' AND expires_at > ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(purchaseId, nowIso) as MonitoringEnrollmentQuoteRow | undefined;
      return row ?? null;
    },
    async getMonitoringEnrollmentQuoteById(quoteId) {
      const row = db
        .prepare(`SELECT * FROM monitoring_enrollment_quotes WHERE id = ?`)
        .get(quoteId) as MonitoringEnrollmentQuoteRow | undefined;
      return row ?? null;
    },

    async getLatestPaymentAttemptForQuote(quoteId) {
      const row = db
        .prepare(
          `SELECT * FROM payment_attempts WHERE quote_id = ?
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(quoteId) as PaymentAttemptRow | undefined;
      return row ?? null;
    },
    async insertPaymentAttempt(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("pay");
      db.prepare(
        `INSERT INTO payment_attempts
         (id, quote_id, x402_challenge_ref, status, settlement_ref, created_at, settled_at)
         VALUES (?,?,?,'challenged',NULL,?,NULL)`,
      ).run(id, args.quoteId, args.challengeRef, nowIso);
      return {
        id,
        quote_id: args.quoteId,
        x402_challenge_ref: args.challengeRef,
        status: "challenged",
        settlement_ref: null,
        created_at: nowIso,
        settled_at: null,
      };
    },
    async markPaymentAttemptVerifying(args) {
      const r = db
        .prepare(
          `UPDATE payment_attempts
           SET status = 'verifying', settlement_ref = ?
           WHERE id = ? AND status IN ('challenged', 'verifying')`,
        )
        .run(args.settlementRef, args.attemptId);
      return Number(r.changes ?? 0) === 1;
    },
    async getMonitorActivationByQuoteId(quoteId) {
      const row = db
        .prepare(`SELECT * FROM monitor_activations WHERE quote_id = ?`)
        .get(quoteId) as MonitorActivationRow | undefined;
      return row ?? null;
    },
    async getActiveMonitorActivationByPurchaseId(purchaseId) {
      const row = db
        .prepare(
          `SELECT * FROM monitor_activations
           WHERE purchase_id = ? AND status = 'active'
           ORDER BY created_at ASC LIMIT 1`,
        )
        .get(purchaseId) as MonitorActivationRow | undefined;
      return row ?? null;
    },
    async recordSettledPaymentAndActivation(args) {
      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE payment_attempts
           SET status = 'settled', settlement_ref = ?, settled_at = ?
           WHERE id = ? AND status != 'settled'`,
        ).run(args.settlementRef, args.nowIso, args.paymentAttemptId);

        const quoteResult = db
          .prepare(
            `UPDATE monitoring_enrollment_quotes
             SET status = 'consumed'
             WHERE id = ? AND status = 'issued'`,
          )
          .run(args.quoteId);

        // Only insert when THIS call is the one that just consumed the
        // quote — never insert an activation for a quote that was not (by
        // this transaction) legitimately transitioned from 'issued'.
        if (Number(quoteResult.changes ?? 0) > 0) {
          db.prepare(
            `INSERT INTO monitor_activations
             (id, quote_id, activation_key, payment_attempt_id, purchase_id,
              fingerprint_id, monitor_id, status, created_at, projected_at)
             VALUES (?,?,?,?,?,?,?,'pending_projection',?,NULL)
             ON CONFLICT(quote_id) DO NOTHING`,
          ).run(
            args.activationId,
            args.quoteId,
            args.activationKey,
            args.paymentAttemptId,
            args.purchaseId,
            args.fingerprintId,
            args.purchaseId,
            args.nowIso,
          );
        }

        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        // A concurrent replay can lose a UNIQUE-constraint race (e.g. two
        // requests each settling their own payment_attempts row for the
        // same quote) after already losing the quote-consumption race —
        // that is a lost race, not a failure: fall through to the
        // post-transaction read, which resolves the true durable outcome.
        if (!isUniqueViolationError(err)) throw err;
      }

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async markMonitorActivationActive(args) {
      const r = db
        .prepare(
          `UPDATE monitor_activations
           SET status = 'active', projected_at = ?
           WHERE id = ? AND status != 'active'`,
        )
        .run(args.nowIso, args.activationId);
      return Number(r.changes ?? 0) === 1;
    },
    async listPendingProjectionActivations() {
      return db
        .prepare(
          `SELECT * FROM monitor_activations WHERE status = 'pending_projection'
           ORDER BY created_at ASC`,
        )
        .all() as MonitorActivationRow[];
    },
    async getMonitoringPassPaymentByDigest(authorizationDigest) {
      return (
        (db
          .prepare(
            `SELECT * FROM monitoring_pass_payments WHERE authorization_digest = ?`,
          )
          .get(authorizationDigest) as MonitoringPassPaymentRow | undefined) ??
        null
      );
    },
    async getMonitoringPassPaymentById(paymentId) {
      return (
        (db
          .prepare(`SELECT * FROM monitoring_pass_payments WHERE id = ?`)
          .get(paymentId) as MonitoringPassPaymentRow | undefined) ?? null
      );
    },
    async upsertMonitoringPassPayment(args) {
      const status = args.status ?? "authorization_received";
      db.prepare(
        `INSERT INTO monitoring_pass_payments
         (id, authorization_digest, status, settlement_ref, attempt_count, created_at, updated_at)
         VALUES (?,?,?,NULL,0,?,?)
         ON CONFLICT(authorization_digest) DO NOTHING`,
      ).run(args.id, args.authorizationDigest, status, args.nowIso, args.nowIso);
      return (await this.getMonitoringPassPaymentByDigest(
        args.authorizationDigest,
      ))!;
    },
    async updateMonitoringPassPayment(args) {
      const settlementRef =
        args.settlementRef == null
          ? null
          : String(args.settlementRef).trim().toLowerCase() || null;
      const r = db
        .prepare(
          `UPDATE monitoring_pass_payments
           SET status = ?,
               settlement_ref = ?,
               updated_at = ?,
               payer_address = COALESCE(?, payer_address),
               sanitized_verify_reason = COALESCE(?, sanitized_verify_reason),
               sanitized_settle_reason = COALESCE(?, sanitized_settle_reason),
               last_provider_operation = COALESCE(?, last_provider_operation),
               attempt_count = CASE WHEN ? THEN COALESCE(attempt_count, 0) + 1 ELSE COALESCE(attempt_count, 0) END,
               provider_payment_id = COALESCE(?, provider_payment_id),
               provider_authorization_id = COALESCE(?, provider_authorization_id)
           WHERE id = ?`,
        )
        .run(
          args.status,
          settlementRef,
          args.nowIso,
          args.payerAddress ?? null,
          args.sanitizedVerifyReason ?? null,
          args.sanitizedSettleReason ?? null,
          args.lastProviderOperation ?? null,
          args.incrementAttempt ? 1 : 0,
          args.providerPaymentId ?? null,
          args.providerAuthorizationId ?? null,
          args.id,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async listVerifyingMonitoringPassPayments() {
      return db
        .prepare(
          `SELECT * FROM monitoring_pass_payments
           WHERE status IN ('verifying', 'settlement_pending', 'settlement_unknown')
             AND settlement_ref IS NOT NULL
           ORDER BY created_at ASC`,
        )
        .all() as MonitoringPassPaymentRow[];
    },
    async listReconcileableMonitoringPassPayments() {
      return db
        .prepare(
          `SELECT * FROM monitoring_pass_payments
           WHERE status IN ('verifying', 'settlement_pending', 'settlement_unknown', 'settled')
           ORDER BY created_at ASC`,
        )
        .all() as MonitoringPassPaymentRow[];
    },
    async listSettledMonitoringPassPaymentsWithoutPass() {
      return db
        .prepare(
          `SELECT p.* FROM monitoring_pass_payments p
           WHERE p.status = 'settled'
             AND p.settlement_ref IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM monitoring_passes m
               WHERE m.settlement_ref = p.settlement_ref
                  OR m.payment_id = p.id
             )
           ORDER BY p.created_at ASC`,
        )
        .all() as MonitoringPassPaymentRow[];
    },
    async getMonitoringPassBySettlementRef(settlementRef) {
      const ref = String(settlementRef || "").trim().toLowerCase();
      return (
        (db
          .prepare(
            `SELECT * FROM monitoring_passes WHERE lower(settlement_ref) = ?`,
          )
          .get(ref) as MonitoringPassRow | undefined) ?? null
      );
    },
    async getMonitoringPassById(passId) {
      return (
        (db
          .prepare(`SELECT * FROM monitoring_passes WHERE id = ?`)
          .get(passId) as MonitoringPassRow | undefined) ?? null
      );
    },
    async issueMonitoringPass(args) {
      const settlementRef = String(args.settlementRef || "")
        .trim()
        .toLowerCase();
      db.prepare(
        `INSERT INTO monitoring_passes
         (id, pass_token_hash, settlement_ref, payment_id, price_amount,
          price_currency, status, payer_address, redeemed_at, redeemed_quote_id,
          redeemed_purchase_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,'issued',?,NULL,NULL,NULL,?,?)
         ON CONFLICT(settlement_ref) DO NOTHING`,
      ).run(
        args.id,
        args.passTokenHash,
        settlementRef,
        args.paymentId,
        args.priceAmount,
        args.priceCurrency,
        args.payerAddress ?? null,
        args.nowIso,
        args.nowIso,
      );
      const pass = (await this.getMonitoringPassBySettlementRef(
        settlementRef,
      ))!;
      return {
        outcome: pass.id === args.id ? ("issued" as const) : ("already_existed" as const),
        pass,
      };
    },
    async ensureMonitoringPassContinuation(args) {
      const status =
        args.status ??
        (args.monitoringPassId ? ("issued" as const) : ("pending" as const));
      db.prepare(
        `INSERT INTO monitoring_pass_continuations
         (id, payment_id, monitoring_pass_id, status, claim_credential_hash,
          created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(payment_id) DO NOTHING`,
      ).run(
        args.id,
        args.paymentId,
        args.monitoringPassId ?? null,
        status,
        args.claimCredentialHash ?? null,
        args.nowIso,
        args.nowIso,
      );
      if (args.monitoringPassId) {
        db.prepare(
          `UPDATE monitoring_pass_continuations
           SET monitoring_pass_id = ?, status = 'issued', updated_at = ?
           WHERE payment_id = ? AND (monitoring_pass_id IS NULL OR status != 'issued')`,
        ).run(args.monitoringPassId, args.nowIso, args.paymentId);
      }
      // Only set credential hash if row still has none (first writer wins).
      if (args.claimCredentialHash) {
        db.prepare(
          `UPDATE monitoring_pass_continuations
           SET claim_credential_hash = COALESCE(claim_credential_hash, ?)
           WHERE payment_id = ?`,
        ).run(args.claimCredentialHash, args.paymentId);
      }
      return (await this.getMonitoringPassContinuationByPaymentId(
        args.paymentId,
      ))!;
    },
    async markMonitoringPassContinuationIssued(args) {
      db.prepare(
        `UPDATE monitoring_pass_continuations
         SET monitoring_pass_id = ?, status = 'issued', updated_at = ?
         WHERE payment_id = ?`,
      ).run(args.monitoringPassId, args.nowIso, args.paymentId);
      return this.getMonitoringPassContinuationByPaymentId(args.paymentId);
    },
    async consumeContinuationClaimCredential(args) {
      const r = db
        .prepare(
          `UPDATE monitoring_pass_continuations
           SET claim_credential_consumed_at = ?, updated_at = ?
           WHERE id = ?
             AND claim_credential_hash = ?
             AND claim_credential_consumed_at IS NULL`,
        )
        .run(
          args.nowIso,
          args.nowIso,
          args.continuationId,
          args.claimCredentialHash,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async claimPassAndCreateJourney(args) {
      db.exec("BEGIN");
      try {
        const cont = db
          .prepare(
            `SELECT * FROM monitoring_pass_continuations WHERE id = ?`,
          )
          .get(args.continuationId) as
          | MonitoringPassContinuationRow
          | undefined;
        if (!cont) {
          db.exec("ROLLBACK");
          return { outcome: "claim_invalid" as const };
        }
        if (
          cont.monitoring_pass_id &&
          cont.monitoring_pass_id !== args.monitoringPassId
        ) {
          db.exec("ROLLBACK");
          return { outcome: "pass_mismatch" as const };
        }
        // Credential must always match stored hash (even when already consumed).
        if (
          !cont.claim_credential_hash ||
          cont.claim_credential_hash !== args.claimCredentialHash
        ) {
          db.exec("ROLLBACK");
          return { outcome: "claim_invalid" as const };
        }
        // Already claimed: recover existing journey only with matching credential.
        if (cont.claim_credential_consumed_at) {
          const existing = db
            .prepare(
              `SELECT * FROM marketplace_purchase_journeys WHERE monitoring_pass_id = ?`,
            )
            .get(args.monitoringPassId) as
            | MarketplacePurchaseJourneyRow
            | undefined;
          db.exec("COMMIT");
          if (existing) {
            return {
              outcome: "already_existed" as const,
              journey: existing,
            };
          }
          return { outcome: "claim_invalid" as const };
        }

        // Insert journey first; only then consume claim (same transaction).
        db.prepare(
          `INSERT INTO marketplace_purchase_journeys
           (id, monitoring_pass_id, pass_continuation_id, stage, created_at, updated_at)
           VALUES (?,?,?,'confirm_use_pass',?,?)
           ON CONFLICT(monitoring_pass_id) DO NOTHING`,
        ).run(
          args.journeyId,
          args.monitoringPassId,
          args.continuationId,
          args.nowIso,
          args.nowIso,
        );

        const journey = db
          .prepare(
            `SELECT * FROM marketplace_purchase_journeys WHERE monitoring_pass_id = ?`,
          )
          .get(args.monitoringPassId) as MarketplacePurchaseJourneyRow;

        const consumed = db
          .prepare(
            `UPDATE monitoring_pass_continuations
             SET claim_credential_consumed_at = ?,
                 monitoring_pass_id = COALESCE(monitoring_pass_id, ?),
                 status = 'claimed',
                 updated_at = ?
             WHERE id = ?
               AND claim_credential_hash = ?
               AND claim_credential_consumed_at IS NULL`,
          )
          .run(
            args.nowIso,
            args.monitoringPassId,
            args.nowIso,
            args.continuationId,
            args.claimCredentialHash,
          );
        if (Number(consumed.changes ?? 0) !== 1 && !journey) {
          db.exec("ROLLBACK");
          return { outcome: "claim_invalid" as const };
        }
        db.exec("COMMIT");
        return {
          outcome:
            journey.id === args.journeyId
              ? ("created" as const)
              : ("already_existed" as const),
          journey,
        };
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }
    },
    async getMonitoringPassContinuationById(id) {
      return (
        (db
          .prepare(`SELECT * FROM monitoring_pass_continuations WHERE id = ?`)
          .get(id) as MonitoringPassContinuationRow | undefined) ?? null
      );
    },
    async getMonitoringPassContinuationByPaymentId(paymentId) {
      return (
        (db
          .prepare(
            `SELECT * FROM monitoring_pass_continuations WHERE payment_id = ?`,
          )
          .get(paymentId) as MonitoringPassContinuationRow | undefined) ?? null
      );
    },
    async getMonitoringPassContinuationByPassId(passId) {
      return (
        (db
          .prepare(
            `SELECT * FROM monitoring_pass_continuations WHERE monitoring_pass_id = ?`,
          )
          .get(passId) as MonitoringPassContinuationRow | undefined) ?? null
      );
    },
    async getMonitoringPassByPaymentId(paymentId) {
      return (
        (db
          .prepare(`SELECT * FROM monitoring_passes WHERE payment_id = ?`)
          .get(paymentId) as MonitoringPassRow | undefined) ?? null
      );
    },
    async ensureMarketplacePurchaseJourney(args) {
      db.prepare(
        `INSERT INTO marketplace_purchase_journeys
         (id, monitoring_pass_id, pass_continuation_id, stage, created_at, updated_at)
         VALUES (?,?,?,'confirm_use_pass',?,?)
         ON CONFLICT(monitoring_pass_id) DO NOTHING`,
      ).run(
        args.id,
        args.monitoringPassId,
        args.passContinuationId ?? null,
        args.nowIso,
        args.nowIso,
      );
      return (await this.getMarketplacePurchaseJourneyByPassId(
        args.monitoringPassId,
      ))!;
    },
    async getMarketplacePurchaseJourneyById(id) {
      return (
        (db.prepare(`SELECT * FROM marketplace_purchase_journeys WHERE id = ?`).get(
          id,
        ) as MarketplacePurchaseJourneyRow | undefined) ?? null
      );
    },
    async getMarketplacePurchaseJourneyByPassId(passId) {
      return (
        (db.prepare(
          `SELECT * FROM marketplace_purchase_journeys WHERE monitoring_pass_id = ?`,
        ).get(passId) as MarketplacePurchaseJourneyRow | undefined) ?? null
      );
    },
    async updateMarketplacePurchaseJourney(args) {
      db.prepare(
        `UPDATE marketplace_purchase_journeys
         SET stage = ?,
             purchase_snapshot_json = COALESCE(?, purchase_snapshot_json),
             discovery_session_id = COALESCE(?, discovery_session_id),
             fingerprint_id = COALESCE(?, fingerprint_id),
             connection_id = COALESCE(?, connection_id),
             quote_id = COALESCE(?, quote_id),
             updated_at = ?
         WHERE id = ?`,
      ).run(
        args.stage,
        args.purchaseSnapshotJson ?? null,
        args.discoverySessionId ?? null,
        args.fingerprintId ?? null,
        args.connectionId ?? null,
        args.quoteId ?? null,
        args.nowIso,
        args.id,
      );
      return this.getMarketplacePurchaseJourneyById(args.id);
    },
    async listSettledPassPaymentsMissingContinuation() {
      return db
        .prepare(
          `SELECT p.* FROM monitoring_pass_payments p
           INNER JOIN monitoring_passes m ON m.payment_id = p.id
           WHERE p.status = 'settled'
             AND NOT EXISTS (
               SELECT 1 FROM monitoring_pass_continuations c
               WHERE c.payment_id = p.id
             )
           ORDER BY p.created_at ASC`,
        )
        .all() as MonitoringPassPaymentRow[];
    },
    async redeemMonitoringPassAndActivate(args) {
      // Idempotent replay: this pass already redeemed for this exact quote.
      const before = await this.getMonitoringPassById(args.passId);
      if (
        before &&
        before.status === "redeemed" &&
        before.redeemed_quote_id === args.quoteId
      ) {
        const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
        if (existing) {
          return { outcome: "already_existed" as const, activation: existing };
        }
      }

      db.exec("BEGIN");
      try {
        const passResult = db
          .prepare(
            `UPDATE monitoring_passes
             SET status = 'redeemed', redeemed_at = ?, redeemed_quote_id = ?,
                 redeemed_purchase_id = ?, updated_at = ?
             WHERE id = ? AND status = 'issued'`,
          )
          .run(
            args.nowIso,
            args.quoteId,
            args.purchaseId,
            args.nowIso,
            args.passId,
          );
        if (Number(passResult.changes ?? 0) === 0) {
          db.exec("ROLLBACK");
          return { outcome: "pass_not_redeemable" as const };
        }

        const quoteResult = db
          .prepare(
            `UPDATE monitoring_enrollment_quotes
             SET status = 'consumed'
             WHERE id = ? AND status = 'issued'`,
          )
          .run(args.quoteId);
        if (Number(quoteResult.changes ?? 0) === 0) {
          // Never consume a pass for a quote this transaction could not claim.
          db.exec("ROLLBACK");
          return { outcome: "quote_not_issued" as const };
        }

        db.prepare(
          `INSERT INTO monitor_activations
           (id, quote_id, activation_key, payment_attempt_id, purchase_id,
            fingerprint_id, monitor_id, status, created_at, projected_at,
            monitoring_pass_id)
           VALUES (?,?,?,?,?,?,?,'pending_projection',?,NULL,?)
           ON CONFLICT(quote_id) DO NOTHING`,
        ).run(
          args.activationId,
          args.quoteId,
          args.activationKey,
          args.passId,
          args.purchaseId,
          args.fingerprintId,
          args.purchaseId,
          args.nowIso,
          args.passId,
        );

        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        if (!isUniqueViolationError(err)) throw err;
      }

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async expireIssuedEnrollmentQuotesForPurchase(args) {
      const r = db
        .prepare(
          `UPDATE monitoring_enrollment_quotes
           SET status = 'expired'
           WHERE purchase_id = ?
             AND status = 'issued'
             AND (? IS NULL OR id != ?)`,
        )
        .run(
          args.purchaseId,
          args.exceptQuoteId ?? null,
          args.exceptQuoteId ?? null,
        );
      return Number(r.changes ?? 0);
    },
    async replaceIssuedEnrollmentQuote(args) {
      db.exec("BEGIN");
      try {
        // Expire any currently-issued row so the partial unique index releases.
        db.prepare(
          `UPDATE monitoring_enrollment_quotes
           SET status = 'expired'
           WHERE purchase_id = ? AND status = 'issued'`,
        ).run(args.purchaseId);

        // If an unexpired issued quote somehow remains (race), prefer it.
        const existing = db
          .prepare(
            `SELECT * FROM monitoring_enrollment_quotes
             WHERE purchase_id = ? AND status = 'issued' AND expires_at > ?
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(args.purchaseId, args.nowIso) as
          | MonitoringEnrollmentQuoteRow
          | undefined;
        if (existing) {
          db.exec("COMMIT");
          return {
            outcome: "existing_unexpired" as const,
            quote: existing,
            supersededIds: [],
          };
        }

        db.prepare(
          `INSERT INTO monitoring_enrollment_quotes
           (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
            price_currency, settlement_asset, settlement_network, monitoring_deadline,
            consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'issued',?,?)`,
        ).run(
          args.id,
          args.connectionId,
          args.accountId,
          args.purchaseId,
          args.fingerprintId,
          args.priceAmount,
          args.priceCurrency,
          args.settlementAsset,
          args.settlementNetwork,
          args.monitoringDeadline,
          args.consentMonitoringAt,
          args.consentEmailAlertsAt,
          args.expiresAt,
          args.nowIso,
        );
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        // Unique race — return the winner's issued quote.
        const winner = await this.getActiveMonitoringEnrollmentQuote(
          args.purchaseId,
          args.nowIso,
        );
        if (winner) {
          return {
            outcome: "existing_unexpired" as const,
            quote: winner,
            supersededIds: [],
          };
        }
        throw err;
      }
      const quote = (await this.getMonitoringEnrollmentQuoteById(args.id))!;
      return {
        outcome: "issued" as const,
        quote,
        supersededIds: [],
      };
    },
    async listActiveMonitorActivations(args) {
      const limit = Math.min(Math.max(1, args?.limit ?? 50), 200);
      const after = args?.afterPurchaseId ?? null;
      // Consistent keyset: ORDER BY purchase_id ASC on every page.
      if (after) {
        return db
          .prepare(
            `SELECT * FROM monitor_activations
             WHERE status = 'active' AND purchase_id > ?
             ORDER BY purchase_id ASC LIMIT ?`,
          )
          .all(after, limit) as MonitorActivationRow[];
      }
      return db
        .prepare(
          `SELECT * FROM monitor_activations WHERE status = 'active'
           ORDER BY purchase_id ASC
           LIMIT ?`,
        )
        .all(limit) as MonitorActivationRow[];
    },
    async getPurchaseBlobByPurchaseId(purchaseId) {
      return (
        (db
          .prepare(
            `SELECT * FROM account_purchase_blobs WHERE purchase_id = ?`,
          )
          .get(purchaseId) as PurchaseBlobRow | undefined) ?? null
      );
    },
    async upsertDurableMonitorSchedule(args) {
      db.prepare(
        `INSERT INTO durable_monitor_schedule
         (purchase_id, activation_id, account_id, status, next_check_at,
          last_checked_at, provider_backoff_until, last_skip_reason,
          hydration_blocker_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(purchase_id) DO UPDATE SET
           activation_id = COALESCE(excluded.activation_id, durable_monitor_schedule.activation_id),
           account_id = COALESCE(excluded.account_id, durable_monitor_schedule.account_id),
           status = excluded.status,
           next_check_at = COALESCE(excluded.next_check_at, durable_monitor_schedule.next_check_at),
           last_checked_at = COALESCE(excluded.last_checked_at, durable_monitor_schedule.last_checked_at),
           provider_backoff_until = COALESCE(excluded.provider_backoff_until, durable_monitor_schedule.provider_backoff_until),
           last_skip_reason = COALESCE(excluded.last_skip_reason, durable_monitor_schedule.last_skip_reason),
           hydration_blocker_json = COALESCE(excluded.hydration_blocker_json, durable_monitor_schedule.hydration_blocker_json),
           updated_at = excluded.updated_at`,
      ).run(
        args.purchaseId,
        args.activationId ?? null,
        args.accountId ?? null,
        args.status,
        args.nextCheckAt ?? null,
        args.lastCheckedAt ?? null,
        args.providerBackoffUntil ?? null,
        args.lastSkipReason ?? null,
        args.hydrationBlockerJson ?? null,
        args.nowIso,
        args.nowIso,
      );
    },
    async insertDurableMonitorScheduleIfMissing(args) {
      const r = db
        .prepare(
          `INSERT INTO durable_monitor_schedule
           (purchase_id, activation_id, account_id, status, next_check_at,
            last_checked_at, provider_backoff_until, last_skip_reason,
            hydration_blocker_json, created_at, updated_at)
           VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,?)
           ON CONFLICT(purchase_id) DO NOTHING`,
        )
        .run(
          args.purchaseId,
          args.activationId ?? null,
          args.accountId ?? null,
          args.status ?? "active",
          args.nowIso,
          args.nowIso,
        );
      return { created: Number(r.changes ?? 0) === 1 };
    },
    async getDurableMonitorSchedule(purchaseId) {
      return (
        (db
          .prepare(`SELECT * FROM durable_monitor_schedule WHERE purchase_id = ?`)
          .get(purchaseId) as DurableMonitorScheduleRow | undefined) ?? null
      );
    },
    async listDueDurableMonitorSchedules(args) {
      // Authoritative work page: active only, due, backoff elapsed, keyset by purchase_id.
      if (args.afterPurchaseId) {
        return db
          .prepare(
            `SELECT * FROM durable_monitor_schedule
             WHERE status = 'active'
               AND (next_check_at IS NULL OR next_check_at <= ?)
               AND (provider_backoff_until IS NULL OR provider_backoff_until <= ?)
               AND purchase_id > ?
             ORDER BY purchase_id ASC LIMIT ?`,
          )
          .all(
            args.asOfIso,
            args.asOfIso,
            args.afterPurchaseId,
            args.limit,
          ) as DurableMonitorScheduleRow[];
      }
      return db
        .prepare(
          `SELECT * FROM durable_monitor_schedule
           WHERE status = 'active'
             AND (next_check_at IS NULL OR next_check_at <= ?)
             AND (provider_backoff_until IS NULL OR provider_backoff_until <= ?)
           ORDER BY purchase_id ASC LIMIT ?`,
        )
        .all(args.asOfIso, args.asOfIso, args.limit) as DurableMonitorScheduleRow[];
    },
    async tryAcquireGlobalLease(args) {
      // Serialize concurrent acquirers on this connection (SQLite).
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO durable_global_leases (lease_key, holder_id, expires_at, updated_at)
           VALUES (?,?,?,?)
           ON CONFLICT(lease_key) DO UPDATE SET
             holder_id = excluded.holder_id,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at
           WHERE durable_global_leases.expires_at <= excluded.updated_at
              OR durable_global_leases.holder_id = excluded.holder_id`,
        ).run(args.leaseKey, args.holderId, args.expiresAt, args.nowIso);
        const row = db
          .prepare(
            `SELECT holder_id FROM durable_global_leases WHERE lease_key = ?`,
          )
          .get(args.leaseKey) as { holder_id: string } | undefined;
        db.exec("COMMIT");
        return row?.holder_id === args.holderId;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }
    },
    async releaseGlobalLease(args) {
      db.prepare(
        `DELETE FROM durable_global_leases WHERE lease_key = ? AND holder_id = ?`,
      ).run(args.leaseKey, args.holderId);
    },
    async tryReserveSearchBudget(args) {
      db.prepare(
        `INSERT INTO durable_search_budget (period_key, used_count, limit_count, updated_at)
         VALUES (?,0,?,?)
         ON CONFLICT(period_key) DO NOTHING`,
      ).run(args.periodKey, args.limitCount, args.nowIso);
      const current = db
        .prepare(
          `SELECT used_count, limit_count FROM durable_search_budget WHERE period_key = ?`,
        )
        .get(args.periodKey) as
        | { used_count: number; limit_count: number }
        | undefined;
      if (!current) return { reserved: false, used: 0 };
      if (current.used_count >= current.limit_count) {
        return { reserved: false, used: current.used_count };
      }
      const r = db
        .prepare(
          `UPDATE durable_search_budget
           SET used_count = used_count + 1, updated_at = ?
           WHERE period_key = ? AND used_count < limit_count`,
        )
        .run(args.nowIso, args.periodKey);
      const after = db
        .prepare(
          `SELECT used_count FROM durable_search_budget WHERE period_key = ?`,
        )
        .get(args.periodKey) as { used_count: number } | undefined;
      return {
        reserved: Number(r.changes ?? 0) === 1,
        used: after?.used_count ?? current.used_count,
      };
    },
    async tryReserveAlertOpportunity(args) {
      try {
        db.prepare(
          `INSERT INTO durable_alert_opportunities
           (opportunity_key, purchase_id, alert_id, reserved_at, status)
           VALUES (?,?,?,?,'reserved')`,
        ).run(
          args.opportunityKey,
          args.purchaseId,
          args.alertId ?? null,
          args.nowIso,
        );
        return true;
      } catch {
        return false;
      }
    },
    async insertNotificationOutbox(args) {
      try {
        db.prepare(
          `INSERT INTO durable_notification_outbox
           (id, opportunity_key, purchase_id, account_id, alert_id, kind,
            status, reason, attempt_count, recipient_email_hash, evidence_json,
            created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)`,
        ).run(
          args.id,
          args.opportunityKey,
          args.purchaseId,
          args.accountId,
          args.alertId ?? null,
          args.kind,
          args.status,
          args.reason ?? null,
          args.recipientEmailHash ?? null,
          args.evidenceJson ?? null,
          args.nowIso,
          args.nowIso,
        );
        return { id: args.id, created: true };
      } catch {
        const existing = await this.getNotificationOutboxByOpportunity(
          args.opportunityKey,
        );
        // Best-effort: fill evidence_json if previously null
        if (args.evidenceJson && existing) {
          try {
            db.prepare(
              `UPDATE durable_notification_outbox
               SET evidence_json = COALESCE(evidence_json, ?)
               WHERE opportunity_key = ?`,
            ).run(args.evidenceJson, args.opportunityKey);
          } catch {
            /* ignore */
          }
        }
        return { id: existing?.id ?? args.id, created: false };
      }
    },
    async tryLeaseNotificationOutbox(args) {
      // Atomically lease pending/failed_retryable OR reclaim expired sending.
      const r = db
        .prepare(
          `UPDATE durable_notification_outbox
           SET status = 'sending',
               lease_holder = ?,
               lease_expires_at = ?,
               updated_at = ?,
               attempt_count = COALESCE(attempt_count, 0) + 1
           WHERE opportunity_key = ?
             AND (
               (status IN ('pending', 'failed_retryable')
                 AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
               OR
               (status = 'sending'
                 AND lease_expires_at IS NOT NULL
                 AND lease_expires_at <= ?)
             )`,
        )
        .run(
          args.holderId,
          args.leaseExpiresAt,
          args.nowIso,
          args.opportunityKey,
          args.nowIso,
          args.nowIso,
        );
      if (Number(r.changes ?? 0) !== 1) return null;
      return this.getNotificationOutboxByOpportunity(args.opportunityKey);
    },
    async insertSettlementReviewAudit(args) {
      db.prepare(
        `INSERT INTO settlement_review_audit
         (id, payment_id, decision, evidence_source, evidence_ref_hash, reviewer_key_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        args.id,
        args.paymentId,
        args.decision,
        args.evidenceSource,
        args.evidenceRefHash,
        args.reviewerKeyId ?? null,
        args.nowIso,
      );
    },
    async getSettlementRefClaim(settlementRef) {
      const ref = String(settlementRef || "").trim().toLowerCase();
      return (
        (db
          .prepare(
            `SELECT settlement_ref, payment_id, decision FROM settlement_ref_claims
             WHERE settlement_ref = ?`,
          )
          .get(ref) as
          | { settlement_ref: string; payment_id: string; decision: string }
          | undefined) ?? null
      );
    },
    async getMonitoringPassPaymentBySettlementRef(settlementRef) {
      const ref = String(settlementRef || "").trim().toLowerCase();
      return (
        (db
          .prepare(
            `SELECT * FROM monitoring_pass_payments
             WHERE lower(settlement_ref) = ?
             LIMIT 1`,
          )
          .get(ref) as MonitoringPassPaymentRow | undefined) ?? null
      );
    },
    async claimSettlementReviewDecision(args) {
      // Always store/compare lowercase canonical refs.
      const ref = String(args.settlementRef || "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{16,}$/.test(ref)) {
        return { ok: false as const, reason: "conflict" as const };
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const payment = db
          .prepare(`SELECT * FROM monitoring_pass_payments WHERE id = ?`)
          .get(args.paymentId) as MonitoringPassPaymentRow | undefined;
        if (
          !payment ||
          (payment.status !== "settlement_review_required" &&
            payment.status !== "settlement_unknown")
        ) {
          db.exec("ROLLBACK");
          return { ok: false as const, reason: "payment_not_reviewable" as const };
        }

        const otherPay = db
          .prepare(
            `SELECT id FROM monitoring_pass_payments
             WHERE lower(settlement_ref) = ? AND id != ? LIMIT 1`,
          )
          .get(ref, args.paymentId) as { id: string } | undefined;
        if (otherPay) {
          db.exec("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }

        const otherPass = db
          .prepare(
            `SELECT id FROM monitoring_passes
             WHERE lower(settlement_ref) = ? AND payment_id != ? LIMIT 1`,
          )
          .get(ref, args.paymentId) as { id: string } | undefined;
        if (otherPass) {
          db.exec("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }

        const otherAudit = db
          .prepare(
            `SELECT payment_id FROM settlement_review_audit
             WHERE evidence_ref_hash = ? AND payment_id != ? LIMIT 1`,
          )
          .get(args.evidenceRefHash, args.paymentId) as
          | { payment_id: string }
          | undefined;
        if (otherAudit) {
          db.exec("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }

        const existingClaim = db
          .prepare(
            `SELECT payment_id FROM settlement_ref_claims WHERE settlement_ref = ?`,
          )
          .get(ref) as { payment_id: string } | undefined;
        if (existingClaim && existingClaim.payment_id !== args.paymentId) {
          db.exec("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }
        if (!existingClaim) {
          try {
            db.prepare(
              `INSERT INTO settlement_ref_claims
               (settlement_ref, payment_id, decision, claimed_at)
               VALUES (?,?,?,?)`,
            ).run(ref, args.paymentId, args.decision, args.nowIso);
          } catch {
            db.exec("ROLLBACK");
            return { ok: false as const, reason: "ref_already_claimed" as const };
          }
        }

        const paymentStatus =
          args.decision === "settled" ? "settled" : "failed";
        // Failed path still records the bound settlement_ref (canonical) so
        // the same tx cannot unlock another payment.
        const settlementVal = ref;
        db.prepare(
          `UPDATE monitoring_pass_payments
           SET status = ?,
               settlement_ref = ?,
               updated_at = ?,
               payer_address = COALESCE(?, payer_address),
               sanitized_settle_reason = COALESCE(?, sanitized_settle_reason),
               last_provider_operation = 'operator_review'
           WHERE id = ?
             AND status IN ('settlement_review_required', 'settlement_unknown')`,
        ).run(
          paymentStatus,
          settlementVal,
          args.nowIso,
          args.payerAddress ?? null,
          args.sanitizedSettleReason ?? null,
          args.paymentId,
        );

        db.prepare(
          `INSERT INTO settlement_review_audit
           (id, payment_id, decision, evidence_source, evidence_ref_hash, reviewer_key_id, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        ).run(
          args.auditId,
          args.paymentId,
          args.decision,
          args.evidenceSource,
          args.evidenceRefHash,
          args.reviewerKeyId ?? null,
          args.nowIso,
        );

        db.exec("COMMIT");
        return { ok: true as const };
      } catch {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { ok: false as const, reason: "conflict" as const };
      }
    },
    async markNotificationOutboxStatus(args) {
      const r = db
        .prepare(
          `UPDATE durable_notification_outbox
           SET status = ?,
               reason = COALESCE(?, reason),
               updated_at = ?,
               sent_at = COALESCE(?, sent_at),
               next_attempt_at = COALESCE(?, next_attempt_at),
               attempt_count = CASE WHEN ? THEN COALESCE(attempt_count, 0) + 1 ELSE COALESCE(attempt_count, 0) END,
               lease_holder = CASE WHEN ? IN ('sent', 'failed_terminal', 'failed_retryable', 'suppressed', 'pending') THEN NULL ELSE lease_holder END,
               lease_expires_at = CASE WHEN ? IN ('sent', 'failed_terminal', 'failed_retryable', 'suppressed', 'pending') THEN NULL ELSE lease_expires_at END
           WHERE id = ?`,
        )
        .run(
          args.status,
          args.reason ?? null,
          args.nowIso,
          args.sentAt ?? null,
          args.nextAttemptAt ?? null,
          args.incrementAttempt ? 1 : 0,
          args.status,
          args.status,
          args.id,
        );
      return Number(r.changes ?? 0) === 1;
    },
    async getNotificationOutboxByOpportunity(opportunityKey) {
      return (
        (db
          .prepare(
            `SELECT * FROM durable_notification_outbox WHERE opportunity_key = ?`,
          )
          .get(opportunityKey) as DurableNotificationOutboxRow | undefined) ??
        null
      );
    },
    async listDueNotificationOutbox(args) {
      return db
        .prepare(
          `SELECT * FROM durable_notification_outbox
           WHERE (
             status IN ('pending', 'failed_retryable')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ) OR (
             status = 'sending'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?
           )
           ORDER BY created_at ASC
           LIMIT ?`,
        )
        .all(args.nowIso, args.nowIso, args.limit) as DurableNotificationOutboxRow[];
    },
    async tryReserveNotificationRate(args) {
      db.prepare(
        `INSERT INTO durable_account_notification_rate
         (rate_key, account_id, kind, window_start, used_count, updated_at)
         VALUES (?,?,?,?,0,?)
         ON CONFLICT(rate_key) DO NOTHING`,
      ).run(
        args.rateKey,
        args.accountId,
        args.kind,
        args.windowStart,
        args.nowIso,
      );
      const row = db
        .prepare(
          `SELECT used_count FROM durable_account_notification_rate WHERE rate_key = ?`,
        )
        .get(args.rateKey) as { used_count: number } | undefined;
      const used = Number(row?.used_count ?? 0);
      if (used >= args.limitCount) {
        return { reserved: false, used };
      }
      const r = db
        .prepare(
          `UPDATE durable_account_notification_rate
           SET used_count = used_count + 1, updated_at = ?
           WHERE rate_key = ? AND used_count < ?`,
        )
        .run(args.nowIso, args.rateKey, args.limitCount);
      if (Number(r.changes ?? 0) !== 1) {
        const again = db
          .prepare(
            `SELECT used_count FROM durable_account_notification_rate WHERE rate_key = ?`,
          )
          .get(args.rateKey) as { used_count: number } | undefined;
        return { reserved: false, used: Number(again?.used_count ?? used) };
      }
      return { reserved: true, used: used + 1 };
    },
    async releaseNotificationRate(args) {
      db.prepare(
        `UPDATE durable_account_notification_rate
         SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END,
             updated_at = ?
         WHERE rate_key = ?`,
      ).run(args.nowIso, args.rateKey);
    },
    async tryReserveRollingSummarySend(args) {
      const windowMs = args.windowMs ?? 24 * 60 * 60 * 1000;
      const reserveTtlMs = args.reserveTtlMs ?? 60_000;
      const nowMs = Date.parse(args.nowIso);
      const reserveExpires = new Date(nowMs + reserveTtlMs).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO durable_summary_send_state
           (account_id, last_sent_at, reserve_holder, reserve_expires_at, updated_at)
           VALUES (?,NULL,NULL,NULL,?)
           ON CONFLICT(account_id) DO NOTHING`,
        ).run(args.accountId, args.nowIso);
        const row = db
          .prepare(
            `SELECT last_sent_at, reserve_holder, reserve_expires_at
             FROM durable_summary_send_state WHERE account_id = ?`,
          )
          .get(args.accountId) as
          | {
              last_sent_at: string | null;
              reserve_holder: string | null;
              reserve_expires_at: string | null;
            }
          | undefined;
        if (!row) {
          db.exec("ROLLBACK");
          return { reserved: false, reason: "missing_state" };
        }
        if (row.last_sent_at) {
          const lastMs = Date.parse(row.last_sent_at);
          if (!Number.isNaN(lastMs) && nowMs - lastMs < windowMs) {
            db.exec("COMMIT");
            return {
              reserved: false,
              reason: "summary_cooldown",
              last_sent_at: row.last_sent_at,
            };
          }
        }
        const reserveActive =
          row.reserve_holder &&
          row.reserve_expires_at &&
          Date.parse(row.reserve_expires_at) > nowMs;
        if (
          reserveActive &&
          row.reserve_holder !== args.holderId
        ) {
          db.exec("COMMIT");
          return { reserved: false, reason: "reserve_held" };
        }
        db.prepare(
          `UPDATE durable_summary_send_state
           SET reserve_holder = ?, reserve_expires_at = ?, updated_at = ?
           WHERE account_id = ?`,
        ).run(args.holderId, reserveExpires, args.nowIso, args.accountId);
        db.exec("COMMIT");
        return { reserved: true, last_sent_at: row.last_sent_at };
      } catch {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { reserved: false, reason: "conflict" };
      }
    },
    async markRollingSummarySent(args) {
      const r = db
        .prepare(
          `UPDATE durable_summary_send_state
           SET last_sent_at = ?,
               reserve_holder = NULL,
               reserve_expires_at = NULL,
               updated_at = ?
           WHERE account_id = ?
             AND (reserve_holder = ? OR reserve_holder IS NULL)`,
        )
        .run(args.nowIso, args.nowIso, args.accountId, args.holderId);
      return Number(r.changes ?? 0) === 1;
    },
    async releaseRollingSummaryReserve(args) {
      db.prepare(
        `UPDATE durable_summary_send_state
         SET reserve_holder = NULL,
             reserve_expires_at = NULL,
             updated_at = ?
         WHERE account_id = ? AND reserve_holder = ?`,
      ).run(args.nowIso, args.accountId, args.holderId);
    },
  };
}

// --- Postgres adapter ---

let pgPool: pg.Pool | null = null;
let pgSchemaReady = false;

/**
 * Lane 8R.3B bounded database waits. Chosen so the worst case still leaves
 * an A2MCP caller a usable response well inside a request window, and so no
 * registered endpoint can hang indefinitely on an unhealthy database.
 */
export const AUTH_DB_CONNECTION_TIMEOUT_MS = 5_000;
export const AUTH_DB_STATEMENT_TIMEOUT_MS = 8_000;
export const AUTH_DB_IDLE_TIMEOUT_MS = 30_000;

function getPool(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): pg.Pool {
  if (pgPool) return pgPool;
  const url = resolveDatabaseUrl(env);
  if (!url) throw new Error("auth_durable_db_not_configured");
  pgPool = new Pool({
    connectionString: url,
    ssl:
      env.PGSSLMODE === "disable"
        ? undefined
        : { rejectUnauthorized: false },
    max: 4,
    // Lane 8R.3B — bounded waits. `pg` defaults connectionTimeoutMillis to 0
    // (wait forever), which Lane 8R.3A identified as the only genuinely
    // unbounded path on both registered A2MCP endpoints.
    connectionTimeoutMillis: AUTH_DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: AUTH_DB_IDLE_TIMEOUT_MS,
    statement_timeout: AUTH_DB_STATEMENT_TIMEOUT_MS,
    query_timeout: AUTH_DB_STATEMENT_TIMEOUT_MS,
  });
  return pgPool;
}

export function createPostgresAuthStore(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AuthStore {
  const pool = getPool(env);

  async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    try {
      return await pool.query<T>(text, params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("nobu_auth_postgres_error", {
        message: message.slice(0, 200),
      });
      throw new Error(`auth_postgres_error`);
    }
  }

  return {
    kind: "postgres",
    async ensureSchema() {
      if (pgSchemaReady) return;
      await q(AUTH_DURABLE_SCHEMA_SQL);
      for (const patch of AUTH_DURABLE_SCHEMA_PATCHES) {
        try {
          await q(patch);
        } catch {
          /* column may already exist */
        }
      }
      pgSchemaReady = true;
    },
    async getAccountById(id) {
      const r = await q<AccountRow>(
        `SELECT * FROM auth_accounts WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async getAccountByEmail(emailNormalized) {
      const r = await q<AccountRow>(
        `SELECT * FROM auth_accounts WHERE email_normalized = $1`,
        [emailNormalized],
      );
      return r.rows[0] ?? null;
    },
    async upsertAccountForEmail(emailNormalized, nowIso) {
      const existing = await this.getAccountByEmail(emailNormalized);
      if (existing) return existing;
      const id = mintAccountId();
      await q(
        `INSERT INTO auth_accounts (id, email_normalized, email_verified_at, created_at, updated_at)
         VALUES ($1,$2,NULL,$3,$4)
         ON CONFLICT (email_normalized) DO NOTHING`,
        [id, emailNormalized, nowIso, nowIso],
      );
      return (await this.getAccountByEmail(emailNormalized))!;
    },
    async markAccountVerified(accountId, nowIso) {
      await q(
        `UPDATE auth_accounts
         SET email_verified_at = COALESCE(email_verified_at, $1), updated_at = $2
         WHERE id = $3`,
        [nowIso, nowIso, accountId],
      );
    },
    async insertLoginToken(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? AUTH_LOGIN_TOKEN_TTL_MS),
      ).toISOString();
      const id = newId("tok");
      const token_hash = sha256Hex(args.rawToken);
      await q(
        `INSERT INTO auth_login_tokens
         (id, email_normalized, token_hash, expires_at, used_at, created_at, request_ip_hash, guest_owner_ref)
         VALUES ($1,$2,$3,$4,NULL,$5,NULL,$6)`,
        [
          id,
          args.emailNormalized,
          token_hash,
          expires,
          nowIso,
          args.guestOwnerRef,
        ],
      );
      return {
        id,
        email_normalized: args.emailNormalized,
        token_hash,
        expires_at: expires,
        used_at: null,
        created_at: nowIso,
        guest_owner_ref: args.guestOwnerRef,
      };
    },
    async findLoginTokenByHash(tokenHash) {
      const r = await q<LoginTokenRow>(
        `SELECT * FROM auth_login_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      return r.rows[0] ?? null;
    },
    async markLoginTokenUsed(tokenId, nowIso) {
      const r = await q(
        `UPDATE auth_login_tokens SET used_at = $1
         WHERE id = $2 AND used_at IS NULL`,
        [nowIso, tokenId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async createSession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const maxAge = args.maxAgeSeconds ?? AUTH_SESSION_MAX_AGE_SECONDS;
      const expires = new Date(now.getTime() + maxAge * 1000).toISOString();
      const id = newId("sess");
      const token_hash = sha256Hex(args.rawSessionToken);
      await q(
        `INSERT INTO auth_sessions
         (id, account_id, token_hash, expires_at, revoked_at, created_at, last_seen_at)
         VALUES ($1,$2,$3,$4,NULL,$5,$6)`,
        [id, args.accountId, token_hash, expires, nowIso, nowIso],
      );
      return {
        id,
        account_id: args.accountId,
        token_hash,
        expires_at: expires,
        revoked_at: null,
        created_at: nowIso,
        last_seen_at: nowIso,
      };
    },
    async findSessionByTokenHash(tokenHash) {
      const r = await q<SessionRow>(
        `SELECT * FROM auth_sessions WHERE token_hash = $1`,
        [tokenHash],
      );
      return r.rows[0] ?? null;
    },
    async revokeSession(sessionId, nowIso) {
      await q(
        `UPDATE auth_sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL`,
        [nowIso, sessionId],
      );
    },
    async touchSession(sessionId, nowIso) {
      await q(`UPDATE auth_sessions SET last_seen_at = $1 WHERE id = $2`, [
        nowIso,
        sessionId,
      ]);
    },
    async consumeRateLimit(args) {
      const now = args.now ?? new Date();
      const windowMs = args.windowMs ?? AUTH_RATE_LIMIT_WINDOW_MS;
      const maxHits = args.maxHits ?? AUTH_RATE_LIMIT_MAX;
      const r = await q<{ window_started_at: string; hit_count: number }>(
        `SELECT * FROM auth_rate_limits WHERE bucket_key = $1`,
        [args.bucketKey],
      );
      const row = r.rows[0];
      if (!row) {
        await q(
          `INSERT INTO auth_rate_limits (bucket_key, window_started_at, hit_count)
           VALUES ($1,$2,1)
           ON CONFLICT (bucket_key) DO NOTHING`,
          [args.bucketKey, now.toISOString()],
        );
        return true;
      }
      const started = Date.parse(row.window_started_at);
      if (!Number.isFinite(started) || now.getTime() - started > windowMs) {
        await q(
          `UPDATE auth_rate_limits SET window_started_at = $1, hit_count = 1 WHERE bucket_key = $2`,
          [now.toISOString(), args.bucketKey],
        );
        return true;
      }
      if (row.hit_count >= maxHits) return false;
      await q(
        `UPDATE auth_rate_limits SET hit_count = hit_count + 1 WHERE bucket_key = $1`,
        [args.bucketKey],
      );
      return true;
    },
    async recordClaimEvent(args) {
      const prior = await q<{ purchases_claimed: number }>(
        `SELECT purchases_claimed FROM auth_claim_events
         WHERE account_id = $1 AND guest_owner_ref = $2`,
        [args.accountId, args.guestOwnerRef],
      );
      if (prior.rows[0]) {
        return {
          already: true,
          claimed: prior.rows[0].purchases_claimed,
        };
      }
      try {
        await q(
          `INSERT INTO auth_claim_events (id, account_id, guest_owner_ref, purchases_claimed, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            newId("claim"),
            args.accountId,
            args.guestOwnerRef,
            args.purchasesClaimed,
            args.nowIso,
          ],
        );
        return { already: false, claimed: args.purchasesClaimed };
      } catch {
        const again = await q<{ purchases_claimed: number }>(
          `SELECT purchases_claimed FROM auth_claim_events
           WHERE account_id = $1 AND guest_owner_ref = $2`,
          [args.accountId, args.guestOwnerRef],
        );
        if (again.rows[0]) {
          return {
            already: true,
            claimed: again.rows[0].purchases_claimed,
          };
        }
        throw new Error("auth_claim_event_failed");
      }
    },
    async savePurchaseBlob(args) {
      const existing = await q<{
        archived_at: string | null;
        user_outcome: string | null;
        user_outcome_at: string | null;
        email_alerts_enabled: number | null;
        email_alerts_consent_at: string | null;
        email_alerts_disabled_at: string | null;
      }>(
        `SELECT archived_at, user_outcome, user_outcome_at,
                email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at
         FROM account_purchase_blobs WHERE purchase_id = $1`,
        [args.purchaseId],
      );
      const prev = existing.rows[0];
      const archived =
        args.archived_at !== undefined
          ? args.archived_at
          : (prev?.archived_at ?? null);
      const outcome =
        args.user_outcome !== undefined
          ? args.user_outcome
          : (prev?.user_outcome ?? null);
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : (prev?.user_outcome_at ?? null);
      const emailOn = prev?.email_alerts_enabled ?? 0;
      const emailConsent = prev?.email_alerts_consent_at ?? null;
      const emailDisabled = prev?.email_alerts_disabled_at ?? null;
      await q(
        `INSERT INTO account_purchase_blobs
         (purchase_id, account_id, blob_json, updated_at, archived_at, user_outcome, user_outcome_at,
          email_alerts_enabled, email_alerts_consent_at, email_alerts_disabled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (purchase_id) DO UPDATE SET
           account_id = EXCLUDED.account_id,
           blob_json = EXCLUDED.blob_json,
           updated_at = EXCLUDED.updated_at,
           archived_at = EXCLUDED.archived_at,
           user_outcome = EXCLUDED.user_outcome,
           user_outcome_at = EXCLUDED.user_outcome_at`,
        [
          args.purchaseId,
          args.accountId,
          args.blobJson,
          args.nowIso,
          archived,
          outcome,
          outcomeAt,
          emailOn,
          emailConsent,
          emailDisabled,
        ],
      );
    },
    async listPurchaseBlobs(accountId) {
      const r = await q<PurchaseBlobRow>(
        `SELECT * FROM account_purchase_blobs WHERE account_id = $1 ORDER BY updated_at DESC`,
        [accountId],
      );
      return r.rows;
    },
    async getPurchaseBlob(accountId, purchaseId) {
      const r = await q<PurchaseBlobRow>(
        `SELECT * FROM account_purchase_blobs WHERE account_id = $1 AND purchase_id = $2`,
        [accountId, purchaseId],
      );
      return r.rows[0] ?? null;
    },
    async updatePurchaseLifecycleMeta(args) {
      const row = await this.getPurchaseBlob(args.accountId, args.purchaseId);
      if (!row) return false;
      const archived =
        args.archived_at !== undefined ? args.archived_at : row.archived_at;
      const outcome =
        args.user_outcome !== undefined ? args.user_outcome : row.user_outcome;
      const outcomeAt =
        args.user_outcome_at !== undefined
          ? args.user_outcome_at
          : row.user_outcome_at;
      const emailOn =
        args.email_alerts_enabled !== undefined
          ? args.email_alerts_enabled
          : (row.email_alerts_enabled ?? 0);
      const emailConsent =
        args.email_alerts_consent_at !== undefined
          ? args.email_alerts_consent_at
          : (row.email_alerts_consent_at ?? null);
      const emailDisabled =
        args.email_alerts_disabled_at !== undefined
          ? args.email_alerts_disabled_at
          : (row.email_alerts_disabled_at ?? null);
      await q(
        `UPDATE account_purchase_blobs
         SET archived_at = $1, user_outcome = $2, user_outcome_at = $3,
             email_alerts_enabled = $4, email_alerts_consent_at = $5,
             email_alerts_disabled_at = $6, updated_at = $7
         WHERE account_id = $8 AND purchase_id = $9`,
        [
          archived,
          outcome,
          outcomeAt,
          emailOn,
          emailConsent,
          emailDisabled,
          args.nowIso,
          args.accountId,
          args.purchaseId,
        ],
      );
      return true;
    },
    async deletePurchaseBlob(args) {
      const r = await q(
        `DELETE FROM account_purchase_blobs WHERE account_id = $1 AND purchase_id = $2`,
        [args.accountId, args.purchaseId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async insertAgentConnection(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("conn");
      await q(
        `INSERT INTO agent_connections
         (id, account_id, email_normalized, connection_token_hash, credential_expires_at,
          credential_rotated_at, status, revoked_at, created_at, last_used_at)
         VALUES ($1,NULL,$2,NULL,NULL,NULL,'pending',NULL,$3,NULL)`,
        [id, args.emailNormalized, nowIso],
      );
      return (await this.getAgentConnectionById(id))!;
    },
    async getAgentConnectionById(id) {
      const r = await q<AgentConnectionRow>(
        `SELECT * FROM agent_connections WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async setAgentConnectionCredential(args) {
      const r = await q(
        `UPDATE agent_connections
         SET connection_token_hash = $1,
             credential_expires_at = $2,
             credential_rotated_at = $3,
             status = 'active',
             account_id = COALESCE($4, account_id)
         WHERE id = $5 AND status != 'revoked'`,
        [
          args.tokenHash,
          args.expiresAt,
          args.nowIso,
          args.accountId ?? null,
          args.connectionId,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async revokeAgentConnection(args) {
      const r = await q(
        `UPDATE agent_connections
         SET status = 'revoked', revoked_at = $1, connection_token_hash = NULL
         WHERE id = $2 AND status != 'revoked'`,
        [args.nowIso, args.connectionId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async touchAgentConnectionLastUsed(args) {
      await q(
        `UPDATE agent_connections SET last_used_at = $1 WHERE id = $2`,
        [args.nowIso, args.connectionId],
      );
    },
    async insertAgentEmailCode(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 10 * 60 * 1000),
      ).toISOString();
      const id = newId("aec");
      const code_hash = sha256Hex(args.rawCode);
      await q(
        `INSERT INTO agent_email_codes
         (id, connection_id, email_normalized, code_hash, expires_at, attempt_count, used_at, created_at)
         VALUES ($1,$2,$3,$4,$5,0,NULL,$6)`,
        [id, args.connectionId, args.emailNormalized, code_hash, expires, nowIso],
      );
      return {
        id,
        connection_id: args.connectionId,
        email_normalized: args.emailNormalized,
        code_hash,
        expires_at: expires,
        attempt_count: 0,
        used_at: null,
        created_at: nowIso,
      };
    },
    async findLatestAgentEmailCode(connectionId) {
      const r = await q<AgentEmailCodeRow>(
        `SELECT * FROM agent_email_codes
         WHERE connection_id = $1 AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [connectionId],
      );
      return r.rows[0] ?? null;
    },
    async markAgentEmailCodeUsed(codeId, nowIso) {
      const r = await q(
        `UPDATE agent_email_codes SET used_at = $1 WHERE id = $2 AND used_at IS NULL`,
        [nowIso, codeId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async incrementAgentEmailCodeAttempt(codeId) {
      const r = await q<{ attempt_count: number }>(
        `UPDATE agent_email_codes SET attempt_count = attempt_count + 1
         WHERE id = $1 RETURNING attempt_count`,
        [codeId],
      );
      return r.rows[0]?.attempt_count ?? 0;
    },

    async insertDiscoverySession(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 30 * 60 * 1000),
      ).toISOString();
      const id = newId("disc");
      await q(
        `INSERT INTO discovery_sessions
         (id, structured_snapshot_json, purchase_text_hash, candidates_snapshot_json,
          selected_candidate_id, locked_fingerprint_snapshot_json, status,
          materialized_purchase_id, created_at, expires_at)
         VALUES ($1,$2,$3,$4,NULL,NULL,'discovering',NULL,$5,$6)`,
        [
          id,
          args.structuredSnapshotJson,
          args.purchaseTextHash,
          args.candidatesSnapshotJson,
          nowIso,
          expires,
        ],
      );
      return (await this.getDiscoverySessionById(id))!;
    },
    async getDiscoverySessionById(id) {
      const r = await q<DiscoverySessionRow>(
        `SELECT * FROM discovery_sessions WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async confirmDiscoverySession(args) {
      const r = await q(
        `UPDATE discovery_sessions
         SET selected_candidate_id = $1, locked_fingerprint_snapshot_json = $2, status = 'confirmed'
         WHERE id = $3 AND status IN ('discovering', 'confirmed')`,
        [
          args.selectedCandidateId,
          args.lockedFingerprintSnapshotJson,
          args.sessionId,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async reserveDiscoverySessionMaterialization(args) {
      const r = await q(
        `UPDATE discovery_sessions
         SET status = 'materialized', materialized_purchase_id = $1
         WHERE id = $2 AND status = 'confirmed'`,
        [args.purchaseId, args.sessionId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async insertMonitoringEnrollmentQuote(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const expires = new Date(
        now.getTime() + (args.ttlMs ?? 15 * 60 * 1000),
      ).toISOString();
      const id = newId("quote");
      await q(
        `INSERT INTO monitoring_enrollment_quotes
         (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
          price_currency, settlement_asset, settlement_network, monitoring_deadline,
          consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,$8,$9,$10,'issued',$11,$12)`,
        [
          id,
          args.connectionId,
          args.accountId,
          args.purchaseId,
          args.fingerprintId,
          args.priceAmount,
          args.priceCurrency,
          args.monitoringDeadline,
          args.consentMonitoringAt,
          args.consentEmailAlertsAt,
          expires,
          nowIso,
        ],
      );
      return {
        id,
        connection_id: args.connectionId,
        account_id: args.accountId,
        purchase_id: args.purchaseId,
        fingerprint_id: args.fingerprintId,
        price_amount: args.priceAmount,
        price_currency: args.priceCurrency,
        settlement_asset: null,
        settlement_network: null,
        monitoring_deadline: args.monitoringDeadline,
        consent_monitoring_at: args.consentMonitoringAt,
        consent_email_alerts_at: args.consentEmailAlertsAt,
        status: "issued",
        expires_at: expires,
        created_at: nowIso,
      };
    },
    async getActiveMonitoringEnrollmentQuote(purchaseId, nowIso) {
      const r = await q<MonitoringEnrollmentQuoteRow>(
        `SELECT * FROM monitoring_enrollment_quotes
         WHERE purchase_id = $1 AND status = 'issued' AND expires_at > $2
         ORDER BY created_at DESC LIMIT 1`,
        [purchaseId, nowIso],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringEnrollmentQuoteById(quoteId) {
      const r = await q<MonitoringEnrollmentQuoteRow>(
        `SELECT * FROM monitoring_enrollment_quotes WHERE id = $1`,
        [quoteId],
      );
      return r.rows[0] ?? null;
    },

    async getLatestPaymentAttemptForQuote(quoteId) {
      const r = await q<PaymentAttemptRow>(
        `SELECT * FROM payment_attempts WHERE quote_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [quoteId],
      );
      return r.rows[0] ?? null;
    },
    async insertPaymentAttempt(args) {
      const now = args.now ?? new Date();
      const nowIso = now.toISOString();
      const id = newId("pay");
      await q(
        `INSERT INTO payment_attempts
         (id, quote_id, x402_challenge_ref, status, settlement_ref, created_at, settled_at)
         VALUES ($1,$2,$3,'challenged',NULL,$4,NULL)`,
        [id, args.quoteId, args.challengeRef, nowIso],
      );
      return {
        id,
        quote_id: args.quoteId,
        x402_challenge_ref: args.challengeRef,
        status: "challenged",
        settlement_ref: null,
        created_at: nowIso,
        settled_at: null,
      };
    },
    async markPaymentAttemptVerifying(args) {
      const r = await q(
        `UPDATE payment_attempts
         SET status = 'verifying', settlement_ref = $1
         WHERE id = $2 AND status IN ('challenged', 'verifying')`,
        [args.settlementRef, args.attemptId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async getMonitorActivationByQuoteId(quoteId) {
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations WHERE quote_id = $1`,
        [quoteId],
      );
      return r.rows[0] ?? null;
    },
    async getActiveMonitorActivationByPurchaseId(purchaseId) {
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations
         WHERE purchase_id = $1 AND status = 'active'
         ORDER BY created_at ASC LIMIT 1`,
        [purchaseId],
      );
      return r.rows[0] ?? null;
    },
    async recordSettledPaymentAndActivation(args) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `UPDATE payment_attempts
           SET status = 'settled', settlement_ref = $1, settled_at = $2
           WHERE id = $3 AND status != 'settled'`,
          [args.settlementRef, args.nowIso, args.paymentAttemptId],
        );

        const quoteResult = await client.query(
          `UPDATE monitoring_enrollment_quotes
           SET status = 'consumed'
           WHERE id = $1 AND status = 'issued'`,
          [args.quoteId],
        );

        // Only insert when THIS call is the one that just consumed the
        // quote — never insert an activation for a quote that was not (by
        // this transaction) legitimately transitioned from 'issued'.
        if ((quoteResult.rowCount ?? 0) > 0) {
          await client.query(
            `INSERT INTO monitor_activations
             (id, quote_id, activation_key, payment_attempt_id, purchase_id,
              fingerprint_id, monitor_id, status, created_at, projected_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_projection',$8,NULL)
             ON CONFLICT (quote_id) DO NOTHING`,
            [
              args.activationId,
              args.quoteId,
              args.activationKey,
              args.paymentAttemptId,
              args.purchaseId,
              args.fingerprintId,
              args.purchaseId,
              args.nowIso,
            ],
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        // A concurrent replay can lose a UNIQUE-constraint race after
        // already losing the quote-consumption race — a lost race, not a
        // failure: fall through to the post-transaction read below.
        if (!isUniqueViolationError(err)) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("nobu_auth_postgres_error", {
            message: message.slice(0, 200),
          });
          throw new Error("auth_postgres_error");
        }
      } finally {
        client.release();
      }

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async markMonitorActivationActive(args) {
      const r = await q(
        `UPDATE monitor_activations
         SET status = 'active', projected_at = $1
         WHERE id = $2 AND status != 'active'`,
        [args.nowIso, args.activationId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async listPendingProjectionActivations() {
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations WHERE status = 'pending_projection'
         ORDER BY created_at ASC`,
      );
      return r.rows;
    },
    async getMonitoringPassPaymentByDigest(authorizationDigest) {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments WHERE authorization_digest = $1`,
        [authorizationDigest],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassPaymentById(paymentId) {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments WHERE id = $1`,
        [paymentId],
      );
      return r.rows[0] ?? null;
    },
    async upsertMonitoringPassPayment(args) {
      const status = args.status ?? "authorization_received";
      await q(
        `INSERT INTO monitoring_pass_payments
         (id, authorization_digest, status, settlement_ref, attempt_count, created_at, updated_at)
         VALUES ($1,$2,$3,NULL,0,$4,$4)
         ON CONFLICT (authorization_digest) DO NOTHING`,
        [args.id, args.authorizationDigest, status, args.nowIso],
      );
      return (await this.getMonitoringPassPaymentByDigest(
        args.authorizationDigest,
      ))!;
    },
    async updateMonitoringPassPayment(args) {
      const settlementRef =
        args.settlementRef == null
          ? null
          : String(args.settlementRef).trim().toLowerCase() || null;
      const r = await q(
        `UPDATE monitoring_pass_payments
         SET status = $1,
             settlement_ref = $2,
             updated_at = $3,
             payer_address = COALESCE($4, payer_address),
             sanitized_verify_reason = COALESCE($5, sanitized_verify_reason),
             sanitized_settle_reason = COALESCE($6, sanitized_settle_reason),
             last_provider_operation = COALESCE($7, last_provider_operation),
             attempt_count = CASE WHEN $8 THEN COALESCE(attempt_count, 0) + 1 ELSE COALESCE(attempt_count, 0) END,
             provider_payment_id = COALESCE($9, provider_payment_id),
             provider_authorization_id = COALESCE($10, provider_authorization_id)
         WHERE id = $11`,
        [
          args.status,
          settlementRef,
          args.nowIso,
          args.payerAddress ?? null,
          args.sanitizedVerifyReason ?? null,
          args.sanitizedSettleReason ?? null,
          args.lastProviderOperation ?? null,
          args.incrementAttempt === true,
          args.providerPaymentId ?? null,
          args.providerAuthorizationId ?? null,
          args.id,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async listVerifyingMonitoringPassPayments() {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments
         WHERE status IN ('verifying', 'settlement_pending', 'settlement_unknown')
           AND settlement_ref IS NOT NULL
         ORDER BY created_at ASC`,
      );
      return r.rows;
    },
    async listReconcileableMonitoringPassPayments() {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments
         WHERE status IN ('verifying', 'settlement_pending', 'settlement_unknown', 'settled')
         ORDER BY created_at ASC`,
      );
      return r.rows;
    },
    async listSettledMonitoringPassPaymentsWithoutPass() {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT p.* FROM monitoring_pass_payments p
         WHERE p.status = 'settled'
           AND p.settlement_ref IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM monitoring_passes m
             WHERE m.settlement_ref = p.settlement_ref
                OR m.payment_id = p.id
           )
         ORDER BY p.created_at ASC`,
      );
      return r.rows;
    },
    async getMonitoringPassBySettlementRef(settlementRef) {
      const ref = String(settlementRef || "").trim().toLowerCase();
      const r = await q<MonitoringPassRow>(
        `SELECT * FROM monitoring_passes WHERE lower(settlement_ref) = $1`,
        [ref],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassById(passId) {
      const r = await q<MonitoringPassRow>(
        `SELECT * FROM monitoring_passes WHERE id = $1`,
        [passId],
      );
      return r.rows[0] ?? null;
    },
    async issueMonitoringPass(args) {
      const settlementRef = String(args.settlementRef || "")
        .trim()
        .toLowerCase();
      await q(
        `INSERT INTO monitoring_passes
         (id, pass_token_hash, settlement_ref, payment_id, price_amount,
          price_currency, status, payer_address, redeemed_at, redeemed_quote_id,
          redeemed_purchase_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,NULL,NULL,NULL,$8,$8)
         ON CONFLICT (settlement_ref) DO NOTHING`,
        [
          args.id,
          args.passTokenHash,
          settlementRef,
          args.paymentId,
          args.priceAmount,
          args.priceCurrency,
          args.payerAddress ?? null,
          args.nowIso,
        ],
      );
      const pass = (await this.getMonitoringPassBySettlementRef(
        settlementRef,
      ))!;
      return {
        outcome:
          pass.id === args.id ? ("issued" as const) : ("already_existed" as const),
        pass,
      };
    },
    async ensureMonitoringPassContinuation(args) {
      const status =
        args.status ??
        (args.monitoringPassId ? ("issued" as const) : ("pending" as const));
      await q(
        `INSERT INTO monitoring_pass_continuations
         (id, payment_id, monitoring_pass_id, status, claim_credential_hash,
          created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (payment_id) DO NOTHING`,
        [
          args.id,
          args.paymentId,
          args.monitoringPassId ?? null,
          status,
          args.claimCredentialHash ?? null,
          args.nowIso,
        ],
      );
      if (args.monitoringPassId) {
        await q(
          `UPDATE monitoring_pass_continuations
           SET monitoring_pass_id = $1, status = 'issued', updated_at = $2
           WHERE payment_id = $3
             AND (monitoring_pass_id IS NULL OR status <> 'issued')`,
          [args.monitoringPassId, args.nowIso, args.paymentId],
        );
      }
      if (args.claimCredentialHash) {
        await q(
          `UPDATE monitoring_pass_continuations
           SET claim_credential_hash = COALESCE(claim_credential_hash, $1)
           WHERE payment_id = $2`,
          [args.claimCredentialHash, args.paymentId],
        );
      }
      return (await this.getMonitoringPassContinuationByPaymentId(
        args.paymentId,
      ))!;
    },
    async markMonitoringPassContinuationIssued(args) {
      await q(
        `UPDATE monitoring_pass_continuations
         SET monitoring_pass_id = $1, status = 'issued', updated_at = $2
         WHERE payment_id = $3`,
        [args.monitoringPassId, args.nowIso, args.paymentId],
      );
      return this.getMonitoringPassContinuationByPaymentId(args.paymentId);
    },
    async consumeContinuationClaimCredential(args) {
      const r = await q(
        `UPDATE monitoring_pass_continuations
         SET claim_credential_consumed_at = $1, updated_at = $1
         WHERE id = $2
           AND claim_credential_hash = $3
           AND claim_credential_consumed_at IS NULL`,
        [args.nowIso, args.continuationId, args.claimCredentialHash],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async claimPassAndCreateJourney(args) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const contRes = await client.query(
          `SELECT * FROM monitoring_pass_continuations WHERE id = $1`,
          [args.continuationId],
        );
        const cont = contRes.rows[0] as
          | MonitoringPassContinuationRow
          | undefined;
        if (!cont) {
          await client.query("ROLLBACK");
          return { outcome: "claim_invalid" as const };
        }
        if (
          cont.monitoring_pass_id &&
          cont.monitoring_pass_id !== args.monitoringPassId
        ) {
          await client.query("ROLLBACK");
          return { outcome: "pass_mismatch" as const };
        }
        if (
          !cont.claim_credential_hash ||
          cont.claim_credential_hash !== args.claimCredentialHash
        ) {
          await client.query("ROLLBACK");
          return { outcome: "claim_invalid" as const };
        }
        if (cont.claim_credential_consumed_at) {
          const existing = await client.query(
            `SELECT * FROM marketplace_purchase_journeys WHERE monitoring_pass_id = $1`,
            [args.monitoringPassId],
          );
          await client.query("COMMIT");
          if (existing.rows[0]) {
            return {
              outcome: "already_existed" as const,
              journey: existing.rows[0] as MarketplacePurchaseJourneyRow,
            };
          }
          return { outcome: "claim_invalid" as const };
        }
        await client.query(
          `INSERT INTO marketplace_purchase_journeys
           (id, monitoring_pass_id, pass_continuation_id, stage, created_at, updated_at)
           VALUES ($1,$2,$3,'confirm_use_pass',$4,$4)
           ON CONFLICT (monitoring_pass_id) DO NOTHING`,
          [
            args.journeyId,
            args.monitoringPassId,
            args.continuationId,
            args.nowIso,
          ],
        );
        const journeyRes = await client.query(
          `SELECT * FROM marketplace_purchase_journeys WHERE monitoring_pass_id = $1`,
          [args.monitoringPassId],
        );
        const journey = journeyRes.rows[0] as MarketplacePurchaseJourneyRow;
        await client.query(
          `UPDATE monitoring_pass_continuations
           SET claim_credential_consumed_at = $1,
               monitoring_pass_id = COALESCE(monitoring_pass_id, $2),
               status = 'claimed',
               updated_at = $1
           WHERE id = $3
             AND claim_credential_hash = $4
             AND claim_credential_consumed_at IS NULL`,
          [
            args.nowIso,
            args.monitoringPassId,
            args.continuationId,
            args.claimCredentialHash,
          ],
        );
        await client.query("COMMIT");
        return {
          outcome:
            journey.id === args.journeyId
              ? ("created" as const)
              : ("already_existed" as const),
          journey,
        };
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async getMonitoringPassContinuationById(id) {
      const r = await q<MonitoringPassContinuationRow>(
        `SELECT * FROM monitoring_pass_continuations WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassContinuationByPaymentId(paymentId) {
      const r = await q<MonitoringPassContinuationRow>(
        `SELECT * FROM monitoring_pass_continuations WHERE payment_id = $1`,
        [paymentId],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassContinuationByPassId(passId) {
      const r = await q<MonitoringPassContinuationRow>(
        `SELECT * FROM monitoring_pass_continuations WHERE monitoring_pass_id = $1`,
        [passId],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassByPaymentId(paymentId) {
      const r = await q<MonitoringPassRow>(
        `SELECT * FROM monitoring_passes WHERE payment_id = $1`,
        [paymentId],
      );
      return r.rows[0] ?? null;
    },
    async ensureMarketplacePurchaseJourney(args) {
      await q(
        `INSERT INTO marketplace_purchase_journeys
         (id, monitoring_pass_id, pass_continuation_id, stage, created_at, updated_at)
         VALUES ($1,$2,$3,'confirm_use_pass',$4,$4)
         ON CONFLICT (monitoring_pass_id) DO NOTHING`,
        [
          args.id,
          args.monitoringPassId,
          args.passContinuationId ?? null,
          args.nowIso,
        ],
      );
      return (await this.getMarketplacePurchaseJourneyByPassId(
        args.monitoringPassId,
      ))!;
    },
    async getMarketplacePurchaseJourneyById(id) {
      const r = await q<MarketplacePurchaseJourneyRow>(
        `SELECT * FROM marketplace_purchase_journeys WHERE id = $1`,
        [id],
      );
      return r.rows[0] ?? null;
    },
    async getMarketplacePurchaseJourneyByPassId(passId) {
      const r = await q<MarketplacePurchaseJourneyRow>(
        `SELECT * FROM marketplace_purchase_journeys WHERE monitoring_pass_id = $1`,
        [passId],
      );
      return r.rows[0] ?? null;
    },
    async updateMarketplacePurchaseJourney(args) {
      const r = await q<MarketplacePurchaseJourneyRow>(
        `UPDATE marketplace_purchase_journeys
         SET stage = $1,
             purchase_snapshot_json = COALESCE($2, purchase_snapshot_json),
             discovery_session_id = COALESCE($3, discovery_session_id),
             fingerprint_id = COALESCE($4, fingerprint_id),
             connection_id = COALESCE($5, connection_id),
             quote_id = COALESCE($6, quote_id),
             updated_at = $7
         WHERE id = $8
         RETURNING *`,
        [
          args.stage,
          args.purchaseSnapshotJson ?? null,
          args.discoverySessionId ?? null,
          args.fingerprintId ?? null,
          args.connectionId ?? null,
          args.quoteId ?? null,
          args.nowIso,
          args.id,
        ],
      );
      return r.rows[0] ?? null;
    },
    async listSettledPassPaymentsMissingContinuation() {
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT p.* FROM monitoring_pass_payments p
         INNER JOIN monitoring_passes m ON m.payment_id = p.id
         WHERE p.status = 'settled'
           AND NOT EXISTS (
             SELECT 1 FROM monitoring_pass_continuations c
             WHERE c.payment_id = p.id
           )
         ORDER BY p.created_at ASC`,
      );
      return r.rows;
    },
    async redeemMonitoringPassAndActivate(args) {
      const before = await this.getMonitoringPassById(args.passId);
      if (
        before &&
        before.status === "redeemed" &&
        before.redeemed_quote_id === args.quoteId
      ) {
        const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
        if (existing) {
          return { outcome: "already_existed" as const, activation: existing };
        }
      }

      const client = await pool.connect();
      let claimFailure: "pass_not_redeemable" | "quote_not_issued" | null = null;
      try {
        await client.query("BEGIN");
        const passResult = await client.query(
          `UPDATE monitoring_passes
           SET status = 'redeemed', redeemed_at = $1, redeemed_quote_id = $2,
               redeemed_purchase_id = $3, updated_at = $1
           WHERE id = $4 AND status = 'issued'`,
          [args.nowIso, args.quoteId, args.purchaseId, args.passId],
        );
        if ((passResult.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          claimFailure = "pass_not_redeemable";
        } else {
          const quoteResult = await client.query(
            `UPDATE monitoring_enrollment_quotes
             SET status = 'consumed'
             WHERE id = $1 AND status = 'issued'`,
            [args.quoteId],
          );
          if ((quoteResult.rowCount ?? 0) === 0) {
            // Never consume a pass for a quote this transaction could not claim.
            await client.query("ROLLBACK");
            claimFailure = "quote_not_issued";
          } else {
            await client.query(
              `INSERT INTO monitor_activations
               (id, quote_id, activation_key, payment_attempt_id, purchase_id,
                fingerprint_id, monitor_id, status, created_at, projected_at,
                monitoring_pass_id)
               VALUES ($1,$2,$3,$4,$5,$6,$5,'pending_projection',$7,NULL,$4)
               ON CONFLICT (quote_id) DO NOTHING`,
              [
                args.activationId,
                args.quoteId,
                args.activationKey,
                args.passId,
                args.purchaseId,
                args.fingerprintId,
                args.nowIso,
              ],
            );
            await client.query("COMMIT");
          }
        }
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        if (!isUniqueViolationError(err)) {
          client.release();
          throw err;
        }
      } finally {
        client.release();
      }

      if (claimFailure) return { outcome: claimFailure };

      const existing = await this.getMonitorActivationByQuoteId(args.quoteId);
      if (existing && existing.id === args.activationId) {
        return { outcome: "recorded" as const, activation: existing };
      }
      if (existing) {
        return { outcome: "already_existed" as const, activation: existing };
      }
      return { outcome: "quote_not_issued" as const };
    },
    async expireIssuedEnrollmentQuotesForPurchase(args) {
      const r = await q(
        `UPDATE monitoring_enrollment_quotes
         SET status = 'expired'
         WHERE purchase_id = $1
           AND status = 'issued'
           AND ($2::text IS NULL OR id <> $2)`,
        [args.purchaseId, args.exceptQuoteId ?? null],
      );
      return r.rowCount ?? 0;
    },
    async replaceIssuedEnrollmentQuote(args) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE monitoring_enrollment_quotes
           SET status = 'expired'
           WHERE purchase_id = $1 AND status = 'issued'`,
          [args.purchaseId],
        );
        const existing = await client.query(
          `SELECT * FROM monitoring_enrollment_quotes
           WHERE purchase_id = $1 AND status = 'issued' AND expires_at > $2
           ORDER BY created_at DESC LIMIT 1`,
          [args.purchaseId, args.nowIso],
        );
        if (existing.rows[0]) {
          await client.query("COMMIT");
          return {
            outcome: "existing_unexpired" as const,
            quote: existing.rows[0] as MonitoringEnrollmentQuoteRow,
            supersededIds: [],
          };
        }
        await client.query(
          `INSERT INTO monitoring_enrollment_quotes
           (id, connection_id, account_id, purchase_id, fingerprint_id, price_amount,
            price_currency, settlement_asset, settlement_network, monitoring_deadline,
            consent_monitoring_at, consent_email_alerts_at, status, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'issued',$13,$14)`,
          [
            args.id,
            args.connectionId,
            args.accountId,
            args.purchaseId,
            args.fingerprintId,
            args.priceAmount,
            args.priceCurrency,
            args.settlementAsset,
            args.settlementNetwork,
            args.monitoringDeadline,
            args.consentMonitoringAt,
            args.consentEmailAlertsAt,
            args.expiresAt,
            args.nowIso,
          ],
        );
        await client.query("COMMIT");
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        const winner = await this.getActiveMonitoringEnrollmentQuote(
          args.purchaseId,
          args.nowIso,
        );
        if (winner) {
          return {
            outcome: "existing_unexpired" as const,
            quote: winner,
            supersededIds: [],
          };
        }
        throw err;
      } finally {
        client.release();
      }
      const quote = (await this.getMonitoringEnrollmentQuoteById(args.id))!;
      return { outcome: "issued" as const, quote, supersededIds: [] };
    },
    async listActiveMonitorActivations(args) {
      const limit = Math.min(Math.max(1, args?.limit ?? 50), 200);
      const after = args?.afterPurchaseId ?? null;
      // Consistent keyset: ORDER BY purchase_id ASC on every page.
      if (after) {
        const r = await q<MonitorActivationRow>(
          `SELECT * FROM monitor_activations
           WHERE status = 'active' AND purchase_id > $1
           ORDER BY purchase_id ASC LIMIT $2`,
          [after, limit],
        );
        return r.rows;
      }
      const r = await q<MonitorActivationRow>(
        `SELECT * FROM monitor_activations WHERE status = 'active'
         ORDER BY purchase_id ASC
         LIMIT $1`,
        [limit],
      );
      return r.rows;
    },
    async getPurchaseBlobByPurchaseId(purchaseId) {
      const r = await q<PurchaseBlobRow>(
        `SELECT * FROM account_purchase_blobs WHERE purchase_id = $1`,
        [purchaseId],
      );
      return r.rows[0] ?? null;
    },
    async upsertDurableMonitorSchedule(args) {
      await q(
        `INSERT INTO durable_monitor_schedule
         (purchase_id, activation_id, account_id, status, next_check_at,
          last_checked_at, provider_backoff_until, last_skip_reason,
          hydration_blocker_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT (purchase_id) DO UPDATE SET
           activation_id = COALESCE(EXCLUDED.activation_id, durable_monitor_schedule.activation_id),
           account_id = COALESCE(EXCLUDED.account_id, durable_monitor_schedule.account_id),
           status = EXCLUDED.status,
           next_check_at = COALESCE(EXCLUDED.next_check_at, durable_monitor_schedule.next_check_at),
           last_checked_at = COALESCE(EXCLUDED.last_checked_at, durable_monitor_schedule.last_checked_at),
           provider_backoff_until = COALESCE(EXCLUDED.provider_backoff_until, durable_monitor_schedule.provider_backoff_until),
           last_skip_reason = COALESCE(EXCLUDED.last_skip_reason, durable_monitor_schedule.last_skip_reason),
           hydration_blocker_json = COALESCE(EXCLUDED.hydration_blocker_json, durable_monitor_schedule.hydration_blocker_json),
           updated_at = EXCLUDED.updated_at`,
        [
          args.purchaseId,
          args.activationId ?? null,
          args.accountId ?? null,
          args.status,
          args.nextCheckAt ?? null,
          args.lastCheckedAt ?? null,
          args.providerBackoffUntil ?? null,
          args.lastSkipReason ?? null,
          args.hydrationBlockerJson ?? null,
          args.nowIso,
        ],
      );
    },
    async insertDurableMonitorScheduleIfMissing(args) {
      const r = await q(
        `INSERT INTO durable_monitor_schedule
         (purchase_id, activation_id, account_id, status, next_check_at,
          last_checked_at, provider_backoff_until, last_skip_reason,
          hydration_blocker_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NULL,NULL,NULL,NULL,NULL,$5,$5)
         ON CONFLICT (purchase_id) DO NOTHING`,
        [
          args.purchaseId,
          args.activationId ?? null,
          args.accountId ?? null,
          args.status ?? "active",
          args.nowIso,
        ],
      );
      return { created: (r.rowCount ?? 0) === 1 };
    },
    async getDurableMonitorSchedule(purchaseId) {
      const r = await q<DurableMonitorScheduleRow>(
        `SELECT * FROM durable_monitor_schedule WHERE purchase_id = $1`,
        [purchaseId],
      );
      return r.rows[0] ?? null;
    },
    async listDueDurableMonitorSchedules(args) {
      // Match SQLite: active + due + backoff elapsed, keyset by purchase_id.
      if (args.afterPurchaseId) {
        const r = await q<DurableMonitorScheduleRow>(
          `SELECT * FROM durable_monitor_schedule
           WHERE status = 'active'
             AND (next_check_at IS NULL OR next_check_at <= $1)
             AND (provider_backoff_until IS NULL OR provider_backoff_until <= $1)
             AND purchase_id > $2
           ORDER BY purchase_id ASC LIMIT $3`,
          [args.asOfIso, args.afterPurchaseId, args.limit],
        );
        return r.rows;
      }
      const r = await q<DurableMonitorScheduleRow>(
        `SELECT * FROM durable_monitor_schedule
         WHERE status = 'active'
           AND (next_check_at IS NULL OR next_check_at <= $1)
           AND (provider_backoff_until IS NULL OR provider_backoff_until <= $1)
         ORDER BY purchase_id ASC LIMIT $2`,
        [args.asOfIso, args.limit],
      );
      return r.rows;
    },
    async tryAcquireGlobalLease(args) {
      await q(
        `INSERT INTO durable_global_leases (lease_key, holder_id, expires_at, updated_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (lease_key) DO UPDATE SET
           holder_id = EXCLUDED.holder_id,
           expires_at = EXCLUDED.expires_at,
           updated_at = EXCLUDED.updated_at
         WHERE durable_global_leases.expires_at <= EXCLUDED.updated_at
            OR durable_global_leases.holder_id = EXCLUDED.holder_id`,
        [args.leaseKey, args.holderId, args.expiresAt, args.nowIso],
      );
      const r = await q<{ holder_id: string }>(
        `SELECT holder_id FROM durable_global_leases WHERE lease_key = $1`,
        [args.leaseKey],
      );
      return r.rows[0]?.holder_id === args.holderId;
    },
    async releaseGlobalLease(args) {
      await q(
        `DELETE FROM durable_global_leases WHERE lease_key = $1 AND holder_id = $2`,
        [args.leaseKey, args.holderId],
      );
    },
    async tryReserveSearchBudget(args) {
      await q(
        `INSERT INTO durable_search_budget (period_key, used_count, limit_count, updated_at)
         VALUES ($1,0,$2,$3)
         ON CONFLICT (period_key) DO NOTHING`,
        [args.periodKey, args.limitCount, args.nowIso],
      );
      const current = await q<{ used_count: number; limit_count: number }>(
        `SELECT used_count, limit_count FROM durable_search_budget WHERE period_key = $1`,
        [args.periodKey],
      );
      const row = current.rows[0];
      if (!row) return { reserved: false, used: 0 };
      if (row.used_count >= row.limit_count) {
        return { reserved: false, used: row.used_count };
      }
      const r = await q(
        `UPDATE durable_search_budget
         SET used_count = used_count + 1, updated_at = $1
         WHERE period_key = $2 AND used_count < limit_count`,
        [args.nowIso, args.periodKey],
      );
      const after = await q<{ used_count: number }>(
        `SELECT used_count FROM durable_search_budget WHERE period_key = $1`,
        [args.periodKey],
      );
      return {
        reserved: (r.rowCount ?? 0) === 1,
        used: after.rows[0]?.used_count ?? row.used_count,
      };
    },
    async tryReserveAlertOpportunity(args) {
      try {
        await q(
          `INSERT INTO durable_alert_opportunities
           (opportunity_key, purchase_id, alert_id, reserved_at, status)
           VALUES ($1,$2,$3,$4,'reserved')`,
          [
            args.opportunityKey,
            args.purchaseId,
            args.alertId ?? null,
            args.nowIso,
          ],
        );
        return true;
      } catch {
        return false;
      }
    },
    async insertNotificationOutbox(args) {
      try {
        await q(
          `INSERT INTO durable_notification_outbox
           (id, opportunity_key, purchase_id, account_id, alert_id, kind,
            status, reason, attempt_count, recipient_email_hash, evidence_json,
            created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$11)`,
          [
            args.id,
            args.opportunityKey,
            args.purchaseId,
            args.accountId,
            args.alertId ?? null,
            args.kind,
            args.status,
            args.reason ?? null,
            args.recipientEmailHash ?? null,
            args.evidenceJson ?? null,
            args.nowIso,
          ],
        );
        return { id: args.id, created: true };
      } catch {
        const existing = await this.getNotificationOutboxByOpportunity(
          args.opportunityKey,
        );
        if (args.evidenceJson && existing) {
          try {
            await q(
              `UPDATE durable_notification_outbox
               SET evidence_json = COALESCE(evidence_json, $1)
               WHERE opportunity_key = $2`,
              [args.evidenceJson, args.opportunityKey],
            );
          } catch {
            /* ignore */
          }
        }
        return { id: existing?.id ?? args.id, created: false };
      }
    },
    async tryLeaseNotificationOutbox(args) {
      // Atomically lease pending/failed_retryable OR reclaim expired sending.
      const r = await q(
        `UPDATE durable_notification_outbox
         SET status = 'sending',
             lease_holder = $1,
             lease_expires_at = $2,
             updated_at = $3,
             attempt_count = COALESCE(attempt_count, 0) + 1
         WHERE opportunity_key = $4
           AND (
             (status IN ('pending', 'failed_retryable')
               AND (lease_expires_at IS NULL OR lease_expires_at <= $3))
             OR
             (status = 'sending'
               AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= $3)
           )`,
        [
          args.holderId,
          args.leaseExpiresAt,
          args.nowIso,
          args.opportunityKey,
        ],
      );
      if ((r.rowCount ?? 0) !== 1) return null;
      return this.getNotificationOutboxByOpportunity(args.opportunityKey);
    },
    async insertSettlementReviewAudit(args) {
      await q(
        `INSERT INTO settlement_review_audit
         (id, payment_id, decision, evidence_source, evidence_ref_hash, reviewer_key_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          args.id,
          args.paymentId,
          args.decision,
          args.evidenceSource,
          args.evidenceRefHash,
          args.reviewerKeyId ?? null,
          args.nowIso,
        ],
      );
    },
    async getSettlementRefClaim(settlementRef) {
      const ref = String(settlementRef || "").trim().toLowerCase();
      const r = await q<{
        settlement_ref: string;
        payment_id: string;
        decision: string;
      }>(
        `SELECT settlement_ref, payment_id, decision FROM settlement_ref_claims
         WHERE settlement_ref = $1`,
        [ref],
      );
      return r.rows[0] ?? null;
    },
    async getMonitoringPassPaymentBySettlementRef(settlementRef) {
      const ref = String(settlementRef || "").trim().toLowerCase();
      const r = await q<MonitoringPassPaymentRow>(
        `SELECT * FROM monitoring_pass_payments
         WHERE lower(settlement_ref) = $1
         LIMIT 1`,
        [ref],
      );
      return r.rows[0] ?? null;
    },
    async claimSettlementReviewDecision(args) {
      const ref = String(args.settlementRef || "").trim().toLowerCase();
      if (!/^0x[a-f0-9]{16,}$/.test(ref)) {
        return { ok: false as const, reason: "conflict" as const };
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const payRes = await client.query(
          `SELECT * FROM monitoring_pass_payments WHERE id = $1 FOR UPDATE`,
          [args.paymentId],
        );
        const payment = payRes.rows[0] as MonitoringPassPaymentRow | undefined;
        if (
          !payment ||
          (payment.status !== "settlement_review_required" &&
            payment.status !== "settlement_unknown")
        ) {
          await client.query("ROLLBACK");
          return {
            ok: false as const,
            reason: "payment_not_reviewable" as const,
          };
        }
        const otherPay = await client.query(
          `SELECT id FROM monitoring_pass_payments
           WHERE lower(settlement_ref) = $1 AND id != $2 LIMIT 1`,
          [ref, args.paymentId],
        );
        if (otherPay.rows[0]) {
          await client.query("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }
        const otherPass = await client.query(
          `SELECT id FROM monitoring_passes
           WHERE lower(settlement_ref) = $1 AND payment_id != $2 LIMIT 1`,
          [ref, args.paymentId],
        );
        if (otherPass.rows[0]) {
          await client.query("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }
        const otherAudit = await client.query(
          `SELECT payment_id FROM settlement_review_audit
           WHERE evidence_ref_hash = $1 AND payment_id != $2 LIMIT 1`,
          [args.evidenceRefHash, args.paymentId],
        );
        if (otherAudit.rows[0]) {
          await client.query("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }
        const existingClaim = await client.query(
          `SELECT payment_id FROM settlement_ref_claims WHERE settlement_ref = $1 FOR UPDATE`,
          [ref],
        );
        if (
          existingClaim.rows[0] &&
          existingClaim.rows[0].payment_id !== args.paymentId
        ) {
          await client.query("ROLLBACK");
          return { ok: false as const, reason: "ref_already_claimed" as const };
        }
        if (!existingClaim.rows[0]) {
          try {
            await client.query(
              `INSERT INTO settlement_ref_claims
               (settlement_ref, payment_id, decision, claimed_at)
               VALUES ($1,$2,$3,$4)`,
              [ref, args.paymentId, args.decision, args.nowIso],
            );
          } catch {
            await client.query("ROLLBACK");
            return {
              ok: false as const,
              reason: "ref_already_claimed" as const,
            };
          }
        }
        const paymentStatus =
          args.decision === "settled" ? "settled" : "failed";
        // Always bind settlement_ref (canonical lowercase) so the same tx
        // cannot unlock another payment after a failed decision either.
        const settlementVal = ref;
        await client.query(
          `UPDATE monitoring_pass_payments
           SET status = $1,
               settlement_ref = $2,
               updated_at = $3,
               payer_address = COALESCE($4, payer_address),
               sanitized_settle_reason = COALESCE($5, sanitized_settle_reason),
               last_provider_operation = 'operator_review'
           WHERE id = $6
             AND status IN ('settlement_review_required', 'settlement_unknown')`,
          [
            paymentStatus,
            settlementVal,
            args.nowIso,
            args.payerAddress ?? null,
            args.sanitizedSettleReason ?? null,
            args.paymentId,
          ],
        );
        await client.query(
          `INSERT INTO settlement_review_audit
           (id, payment_id, decision, evidence_source, evidence_ref_hash, reviewer_key_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            args.auditId,
            args.paymentId,
            args.decision,
            args.evidenceSource,
            args.evidenceRefHash,
            args.reviewerKeyId ?? null,
            args.nowIso,
          ],
        );
        await client.query("COMMIT");
        return { ok: true as const };
      } catch {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { ok: false as const, reason: "conflict" as const };
      } finally {
        client.release();
      }
    },
    async markNotificationOutboxStatus(args) {
      const r = await q(
        `UPDATE durable_notification_outbox
         SET status = $1,
             reason = COALESCE($2, reason),
             updated_at = $3,
             sent_at = COALESCE($4, sent_at),
             next_attempt_at = COALESCE($5, next_attempt_at),
             attempt_count = CASE WHEN $6 THEN COALESCE(attempt_count, 0) + 1 ELSE COALESCE(attempt_count, 0) END,
             lease_holder = CASE WHEN $1 IN ('sent', 'failed_terminal', 'failed_retryable', 'suppressed', 'pending') THEN NULL ELSE lease_holder END,
             lease_expires_at = CASE WHEN $1 IN ('sent', 'failed_terminal', 'failed_retryable', 'suppressed', 'pending') THEN NULL ELSE lease_expires_at END
         WHERE id = $7`,
        [
          args.status,
          args.reason ?? null,
          args.nowIso,
          args.sentAt ?? null,
          args.nextAttemptAt ?? null,
          args.incrementAttempt === true,
          args.id,
        ],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async getNotificationOutboxByOpportunity(opportunityKey) {
      const r = await q<DurableNotificationOutboxRow>(
        `SELECT * FROM durable_notification_outbox WHERE opportunity_key = $1`,
        [opportunityKey],
      );
      return r.rows[0] ?? null;
    },
    async listDueNotificationOutbox(args) {
      const r = await q<DurableNotificationOutboxRow>(
        `SELECT * FROM durable_notification_outbox
         WHERE (
           status IN ('pending', 'failed_retryable')
           AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
         ) OR (
           status = 'sending'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= $1
         )
         ORDER BY created_at ASC
         LIMIT $2`,
        [args.nowIso, args.limit],
      );
      return r.rows;
    },
    async tryReserveNotificationRate(args) {
      await q(
        `INSERT INTO durable_account_notification_rate
         (rate_key, account_id, kind, window_start, used_count, updated_at)
         VALUES ($1,$2,$3,$4,0,$5)
         ON CONFLICT (rate_key) DO NOTHING`,
        [
          args.rateKey,
          args.accountId,
          args.kind,
          args.windowStart,
          args.nowIso,
        ],
      );
      const r = await q(
        `UPDATE durable_account_notification_rate
         SET used_count = used_count + 1, updated_at = $1
         WHERE rate_key = $2 AND used_count < $3
         RETURNING used_count`,
        [args.nowIso, args.rateKey, args.limitCount],
      );
      if ((r.rowCount ?? 0) !== 1) {
        const cur = await q<{ used_count: number }>(
          `SELECT used_count FROM durable_account_notification_rate WHERE rate_key = $1`,
          [args.rateKey],
        );
        return {
          reserved: false,
          used: Number(cur.rows[0]?.used_count ?? 0),
        };
      }
      return {
        reserved: true,
        used: Number(
          (r.rows[0] as { used_count: number } | undefined)?.used_count ?? 1,
        ),
      };
    },
    async releaseNotificationRate(args) {
      await q(
        `UPDATE durable_account_notification_rate
         SET used_count = CASE WHEN used_count > 0 THEN used_count - 1 ELSE 0 END,
             updated_at = $1
         WHERE rate_key = $2`,
        [args.nowIso, args.rateKey],
      );
    },
    async tryReserveRollingSummarySend(args) {
      const windowMs = args.windowMs ?? 24 * 60 * 60 * 1000;
      const reserveTtlMs = args.reserveTtlMs ?? 60_000;
      const nowMs = Date.parse(args.nowIso);
      const reserveExpires = new Date(nowMs + reserveTtlMs).toISOString();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO durable_summary_send_state
           (account_id, last_sent_at, reserve_holder, reserve_expires_at, updated_at)
           VALUES ($1,NULL,NULL,NULL,$2)
           ON CONFLICT (account_id) DO NOTHING`,
          [args.accountId, args.nowIso],
        );
        const cur = await client.query(
          `SELECT last_sent_at, reserve_holder, reserve_expires_at
           FROM durable_summary_send_state WHERE account_id = $1 FOR UPDATE`,
          [args.accountId],
        );
        const row = cur.rows[0] as
          | {
              last_sent_at: string | null;
              reserve_holder: string | null;
              reserve_expires_at: string | null;
            }
          | undefined;
        if (!row) {
          await client.query("ROLLBACK");
          return { reserved: false, reason: "missing_state" };
        }
        if (row.last_sent_at) {
          const lastMs = Date.parse(row.last_sent_at);
          if (!Number.isNaN(lastMs) && nowMs - lastMs < windowMs) {
            await client.query("COMMIT");
            return {
              reserved: false,
              reason: "summary_cooldown",
              last_sent_at: row.last_sent_at,
            };
          }
        }
        const reserveActive =
          row.reserve_holder &&
          row.reserve_expires_at &&
          Date.parse(row.reserve_expires_at) > nowMs;
        if (reserveActive && row.reserve_holder !== args.holderId) {
          await client.query("COMMIT");
          return { reserved: false, reason: "reserve_held" };
        }
        await client.query(
          `UPDATE durable_summary_send_state
           SET reserve_holder = $1, reserve_expires_at = $2, updated_at = $3
           WHERE account_id = $4`,
          [args.holderId, reserveExpires, args.nowIso, args.accountId],
        );
        await client.query("COMMIT");
        return { reserved: true, last_sent_at: row.last_sent_at };
      } catch {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        return { reserved: false, reason: "conflict" };
      } finally {
        client.release();
      }
    },
    async markRollingSummarySent(args) {
      const r = await q(
        `UPDATE durable_summary_send_state
         SET last_sent_at = $1,
             reserve_holder = NULL,
             reserve_expires_at = NULL,
             updated_at = $1
         WHERE account_id = $2
           AND (reserve_holder = $3 OR reserve_holder IS NULL)`,
        [args.nowIso, args.accountId, args.holderId],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async releaseRollingSummaryReserve(args) {
      await q(
        `UPDATE durable_summary_send_state
         SET reserve_holder = NULL,
             reserve_expires_at = NULL,
             updated_at = $1
         WHERE account_id = $2 AND reserve_holder = $3`,
        [args.nowIso, args.accountId, args.holderId],
      );
    },
  };
}

let cachedStore: AuthStore | null = null;

/**
 * Resolve auth store: Postgres when durable URL present (production),
 * else SQLite for tests/local.
 */
export async function getAuthStore(args?: {
  sqliteDb?: NobuDatabase;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  forceSqlite?: boolean;
}): Promise<AuthStore> {
  const env = args?.env ?? process.env;
  if (
    !args?.forceSqlite &&
    hasDurableDatabaseUrl(env) &&
    !isAuthTestMode(env)
  ) {
    if (cachedStore?.kind === "postgres") {
      await cachedStore.ensureSchema();
      return cachedStore;
    }
    const store = createPostgresAuthStore(env);
    await store.ensureSchema();
    cachedStore = store;
    return store;
  }

  // Tests / local: prefer provided sqlite, else open web db lazily
  let db = args?.sqliteDb;
  if (!db) {
    const { getWebDatabase } = await import("../web/db.js");
    db = getWebDatabase();
  }
  const store = createSqliteAuthStore(db);
  await store.ensureSchema();
  return store;
}

/** Test helper — drop cached postgres pool binding. */
export function resetAuthStoreCache(): void {
  cachedStore = null;
  pgSchemaReady = false;
  if (pgPool) {
    void pgPool.end().catch(() => {});
    pgPool = null;
  }
}

export function durableDbManualActions(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  if (hasDurableDatabaseUrl(env) || isAuthTestMode(env)) return [];
  return [
    "DATABASE_URL or POLICY_OPS_DATABASE_URL (Postgres) for durable auth across Vercel instances",
  ];
}
