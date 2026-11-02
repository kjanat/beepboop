CREATE TABLE IF NOT EXISTS winget_submissions (
 id TEXT PRIMARY KEY,
 package TEXT NOT NULL,
 version TEXT NOT NULL,
 document TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 lease TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 UNIQUE(package, version)
);

CREATE TABLE IF NOT EXISTS winget_watches (repository_id INTEGER PRIMARY KEY, since INTEGER NOT NULL);
