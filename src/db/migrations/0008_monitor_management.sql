-- Lane 7.4E: agent-native stop-monitoring fields (distinct from archive)

ALTER TABLE purchases ADD COLUMN monitoring_stopped_at TEXT;
ALTER TABLE purchases ADD COLUMN monitoring_stop_reason TEXT;
