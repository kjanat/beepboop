CREATE TABLE watched_packages (
 registry TEXT NOT NULL CHECK (registry IN ('npm', 'jsr')),
 name TEXT NOT NULL,
 manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1)),
 version TEXT,
 checked_at INTEGER,
 changed_at INTEGER,
 error TEXT,
 added_at INTEGER NOT NULL,
 PRIMARY KEY (registry, name)
);
