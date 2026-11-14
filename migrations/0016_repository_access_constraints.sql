UPDATE repositories SET suspended_at = NULL WHERE access = 'active';
UPDATE repositories SET suspended_at = updated_at WHERE access = 'suspended' AND suspended_at IS NULL;
CREATE TRIGGER repositories_access_insert BEFORE INSERT ON repositories
 WHEN NEW.access NOT IN ('active', 'suspended')
 OR (NEW.access = 'active' AND NEW.suspended_at IS NOT NULL)
 OR (NEW.access = 'suspended' AND NEW.suspended_at IS NULL)
 BEGIN SELECT RAISE(ABORT, 'Invalid repository access state'); END;
CREATE TRIGGER repositories_access_update BEFORE UPDATE OF access, suspended_at ON repositories
 WHEN NEW.access NOT IN ('active', 'suspended')
 OR (NEW.access = 'active' AND NEW.suspended_at IS NOT NULL)
 OR (NEW.access = 'suspended' AND NEW.suspended_at IS NULL)
 BEGIN SELECT RAISE(ABORT, 'Invalid repository access state'); END;
