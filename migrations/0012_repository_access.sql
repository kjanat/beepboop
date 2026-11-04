ALTER TABLE repositories ADD COLUMN access TEXT NOT NULL DEFAULT 'active';
ALTER TABLE repositories ADD COLUMN suspended_at INTEGER;
UPDATE repositories SET access = 'suspended', suspended_at = updated_at
 WHERE CASE WHEN json_valid(document) THEN json_extract(document, '$.suspended') ELSE 0 END = 1;
