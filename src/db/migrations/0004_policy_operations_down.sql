-- Reverse Lane 8-R1A policy operations migration

DROP INDEX IF EXISTS idx_policy_review_events_policy;
DROP TABLE IF EXISTS policy_review_events;

DROP INDEX IF EXISTS idx_policy_pending_reviews_status;
DROP TABLE IF EXISTS policy_pending_reviews;

DROP INDEX IF EXISTS idx_policy_owner_alerts_policy;
DROP INDEX IF EXISTS idx_policy_owner_alerts_status;
DROP TABLE IF EXISTS policy_owner_alerts;

DROP INDEX IF EXISTS idx_policy_operations_next_review;
DROP INDEX IF EXISTS idx_policy_operations_review_state;
DROP TABLE IF EXISTS policy_operations;
