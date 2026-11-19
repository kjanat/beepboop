CREATE TABLE IF NOT EXISTS repositories (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, document TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS executions (
 id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, state TEXT NOT NULL, document TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS executions_repository ON executions(repository_id, updated_at);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS credentials (
 alias TEXT NOT NULL, version INTEGER NOT NULL, key_id TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY(alias, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS credentials_active ON credentials(alias) WHERE active=1;
CREATE TABLE IF NOT EXISTS grants (
 id TEXT PRIMARY KEY, alias TEXT NOT NULL, repository_id INTEGER NOT NULL, document TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secret_deliveries (
 grant_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(grant_id, version)
);
CREATE TABLE IF NOT EXISTS authenticators (
 id TEXT PRIMARY KEY, subject TEXT NOT NULL, document TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, document TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS onboarding (
 repository_id INTEGER PRIMARY KEY, document TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, last_tick INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS preparations (id TEXT PRIMARY KEY, document TEXT NOT NULL);
