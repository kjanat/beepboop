ALTER TABLE repositories ADD COLUMN added_at INTEGER;
UPDATE repositories SET added_at = updated_at WHERE added_at IS NULL;
