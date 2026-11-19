CREATE TABLE release_events (
 id TEXT PRIMARY KEY, document TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE subscription_deliveries (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES release_events(id),
 repository_id INTEGER NOT NULL, document TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', error TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX subscription_deliveries_pending ON subscription_deliveries(state, updated_at);
