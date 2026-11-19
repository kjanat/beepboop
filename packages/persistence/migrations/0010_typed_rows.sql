ALTER TABLE sessions ADD COLUMN kind TEXT;
ALTER TABLE audit ADD COLUMN actor_json TEXT;
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
