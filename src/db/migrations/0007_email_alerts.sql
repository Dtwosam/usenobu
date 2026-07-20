-- Lane 7.3B: consented price-drop email alerts + controlled monitoring schedule

-- Per-purchase schedule / lock fields (fail closed; no continuous polling)
ALTER TABLE purchases ADD COLUMN last_checked_at TEXT;
ALTER TABLE purchases ADD COLUMN next_check_at TEXT;
ALTER TABLE purchases ADD COLUMN check_lock_until TEXT;
ALTER TABLE purchases ADD COLUMN provider_backoff_until TEXT;
ALTER TABLE purchases ADD COLUMN last_skip_reason TEXT;

CREATE TABLE IF NOT EXISTS purchase_email_alert_prefs (
  purchase_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  consent_at TEXT,
  disabled_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases (id)
);

CREATE INDEX IF NOT EXISTS idx_email_alert_prefs_account
  ON purchase_email_alert_prefs (account_id);

-- Durable notification ledger (idempotency + anti-spam audit)
CREATE TABLE IF NOT EXISTS email_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  alert_id TEXT,
  opportunity_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('immediate', 'summary')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'suppressed', 'combined', 'failed')),
  reason TEXT NOT NULL,
  initiated_by TEXT NOT NULL DEFAULT 'nobu',
  recipient_email_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_key)
);

CREATE INDEX IF NOT EXISTS idx_email_notifications_account_created
  ON email_notifications (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_notifications_purchase
  ON email_notifications (purchase_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_alert
  ON email_notifications (alert_id);

-- Closed opportunities so a later genuine new drop can notify again
CREATE TABLE IF NOT EXISTS closed_price_opportunities (
  opportunity_key TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  close_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_closed_opportunities_purchase
  ON closed_price_opportunities (purchase_id);
