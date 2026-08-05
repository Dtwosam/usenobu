/**
 * Durable auth + account purchase ownership schema (PostgreSQL / SQLite-compatible).
 * Never stored in the browser cookie snapshot.
 */

export const AUTH_DURABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS auth_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  email_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_login_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  email_normalized TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  request_ip_hash TEXT,
  guest_owner_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_login_tokens_hash ON auth_login_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_login_tokens_email ON auth_login_tokens (email_normalized);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash ON auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions (account_id);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_claim_events (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  guest_owner_ref TEXT NOT NULL,
  purchases_claimed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, guest_owner_ref)
);

CREATE TABLE IF NOT EXISTS account_purchase_blobs (
  purchase_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  blob_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  user_outcome TEXT,
  user_outcome_at TEXT,
  email_alerts_enabled INTEGER DEFAULT 0,
  email_alerts_consent_at TEXT,
  email_alerts_disabled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_purchase_blobs_account
  ON account_purchase_blobs (account_id);

-- Lane 7.4B — agent-native connection + conversational email verification.
-- Never stored in the browser cookie snapshot or per-instance SQLite prod.
CREATE TABLE IF NOT EXISTS agent_connections (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT,
  email_normalized TEXT NOT NULL,
  connection_token_hash TEXT,
  credential_expires_at TEXT,
  credential_rotated_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_connections_account
  ON agent_connections (account_id);

CREATE TABLE IF NOT EXISTS agent_email_codes (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_email_codes_connection
  ON agent_email_codes (connection_id);

-- Lane 7.4C — free agent-native discovery, confirmation, and monitoring preflight.
-- Same durable store as auth_accounts / agent_connections; never per-instance
-- storage or the browser cookie snapshot. Raw purchase text is never stored,
-- only a hash (structured_snapshot_json holds validated fields only).
CREATE TABLE IF NOT EXISTS discovery_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  structured_snapshot_json TEXT NOT NULL,
  purchase_text_hash TEXT,
  candidates_snapshot_json TEXT,
  selected_candidate_id TEXT,
  locked_fingerprint_snapshot_json TEXT,
  status TEXT NOT NULL DEFAULT 'discovering',
  materialized_purchase_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_materialized
  ON discovery_sessions (materialized_purchase_id);

CREATE TABLE IF NOT EXISTS monitoring_enrollment_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  connection_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  fingerprint_id TEXT NOT NULL,
  price_amount NUMERIC NOT NULL,
  price_currency TEXT NOT NULL,
  settlement_asset TEXT,
  settlement_network TEXT,
  monitoring_deadline TEXT,
  consent_monitoring_at TEXT NOT NULL,
  consent_email_alerts_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitoring_enrollment_quotes_purchase
  ON monitoring_enrollment_quotes (purchase_id);

-- At most one active (issued) quote per purchase — enforced at the DB level
-- as a race-safety net on top of the application-level idempotent lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoring_enrollment_quotes_one_active
  ON monitoring_enrollment_quotes (purchase_id)
  WHERE status = 'issued';

-- Lane 7.4D — $0.99 paid monitoring activation. Same durable store as
-- monitoring_enrollment_quotes; NOT the same database as the purchases
-- table (src/web/db.ts's getWebDatabase(), per-instance /tmp SQLite in
-- production) — the two-phase saga (record settlement here, then project
-- to purchases separately) exists precisely because no single transaction
-- can span both stores.
CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  quote_id TEXT NOT NULL,
  x402_challenge_ref TEXT,
  status TEXT NOT NULL DEFAULT 'challenged', -- challenged | verifying | settled | failed | expired
  settlement_ref TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_quote
  ON payment_attempts (quote_id);

-- At most one settled payment per quote — defense in depth alongside the
-- monitor_activations UNIQUE(quote_id) below.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_one_settled
  ON payment_attempts (quote_id)
  WHERE status = 'settled';

CREATE TABLE IF NOT EXISTS monitor_activations (
  id TEXT PRIMARY KEY NOT NULL,
  quote_id TEXT NOT NULL UNIQUE,
  activation_key TEXT NOT NULL UNIQUE,
  payment_attempt_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  fingerprint_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL, -- always equals purchase_id; no parallel id space
  status TEXT NOT NULL DEFAULT 'pending_projection', -- pending_projection | active
  created_at TEXT NOT NULL,
  projected_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitor_activations_purchase
  ON monitor_activations (purchase_id);
CREATE INDEX IF NOT EXISTS idx_monitor_activations_status
  ON monitor_activations (status);

-- Lane 8R.3B — Nobu Monitoring Pass. The paid A2MCP service sells a pass
-- with no prerequisites, so payment is decoupled from enrollment: the 402
-- challenge needs no quote, connection, purchase or consent. Exactly-once
-- issuance is anchored on the OKX-verified settlement reference, not on any
-- caller-supplied identifier.
--
-- authorization_digest is sha256 of the replayed PAYMENT-SIGNATURE header.
-- The raw header is never stored, logged, or returned; the digest exists
-- only so a repeated replay of the same signed payment resolves to the same
-- payment record instead of starting a second settlement.
CREATE TABLE IF NOT EXISTS monitoring_pass_payments (
  id TEXT PRIMARY KEY NOT NULL,
  authorization_digest TEXT NOT NULL UNIQUE,
  -- authorization_received | verifying | settlement_pending | settlement_unknown
  -- | settled | rejected | failed
  status TEXT NOT NULL DEFAULT 'authorization_received',
  settlement_ref TEXT,
  payer_address TEXT,
  sanitized_verify_reason TEXT,
  sanitized_settle_reason TEXT,
  last_provider_operation TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitoring_pass_payments_status
  ON monitoring_pass_payments (status);

-- One verified settlement issues exactly one pass (UNIQUE settlement_ref).
-- pass_token_hash is sha256 of the opaque token returned once to the buyer;
-- the token itself is never stored. payer_address binds ownership when known.
CREATE TABLE IF NOT EXISTS monitoring_passes (
  id TEXT PRIMARY KEY NOT NULL,
  pass_token_hash TEXT NOT NULL,
  settlement_ref TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL,
  price_amount NUMERIC NOT NULL,
  price_currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued', -- issued | redeemed
  payer_address TEXT,
  redeemed_at TEXT,
  redeemed_quote_id TEXT,
  redeemed_purchase_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitoring_passes_status
  ON monitoring_passes (status);

-- Customer-safe pass handoff after marketplace settlement. One high-entropy
-- continuation id per payment; never a payment header, digest, settlement
-- ref, or transferable bearer for redemption. Status is pending until a
-- Monitoring Pass is issued, then issued with monitoring_pass_id set.
-- claim_credential_hash is sha256 of a single-use continuation secret returned
-- only to the successful paid caller — public pass/journey ids alone cannot claim.
CREATE TABLE IF NOT EXISTS monitoring_pass_continuations (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL UNIQUE,
  monitoring_pass_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | issued | claimed
  claim_credential_hash TEXT,
  claim_credential_consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitoring_pass_continuations_status
  ON monitoring_pass_continuations (status);
CREATE INDEX IF NOT EXISTS idx_monitoring_pass_continuations_pass
  ON monitoring_pass_continuations (monitoring_pass_id);

-- Provider-controlled OKX Purchase Setup journey. The opaque journey id is
-- continuity only: it is bound to one issued pass and never authorizes
-- redemption by itself. Internal handles remain server-side.
CREATE TABLE IF NOT EXISTS marketplace_purchase_journeys (
  id TEXT PRIMARY KEY NOT NULL,
  monitoring_pass_id TEXT NOT NULL UNIQUE,
  pass_continuation_id TEXT,
  stage TEXT NOT NULL DEFAULT 'confirm_use_pass',
  purchase_snapshot_json TEXT,
  discovery_session_id TEXT,
  fingerprint_id TEXT,
  connection_id TEXT,
  quote_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketplace_purchase_journeys_stage
  ON marketplace_purchase_journeys (stage);

-- Paid-to-active repair: durable scheduler control plane (local SQLite is cache only).
CREATE TABLE IF NOT EXISTS durable_monitor_schedule (
  purchase_id TEXT PRIMARY KEY NOT NULL,
  activation_id TEXT,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | stopped | expired | blocked
  next_check_at TEXT,
  last_checked_at TEXT,
  provider_backoff_until TEXT,
  last_skip_reason TEXT,
  hydration_blocker_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_durable_monitor_schedule_due
  ON durable_monitor_schedule (status, next_check_at, purchase_id);

CREATE TABLE IF NOT EXISTS durable_global_leases (
  lease_key TEXT PRIMARY KEY NOT NULL,
  holder_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS durable_search_budget (
  period_key TEXT PRIMARY KEY NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  limit_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS durable_alert_opportunities (
  opportunity_key TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  alert_id TEXT,
  reserved_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
);

CREATE TABLE IF NOT EXISTS durable_notification_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_key TEXT NOT NULL UNIQUE,
  purchase_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  alert_id TEXT,
  kind TEXT NOT NULL,
  -- pending | sending | sent | failed_retryable | failed_terminal | suppressed
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_holder TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  recipient_email_hash TEXT,
  -- Sanitized reconstruction inputs (no plaintext secrets / email body).
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_durable_notification_outbox_status
  ON durable_notification_outbox (status, next_attempt_at);

-- Operator settlement review audit (sanitized; no payment signatures).
CREATE TABLE IF NOT EXISTS settlement_review_audit (
  id TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  evidence_ref_hash TEXT NOT NULL,
  reviewer_key_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_review_audit_payment
  ON settlement_review_audit (payment_id);

-- One non-null settlement reference belongs to exactly one payment claim.
CREATE TABLE IF NOT EXISTS settlement_ref_claims (
  settlement_ref TEXT PRIMARY KEY NOT NULL,
  payment_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_ref_claims_payment
  ON settlement_ref_claims (payment_id);

-- Durable account-level notification rate (legacy calendar-bucket counter).
CREATE TABLE IF NOT EXISTS durable_account_notification_rate (
  rate_key TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  window_start TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Rolling 24h summary send state (authoritative across Vercel workers).
CREATE TABLE IF NOT EXISTS durable_summary_send_state (
  account_id TEXT PRIMARY KEY NOT NULL,
  last_sent_at TEXT,
  reserve_holder TEXT,
  reserve_expires_at TEXT,
  updated_at TEXT NOT NULL
);
`;

/** Best-effort column adds for existing durable DBs (Postgres / SQLite). */
export const AUTH_DURABLE_SCHEMA_PATCHES = [
  // Lane 8R.3B — which payment record authorized this activation when it came
  // from a Monitoring Pass rather than a quote-bound payment attempt.
  `ALTER TABLE monitor_activations ADD COLUMN monitoring_pass_id TEXT`,
  `ALTER TABLE account_purchase_blobs ADD COLUMN archived_at TEXT`,
  `ALTER TABLE account_purchase_blobs ADD COLUMN user_outcome TEXT`,
  `ALTER TABLE account_purchase_blobs ADD COLUMN user_outcome_at TEXT`,
  `ALTER TABLE account_purchase_blobs ADD COLUMN email_alerts_enabled INTEGER DEFAULT 0`,
  `ALTER TABLE account_purchase_blobs ADD COLUMN email_alerts_consent_at TEXT`,
  `ALTER TABLE account_purchase_blobs ADD COLUMN email_alerts_disabled_at TEXT`,
  // Speed/flow hardening — durable structured purchase after extract, before discovery.
  `ALTER TABLE marketplace_purchase_journeys ADD COLUMN purchase_snapshot_json TEXT`,
  // Paid-to-active transactional repair — payment diagnostics (safe fields only).
  `ALTER TABLE monitoring_pass_payments ADD COLUMN payer_address TEXT`,
  `ALTER TABLE monitoring_pass_payments ADD COLUMN sanitized_verify_reason TEXT`,
  `ALTER TABLE monitoring_pass_payments ADD COLUMN sanitized_settle_reason TEXT`,
  `ALTER TABLE monitoring_pass_payments ADD COLUMN last_provider_operation TEXT`,
  `ALTER TABLE monitoring_pass_payments ADD COLUMN attempt_count INTEGER DEFAULT 0`,
  `ALTER TABLE monitoring_passes ADD COLUMN payer_address TEXT`,
  `ALTER TABLE monitoring_pass_continuations ADD COLUMN claim_credential_hash TEXT`,
  `ALTER TABLE monitoring_pass_continuations ADD COLUMN claim_credential_consumed_at TEXT`,
  `ALTER TABLE durable_notification_outbox ADD COLUMN evidence_json TEXT`,
  // Canonical settlement_ref uniqueness (case-insensitive); safe no-ops if present.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_ref_claims_ref
    ON settlement_ref_claims (settlement_ref)`,
];

