ALTER TABLE watched_packages ADD COLUMN awaiting_release INTEGER NOT NULL DEFAULT 0 CHECK (awaiting_release IN (0, 1));
