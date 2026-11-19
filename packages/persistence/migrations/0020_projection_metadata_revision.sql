ALTER TABLE executions ADD COLUMN state_revision INTEGER;
ALTER TABLE releases ADD COLUMN completion_revision INTEGER;
CREATE INDEX executions_state_pending_repository ON executions(repository_id,id) WHERE state_version IS NULL;

-- Old writers never associated metadata with a revision. Rebuild it before rollout.
UPDATE executions SET state_version=NULL;
DELETE FROM release_completion_frontier;
UPDATE releases SET completion_format=NULL,completion_stream=NULL,completion_group=NULL,
 completion_release_version=NULL,completion_sort=NULL,completion_at=NULL;

CREATE TRIGGER executions_metadata_changed
AFTER UPDATE OF document,revision,repository_id ON executions
WHEN NEW.state_version IS NOT NULL AND (
 NEW.state_revision IS NOT NEW.revision OR (
  NEW.state_revision IS OLD.state_revision AND (
   NEW.document IS NOT OLD.document OR NEW.repository_id IS NOT OLD.repository_id
  )
 )
)
BEGIN
 UPDATE executions SET state_version=NULL,state_revision=NULL WHERE id=NEW.id;
END;

CREATE TRIGGER releases_metadata_changed
AFTER UPDATE OF document,revision,repository_id,updated_at ON releases
WHEN NEW.completion_format IS NOT NULL AND (
 NEW.completion_revision IS NOT NEW.revision OR (
  NEW.completion_revision IS OLD.completion_revision AND (
   NEW.document IS NOT OLD.document OR NEW.repository_id IS NOT OLD.repository_id OR NEW.updated_at IS NOT OLD.updated_at
  )
 )
)
BEGIN
 UPDATE releases SET completion_format=NULL,completion_revision=NULL,completion_stream=NULL,completion_group=NULL,
  completion_release_version=NULL,completion_sort=NULL,completion_at=NULL WHERE id=NEW.id;
END;

-- A nested compatibility invalidation can run before these outer after-triggers.
-- Consult the live row rather than inserting a stale NEW proof.
DROP TRIGGER release_completion_frontier_insert;
DROP TRIGGER release_completion_frontier_update;
CREATE TRIGGER release_completion_frontier_insert
AFTER INSERT ON releases WHEN EXISTS (SELECT 1 FROM releases WHERE id=NEW.id AND completion_format=1) AND NEW.completion_sort IS NOT NULL
BEGIN
 DELETE FROM release_completion_frontier WHERE repository_id=NEW.repository_id AND completion_stream=NEW.completion_stream AND completion_group IS NEW.completion_group
  AND completion_sort BETWEEN (
   SELECT completion_sort FROM release_completion_frontier
   WHERE repository_id=NEW.repository_id AND completion_stream=NEW.completion_stream
    AND completion_group IS NEW.completion_group AND completion_at<=NEW.completion_at
   ORDER BY completion_at DESC LIMIT 1
  ) AND NEW.completion_sort;
 INSERT INTO release_completion_frontier(id,repository_id,completion_stream,completion_group,completion_sort,completion_at)
 SELECT NEW.id,NEW.repository_id,NEW.completion_stream,NEW.completion_group,NEW.completion_sort,NEW.completion_at
 WHERE NOT COALESCE((
  SELECT completion_at FROM release_completion_frontier
  WHERE repository_id=NEW.repository_id AND completion_stream=NEW.completion_stream
   AND completion_group IS NEW.completion_group AND completion_sort>=NEW.completion_sort
  ORDER BY completion_sort LIMIT 1
 )>=NEW.completion_at,0);
END;
CREATE TRIGGER release_completion_frontier_update
AFTER UPDATE OF id,repository_id,completion_stream,completion_group,completion_sort,completion_at ON releases
WHEN EXISTS (SELECT 1 FROM releases WHERE id=NEW.id AND completion_format=1) AND NEW.completion_sort IS NOT NULL AND (OLD.id IS NOT NEW.id OR OLD.repository_id IS NOT NEW.repository_id
 OR OLD.completion_stream IS NOT NEW.completion_stream OR OLD.completion_group IS NOT NEW.completion_group
 OR OLD.completion_sort IS NOT NEW.completion_sort OR OLD.completion_at IS NOT NEW.completion_at)
BEGIN
 DELETE FROM release_completion_frontier WHERE repository_id=NEW.repository_id AND completion_stream=NEW.completion_stream AND completion_group IS NEW.completion_group
  AND completion_sort BETWEEN (
   SELECT completion_sort FROM release_completion_frontier
   WHERE repository_id=NEW.repository_id AND completion_stream=NEW.completion_stream
    AND completion_group IS NEW.completion_group AND completion_at<=NEW.completion_at
   ORDER BY completion_at DESC LIMIT 1
  ) AND NEW.completion_sort;
 INSERT INTO release_completion_frontier(id,repository_id,completion_stream,completion_group,completion_sort,completion_at)
 SELECT NEW.id,NEW.repository_id,NEW.completion_stream,NEW.completion_group,NEW.completion_sort,NEW.completion_at
 WHERE NOT COALESCE((
  SELECT completion_at FROM release_completion_frontier
  WHERE repository_id=NEW.repository_id AND completion_stream=NEW.completion_stream
   AND completion_group IS NEW.completion_group AND completion_sort>=NEW.completion_sort
  ORDER BY completion_sort LIMIT 1
 )>=NEW.completion_at,0);
END;

-- Older projection writers replace this timestamp even for events without occurredAt.
CREATE TRIGGER releases_earliest_projection_time
AFTER UPDATE OF updated_at ON releases
WHEN NEW.updated_at>OLD.updated_at
BEGIN
 UPDATE releases SET updated_at=OLD.updated_at WHERE id=NEW.id;
END;

CREATE TRIGGER executions_metadata_inserted
AFTER INSERT ON executions
WHEN NEW.state_version IS NOT NULL AND NEW.state_revision IS NOT NEW.revision
BEGIN
 UPDATE executions SET state_version=NULL,state_revision=NULL WHERE id=NEW.id;
END;

CREATE TRIGGER releases_metadata_inserted
AFTER INSERT ON releases
WHEN NEW.completion_format IS NOT NULL AND NEW.completion_revision IS NOT NEW.revision
BEGIN
 UPDATE releases SET completion_format=NULL,completion_revision=NULL,completion_stream=NULL,completion_group=NULL,
  completion_release_version=NULL,completion_sort=NULL,completion_at=NULL WHERE id=NEW.id;
END;
