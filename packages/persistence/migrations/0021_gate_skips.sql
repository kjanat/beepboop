CREATE TABLE gate_skips (
 repository_id INTEGER NOT NULL,
 stream TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('signature', 'check', 'status', 'metadata')),
 name TEXT NOT NULL DEFAULT '',
 actor TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY (repository_id, stream, kind, name),
 CHECK ((kind = 'check') = (name <> ''))
);
