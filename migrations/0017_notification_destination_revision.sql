ALTER TABLE notification_destinations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);
