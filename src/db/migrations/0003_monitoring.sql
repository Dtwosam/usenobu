-- Lane 5: monitor runs, alerts, search budget ledger

CREATE TABLE IF NOT EXISTS search_budget_ledger (
  period_key TEXT PRIMARY KEY NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  limit_count INTEGER NOT NULL CHECK (limit_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('manual', 'scheduled')),
  outcome TEXT NOT NULL CHECK (outcome IN ('checked', 'skipped', 'error')),
  skip_reason TEXT,
  searches_consumed INTEGER NOT NULL DEFAULT 0 CHECK (searches_consumed >= 0),
  observation_id TEXT,
  alert_id TEXT,
  provider_status TEXT,
  match_result TEXT,
  notes TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases (id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_purchase_id ON monitor_runs (purchase_id);
CREATE INDEX IF NOT EXISTS idx_monitor_runs_outcome ON monitor_runs (outcome);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  fingerprint_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  purchase_price REAL NOT NULL CHECK (purchase_price > 0),
  observed_price REAL NOT NULL CHECK (observed_price > 0),
  potential_recovery REAL NOT NULL CHECK (potential_recovery >= 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  alert_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  disclaimer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases (id),
  FOREIGN KEY (observation_id) REFERENCES price_observations (id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_purchase_id ON alerts (purchase_id);
CREATE INDEX IF NOT EXISTS idx_alerts_fingerprint_id ON alerts (fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_alerts_alert_key ON alerts (alert_key);
