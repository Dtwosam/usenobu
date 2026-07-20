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
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_purchase_blobs_account
  ON account_purchase_blobs (account_id);
`;
