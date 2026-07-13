-- Nobu Lane 1 initial schema
-- Dialect: SQLite for local proof; column types map 1:1 to PostgreSQL TEXT/REAL/INTEGER.
-- Production deployment may re-target PostgreSQL without changing logical models.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id TEXT PRIMARY KEY NOT NULL,
  policy_id TEXT NOT NULL,
  version TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  purchase_channel TEXT NOT NULL,
  status TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  window_days INTEGER NOT NULL CHECK (window_days > 0),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (policy_id, version)
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY NOT NULL,
  user_ref TEXT,
  target_product_url TEXT NOT NULL,
  purchase_price REAL NOT NULL CHECK (purchase_price > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  purchase_date TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country = 'US'),
  region TEXT,
  purchase_channel TEXT NOT NULL CHECK (purchase_channel = 'target_online'),
  model_number TEXT,
  upc_or_gtin TEXT,
  target_item_id TEXT,
  is_target_plus INTEGER NOT NULL DEFAULT 0 CHECK (is_target_plus IN (0, 1)),
  known_exclusion TEXT,
  status TEXT NOT NULL,
  fingerprint_id TEXT,
  monitoring_deadline TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases (status);
CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date ON purchases (purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_fingerprint_id ON purchases (fingerprint_id);

CREATE TABLE IF NOT EXISTS product_matches (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  fingerprint_id TEXT,
  seller_kind TEXT NOT NULL,
  seller_text TEXT NOT NULL,
  product_title TEXT NOT NULL,
  product_url TEXT NOT NULL,
  target_item_id TEXT,
  model_number TEXT,
  upc_or_gtin TEXT,
  brand TEXT,
  size TEXT,
  color TEXT,
  weight TEXT,
  quantity TEXT,
  observed_price REAL CHECK (observed_price IS NULL OR observed_price > 0),
  currency TEXT CHECK (currency IS NULL OR currency = 'USD'),
  is_target_plus INTEGER NOT NULL DEFAULT 0 CHECK (is_target_plus IN (0, 1)),
  confirmed_at TEXT,
  fingerprint_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases (id)
);

CREATE INDEX IF NOT EXISTS idx_product_matches_purchase_id ON product_matches (purchase_id);
CREATE INDEX IF NOT EXISTS idx_product_matches_fingerprint_id ON product_matches (fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_product_matches_lifecycle ON product_matches (lifecycle);

CREATE TABLE IF NOT EXISTS price_observations (
  id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT,
  fingerprint_id TEXT,
  provider_status TEXT NOT NULL,
  seller_kind TEXT NOT NULL,
  seller_text TEXT NOT NULL,
  product_title TEXT NOT NULL,
  product_url TEXT,
  target_item_id TEXT,
  model_number TEXT,
  upc_or_gtin TEXT,
  observed_price REAL CHECK (observed_price IS NULL OR observed_price > 0),
  currency TEXT CHECK (currency IS NULL OR currency = 'USD'),
  observed_at TEXT NOT NULL,
  is_target_plus INTEGER NOT NULL DEFAULT 0 CHECK (is_target_plus IN (0, 1)),
  price_source_type TEXT NOT NULL,
  provider TEXT,
  engine TEXT,
  query TEXT,
  location TEXT,
  country TEXT,
  language TEXT,
  device TEXT,
  raw_result_hash TEXT,
  matching_rule_version TEXT,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases (id)
);

CREATE INDEX IF NOT EXISTS idx_price_observations_purchase_id ON price_observations (purchase_id);
CREATE INDEX IF NOT EXISTS idx_price_observations_fingerprint_id ON price_observations (fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_price_observations_observed_at ON price_observations (observed_at);
