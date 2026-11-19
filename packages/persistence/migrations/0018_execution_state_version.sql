ALTER TABLE executions ADD COLUMN state_version INTEGER;
CREATE INDEX executions_state_pending ON executions(id) WHERE state_version IS NULL;
