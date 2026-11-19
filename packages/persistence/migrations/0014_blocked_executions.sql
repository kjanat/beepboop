CREATE INDEX IF NOT EXISTS executions_blocked ON executions(
 (state IN ('pending','ready','dispatching','running','verifying','awaiting-approval')) DESC,
 (CASE WHEN json_valid(document) THEN json_extract(document,'$.createdAt') END) DESC,
 id
) WHERE state='blocked';
