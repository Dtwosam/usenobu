-- Reverse Nobu Lane 1 initial schema (repeatable with up migration).

DROP INDEX IF EXISTS idx_price_observations_observed_at;
DROP INDEX IF EXISTS idx_price_observations_fingerprint_id;
DROP INDEX IF EXISTS idx_price_observations_purchase_id;
DROP TABLE IF EXISTS price_observations;

DROP INDEX IF EXISTS idx_product_matches_lifecycle;
DROP INDEX IF EXISTS idx_product_matches_fingerprint_id;
DROP INDEX IF EXISTS idx_product_matches_purchase_id;
DROP TABLE IF EXISTS product_matches;

DROP INDEX IF EXISTS idx_purchases_fingerprint_id;
DROP INDEX IF EXISTS idx_purchases_purchase_date;
DROP INDEX IF EXISTS idx_purchases_status;
DROP TABLE IF EXISTS purchases;

DROP TABLE IF EXISTS policy_versions;

-- schema_migrations row for 0001 is removed by the migrator after down runs.
