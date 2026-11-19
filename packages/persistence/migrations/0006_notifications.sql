CREATE TABLE notification_destinations (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('slack', 'http')),
 credential TEXT NOT NULL,
 subscribe_new INTEGER NOT NULL DEFAULT 0 CHECK (subscribe_new IN (0, 1)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
 created_at INTEGER NOT NULL
);
CREATE TABLE notification_subscriptions (
 destination_id TEXT NOT NULL REFERENCES notification_destinations(id) ON DELETE CASCADE,
 registry TEXT NOT NULL CHECK (registry IN ('npm', 'jsr')),
 name TEXT NOT NULL,
 PRIMARY KEY (destination_id, registry, name)
);
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL,
 destination_id TEXT NOT NULL,
 document TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 updated_at INTEGER NOT NULL
);
CREATE INDEX notification_deliveries_pending ON notification_deliveries(state, updated_at);
