-- Reverse Lane 5 monitoring migration

DROP INDEX IF EXISTS idx_alerts_alert_key;
DROP INDEX IF EXISTS idx_alerts_fingerprint_id;
DROP INDEX IF EXISTS idx_alerts_purchase_id;
DROP TABLE IF EXISTS alerts;

DROP INDEX IF EXISTS idx_monitor_runs_outcome;
DROP INDEX IF EXISTS idx_monitor_runs_purchase_id;
DROP TABLE IF EXISTS monitor_runs;

DROP TABLE IF EXISTS search_budget_ledger;
