-- Lane 4: matching metadata on product_matches + locked fingerprint table

ALTER TABLE product_matches ADD COLUMN serpapi_product_id TEXT;
ALTER TABLE product_matches ADD COLUMN match_decision TEXT;
ALTER TABLE product_matches ADD COLUMN match_tier TEXT;
ALTER TABLE product_matches ADD COLUMN match_rule_version TEXT;
ALTER TABLE product_matches ADD COLUMN rejection_reason TEXT;

CREATE TABLE IF NOT EXISTS product_fingerprints (
  fingerprint_id TEXT PRIMARY KEY NOT NULL,
  purchase_id TEXT NOT NULL,
  product_match_id TEXT NOT NULL,
  target_product_url TEXT NOT NULL,
  target_item_id TEXT,
  model_number TEXT,
  upc_or_gtin TEXT,
  brand TEXT,
  size TEXT,
  color TEXT,
  weight TEXT,
  quantity TEXT,
  product_title TEXT,
  seller_kind TEXT NOT NULL CHECK (seller_kind = 'target'),
  is_target_plus INTEGER NOT NULL DEFAULT 0 CHECK (is_target_plus = 0),
  match_rule_version TEXT NOT NULL,
  match_tier TEXT NOT NULL,
  fingerprint_json TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmed_by_user INTEGER NOT NULL CHECK (confirmed_by_user = 1),
  created_at TEXT NOT NULL,
  UNIQUE (purchase_id),
  FOREIGN KEY (purchase_id) REFERENCES purchases (id),
  FOREIGN KEY (product_match_id) REFERENCES product_matches (id)
);

CREATE INDEX IF NOT EXISTS idx_product_fingerprints_purchase_id
  ON product_fingerprints (purchase_id);
CREATE INDEX IF NOT EXISTS idx_product_matches_match_decision
  ON product_matches (match_decision);
