ALTER TABLE executions ADD COLUMN revision INTEGER;
ALTER TABLE executions ADD COLUMN phase TEXT;
ALTER TABLE executions ADD COLUMN view TEXT;
CREATE TABLE IF NOT EXISTS release_sets (
 id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS release_sets_repository ON release_sets(repository_id);
CREATE TABLE IF NOT EXISTS releases (
 id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS releases_repository ON releases(repository_id);
CREATE TABLE IF NOT EXISTS changes (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, repository_id INTEGER NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_repository ON changes(repository_id, seq);
CREATE INDEX IF NOT EXISTS changes_created ON changes(created_at);
