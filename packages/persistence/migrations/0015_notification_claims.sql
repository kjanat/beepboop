CREATE TABLE notification_deliveries_claimed (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL,
 destination_id TEXT NOT NULL,
 document TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'delivered', 'failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 error TEXT,
 updated_at INTEGER NOT NULL,
 lease TEXT,
 lease_until INTEGER,
 CHECK (
  (state = 'sending' AND lease IS NOT NULL AND length(lease) > 0 AND lease_until IS NOT NULL AND attempts > 0)
  OR (state != 'sending' AND lease IS NULL AND lease_until IS NULL)
 ),
 CHECK (state != 'delivered' OR error IS NULL),
 CHECK (state != 'failed' OR error IS NOT NULL)
);
INSERT INTO notification_deliveries_claimed(id,event_id,destination_id,document,state,attempts,error,updated_at)
 SELECT id,event_id,destination_id,document,state,attempts,
  CASE WHEN state = 'delivered' THEN NULL WHEN state = 'failed' THEN COALESCE(error, 'Delivery failed') ELSE error END,
  updated_at FROM notification_deliveries;
DROP TABLE notification_deliveries;
ALTER TABLE notification_deliveries_claimed RENAME TO notification_deliveries;
CREATE INDEX notification_deliveries_pending ON notification_deliveries(state, updated_at);
