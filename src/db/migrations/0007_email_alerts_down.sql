-- Reverse Lane 7.3B email alerts + schedule fields

DROP INDEX IF EXISTS idx_closed_opportunities_purchase;
DROP TABLE IF EXISTS closed_price_opportunities;

DROP INDEX IF EXISTS idx_email_notifications_alert;
DROP INDEX IF EXISTS idx_email_notifications_purchase;
DROP INDEX IF EXISTS idx_email_notifications_account_created;
DROP TABLE IF EXISTS email_notifications;

DROP INDEX IF EXISTS idx_email_alert_prefs_account;
DROP TABLE IF EXISTS purchase_email_alert_prefs;

-- SQLite cannot DROP COLUMN portably; schedule columns left in place on down.
