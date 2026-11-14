ALTER TABLE releases ADD COLUMN completion_format INTEGER;
ALTER TABLE releases ADD COLUMN completion_stream TEXT;
ALTER TABLE releases ADD COLUMN completion_group TEXT;
ALTER TABLE releases ADD COLUMN completion_release_version TEXT;
ALTER TABLE releases ADD COLUMN completion_sort TEXT;
ALTER TABLE releases ADD COLUMN completion_at INTEGER;
CREATE INDEX releases_completion_pending ON releases(repository_id,id) WHERE completion_format IS NULL;
CREATE INDEX releases_completion_proof ON releases(repository_id,completion_stream,completion_group,completion_sort DESC,completion_at DESC) WHERE completion_sort IS NOT NULL;

CREATE TABLE release_completion_frontier (
 id TEXT PRIMARY KEY,
 repository_id INTEGER NOT NULL,
 completion_stream TEXT NOT NULL,
 completion_group TEXT,
 completion_sort TEXT NOT NULL,
 completion_at INTEGER NOT NULL
);
CREATE INDEX release_completion_frontier_lookup ON release_completion_frontier(
 repository_id,completion_stream,completion_group,completion_sort
);
CREATE INDEX release_completion_frontier_time ON release_completion_frontier(
 repository_id,completion_stream,completion_group,completion_at DESC
);

-- Only a changed/deleted frontier point can expose previously dominated releases.
-- Rebuild its old group before the row changes; the after trigger inserts the new point.
CREATE TRIGGER release_completion_frontier_remove_update
BEFORE UPDATE OF id,repository_id,completion_stream,completion_group,completion_sort,completion_at ON releases
WHEN (OLD.id IS NOT NEW.id OR OLD.repository_id IS NOT NEW.repository_id
 OR OLD.completion_stream IS NOT NEW.completion_stream OR OLD.completion_group IS NOT NEW.completion_group
 OR OLD.completion_sort IS NOT NEW.completion_sort OR OLD.completion_at IS NOT NEW.completion_at) AND EXISTS (SELECT 1 FROM release_completion_frontier WHERE id=OLD.id)
BEGIN
 DELETE FROM release_completion_frontier WHERE repository_id=OLD.repository_id AND completion_stream=OLD.completion_stream AND completion_group IS OLD.completion_group;
 INSERT INTO release_completion_frontier(id,repository_id,completion_stream,completion_group,completion_sort,completion_at)
 SELECT id,repository_id,completion_stream,completion_group,completion_sort,completion_at FROM (
  SELECT id,repository_id,completion_stream,completion_group,completion_sort,completion_at,
   MAX(completion_at) OVER (
    ORDER BY completion_sort DESC,completion_at DESC,id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
   ) AS later_max
  FROM releases WHERE repository_id=OLD.repository_id AND completion_stream=OLD.completion_stream AND completion_group IS OLD.completion_group AND id<>OLD.id AND completion_sort IS NOT NULL
 ) WHERE later_max IS NULL OR completion_at>later_max;
END;
CREATE TRIGGER release_completion_frontier_remove_delete
BEFORE DELETE ON releases
WHEN EXISTS (SELECT 1 FROM release_completion_frontier WHERE id=OLD.id)
BEGIN
 DELETE FROM release_completion_frontier WHERE repository_id=OLD.repository_id AND completion_stream=OLD.completion_stream AND completion_group IS OLD.completion_group;
 INSERT INTO release_completion_frontier(id,repository_id,completion_stream,completion_group,completion_sort,completion_at)
 SELECT id,repository_id,completion_stream,completion_group,completion_sort,completion_at FROM (
  SELECT id,repository_id,completion_stream,completion_group,completion_sort,completion_at,
   MAX(completion_at) OVER (
    ORDER BY completion_sort DESC,completion_at DESC,id
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
   ) AS later_max
  FROM releases WHERE repository_id=OLD.repository_id AND completion_stream=OLD.completion_stream AND completion_group IS OLD.completion_group AND id<>OLD.id AND completion_sort IS NOT NULL
 ) WHERE later_max IS NULL OR completion_at>later_max;
END;
CREATE TRIGGER release_completion_frontier_insert
AFTER INSERT ON releases WHEN NEW.completion_sort IS NOT NULL
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
WHEN NEW.completion_sort IS NOT NULL AND (OLD.id IS NOT NEW.id OR OLD.repository_id IS NOT NEW.repository_id
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
