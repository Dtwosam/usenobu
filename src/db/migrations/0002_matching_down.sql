-- Reverse Lane 4 matching migration

DROP INDEX IF EXISTS idx_product_matches_match_decision;
DROP INDEX IF EXISTS idx_product_fingerprints_purchase_id;
DROP TABLE IF EXISTS product_fingerprints;

-- SQLite cannot DROP COLUMN portably on older versions; recreate product_matches without new cols
-- For proof harness we leave added columns on down only if table drop not needed.
-- Full down: rebuild product_matches without matching columns.

CREATE TABLE IF NOT EXISTS product_matches_lane1 (
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

INSERT INTO product_matches_lane1 (
  id, purchase_id, lifecycle, fingerprint_id, seller_kind, seller_text,
  product_title, product_url, target_item_id, model_number, upc_or_gtin,
  brand, size, color, weight, quantity, observed_price, currency,
  is_target_plus, confirmed_at, fingerprint_json, created_at
)
SELECT
  id, purchase_id, lifecycle, fingerprint_id, seller_kind, seller_text,
  product_title, product_url, target_item_id, model_number, upc_or_gtin,
  brand, size, color, weight, quantity, observed_price, currency,
  is_target_plus, confirmed_at, fingerprint_json, created_at
FROM product_matches;

DROP TABLE product_matches;
ALTER TABLE product_matches_lane1 RENAME TO product_matches;

CREATE INDEX IF NOT EXISTS idx_product_matches_purchase_id ON product_matches (purchase_id);
CREATE INDEX IF NOT EXISTS idx_product_matches_fingerprint_id ON product_matches (fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_product_matches_lifecycle ON product_matches (lifecycle);
