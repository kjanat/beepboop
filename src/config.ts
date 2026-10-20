import {
  array,
  boolean,
  type Configuration,
  integer,
  matches,
  type Repository,
  type Route,
  record,
  semver,
  text,
} from "@/model.ts";
import raw from "../routes.json";

function repository(value: unknown, owner: string): Repository {
  const data = record(value);
  const name = matches(data.name, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  if (name.split("/")[0] !== owner) throw new Error("Route repository outside configured owner");
  return { id: integer(data.id), name };
}
function workflow(value: unknown): string {
  return matches(value, /^[A-Za-z0-9_.-]+\.ya?ml$/);
}
export function parseConfiguration(value: unknown): Configuration {
  const data = record(value);
  const owner = matches(data.owner, /^[A-Za-z0-9-]+$/);
  const enabled = boolean(data.enabled);
  const ownerId = enabled ? integer(data.ownerId) : Number(data.ownerId);
  const routes: Route[] = array(data.routes).map((value) => {
    const row = record(value);
    const readiness = array(row.readiness).map((value) => {
      const item = record(value);
      const jobs = array(item.jobs).map(text);
      if (jobs.length === 0) throw new Error("Readiness must require a job");
      return { workflow: workflow(item.workflow), jobs };
    });
    if (readiness.length === 0) throw new Error("Route requires publication evidence");
    return {
      id: matches(row.id, /^[a-z][a-z0-9-]{0,63}$/),
      source: repository(row.source, owner),
      destination: repository(row.destination, owner),
      workflow: workflow(row.workflow),
      ref: matches(row.ref, /^[A-Za-z0-9][A-Za-z0-9_./-]*$/),
      minimumVersion: semver(row.minimumVersion),
      readiness,
      assets: array(row.assets).map((value) => matches(value, /^[A-Za-z0-9_.{}-]+$/)),
      pypi: row.pypi === null ? null : matches(row.pypi, /^[A-Za-z0-9_.-]+$/),
      dryRun: boolean(row.dryRun),
    };
  });
  if (new Set(routes.map((route) => route.id)).size !== routes.length)
    throw new Error("Duplicate route ID");
  for (const route of routes) {
    if (route.source.id === route.destination.id) throw new Error("Self-dispatch route forbidden");
  }
  return { owner, ownerId, enabled, routes };
}
export const configuration = parseConfiguration(raw);
