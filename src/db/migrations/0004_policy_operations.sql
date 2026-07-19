-- Lane 8-R1A: sustainable policy operations + owner review alerts

CREATE TABLE IF NOT EXISTS policy_operations (
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_last_checked_at TEXT NOT NULL,
  next_review_at TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK (review_state IN (
    'CURRENT',
    'CHECK_DUE',
    'SOURCE_UNAVAILABLE',
    'CHANGE_DETECTED',
    'REVIEW_REQUIRED',
    'RETIRED'
  )),
  source_fingerprint TEXT,
  last_owner_alert_at TEXT,
  review_note TEXT,
  retired_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, policy_version)
);

CREATE INDEX IF NOT EXISTS idx_policy_operations_review_state
  ON policy_operations (review_state);
CREATE INDEX IF NOT EXISTS idx_policy_operations_next_review
  ON policy_operations (next_review_at);

CREATE TABLE IF NOT EXISTS policy_owner_alerts (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  alert_key TEXT NOT NULL UNIQUE,
  alert_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cleared')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleared_at TEXT,
  last_notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_owner_alerts_status
  ON policy_owner_alerts (status);
CREATE INDEX IF NOT EXISTS idx_policy_owner_alerts_policy
  ON policy_owner_alerts (policy_id, policy_version);

CREATE TABLE IF NOT EXISTS policy_pending_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  from_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
  note TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_pending_reviews_status
  ON policy_pending_reviews (status);

CREATE TABLE IF NOT EXISTS policy_review_events (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_policy_review_events_policy
  ON policy_review_events (policy_id, created_at);
