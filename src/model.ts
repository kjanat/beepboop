export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Expected nonempty string");
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Expected positive integer");
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Expected boolean");
  return value;
}
export function matches(value: unknown, pattern: RegExp): string {
  const result = text(value);
  if (!pattern.test(result)) throw new Error("Invalid value format");
  return result;
}
export function sha(value: unknown): string {
  return matches(value, /^[0-9a-f]{40}$/);
}
export function semver(value: unknown): string {
  return matches(value, /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
}
export function compareVersions(left: string, right: string): number {
  const a = semver(left).replace(/^v/, "").split(".").map(BigInt);
  const b = semver(right).replace(/^v/, "").split(".").map(BigInt);
  for (let i = 0; i < 3; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) throw new Error("Invalid version");
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
export interface Repository {
  id: number;
  name: string;
}
export interface Readiness {
  workflow: string;
  jobs: string[];
}
export interface Route {
  id: string;
  source: Repository;
  destination: Repository;
  workflow: string;
  ref: string;
  minimumVersion: string;
  readiness: Readiness[];
  assets: string[];
  pypi: string | null;
  dryRun: boolean;
}
export interface Configuration {
  owner: string;
  ownerId: number;
  enabled: boolean;
  routes: Route[];
}
export interface Release {
  id: number;
  tag: string;
  sha: string;
  publishedAt: string;
  assets: { id: number; name: string; size: number; digest: string }[];
}
export interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  title: string;
  sha: string;
  branch: string;
  event: string;
  path: string;
  repositoryId: number;
}
interface Identity {
  id: string;
  routeId: string;
  routeIdentity: string;
  release: Release;
  attempts: number;
  updatedAt: number;
  nextAttempt: number;
}
export type Operation = Identity &
  (
    | { state: "waiting"; reason: string }
    | { state: "dispatching"; startedAt: number }
    | { state: "dispatched"; runId: number }
    | { state: "succeeded"; runId: number }
    | { state: "failed"; reason: string; retry: { runId: number; until: number } | null }
  );
export function operationId(route: Route, release: Release): string {
  return `${route.source.id}:${release.id}:${route.id}`;
}
export function sameRelease(left: Release, right: Release): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
export interface Journal {
  get(id: string): Promise<Operation | undefined>;
  put(operation: Operation): Promise<void>;
  all(): Promise<Operation[]>;
  watermark(routeId: string): Promise<string | undefined>;
  advance(routeId: string, version: string): Promise<void>;
}
export interface GitHubPort {
  latest(route: Route): Promise<Release | null>;
  release(route: Route, id: number): Promise<Release | null>;
  ready(route: Route, release: Release): Promise<boolean>;
  dispatch(route: Route, operation: Operation): Promise<number>;
  reconcile(route: Route, operation: Operation): Promise<Run | null>;
  run(route: Route, id: number, operationId: string): Promise<Run>;
}
