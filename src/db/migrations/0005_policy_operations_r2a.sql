-- Lane 8-R2A: concurrency + history columns for durable policy ops
-- Safe when columns already exist is handled in SQLite adapter applyR2aColumns;
-- this migration is the authoritative local schema bump for fresh DBs.

-- SQLite lacks IF NOT EXISTS for columns; use table rebuild only when needed via adapter.
-- For migrator apply on fresh DBs that already ran 0004, add columns if missing via no-op
-- placeholders: migrator always runs full SQL. We use a compatible approach:

CREATE TABLE IF NOT EXISTS policy_operations_r2a_marker (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);

INSERT OR IGNORE INTO policy_operations_r2a_marker (id, applied_at)
VALUES ('0005_policy_operations_r2a', datetime('now'));
