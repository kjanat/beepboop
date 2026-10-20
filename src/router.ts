import {
  compareVersions,
  type GitHubPort,
  type Journal,
  type Operation,
  operationId,
  type Route,
  sameRelease,
} from "@/model.ts";

const RETRY_MS = 60_000;
const AMBIGUOUS_GRACE_MS = 10 * 60_000;
const MAX_DISPATCHES = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** Serial execution is provided by the Durable Object. Every network side effect is journaled first. */
export class Router {
  constructor(
    private readonly journal: Journal,
    private readonly github: GitHubPort,
    private readonly now: () => number = Date.now,
  ) {}

  async discover(route: Route): Promise<void> {
    const release = await this.github.latest(route);
    if (!release || compareVersions(release.tag, route.minimumVersion) < 0) return;
    const id = operationId(route, release);
    const existing = await this.journal.get(id);
    if (existing) return;
    const watermark = await this.journal.watermark(route.id);
    if (watermark && compareVersions(release.tag, watermark) <= 0) return;
    await this.journal.put({
      id,
      routeId: route.id,
      routeIdentity: JSON.stringify(route),
      release,
      attempts: 0,
      state: "waiting",
      reason: "Waiting for publication",
      updatedAt: this.now(),
      nextAttempt: this.now(),
    });
  }

  async tick(route: Route, operation: Operation): Promise<void> {
    if (
      operation.state === "succeeded" ||
      (operation.state === "failed" &&
        (operation.retry === null || operation.retry.until < this.now())) ||
      operation.nextAttempt > this.now()
    )
      return;
    const update = { ...operation, updatedAt: this.now(), nextAttempt: this.now() + RETRY_MS };
    try {
      if (operation.routeIdentity !== JSON.stringify(route)) {
        await this.fail(update, "Route configuration changed; create a new route ID");
        return;
      }
      const release = await this.github.release(route, operation.release.id);
      if (!release || !sameRelease(operation.release, release)) {
        await this.fail(update, "Release or artifact identity changed");
        return;
      }
      const watermark = await this.journal.watermark(route.id);
      if (watermark && compareVersions(release.tag, watermark) < 0) {
        await this.fail(update, "Superseded by a newer release");
        return;
      }
      const pendingRun =
        operation.state === "dispatched"
          ? operation.runId
          : operation.state === "failed"
            ? operation.retry?.runId
            : undefined;
      if (pendingRun !== undefined) {
        const run = await this.github.run(route, pendingRun, operation.id);
        if (run.status !== "completed") {
          await this.journal.put(update);
          return;
        }
        if (run.conclusion !== "success") {
          await this.fail(
            update,
            `Destination workflow concluded ${run.conclusion ?? "unknown"}`,
            pendingRun,
          );
          return;
        }
        await this.journal.advance(route.id, release.tag);
        await this.journal.put({ ...update, state: "succeeded", runId: run.id });
        return;
      }
      if (operation.state === "dispatching") {
        const run = await this.github.reconcile(route, operation);
        if (run) {
          await this.journal.put({ ...update, state: "dispatched", runId: run.id });
          return;
        }
        if (this.now() - operation.startedAt < AMBIGUOUS_GRACE_MS) {
          await this.journal.put(update);
          return;
        }
        if (operation.attempts >= MAX_DISPATCHES) {
          await this.fail(update, "Dispatch remained ambiguous after retries; inspect destination");
          return;
        }
      }
      if (this.now() - Date.parse(release.publishedAt) > MAX_AGE_MS) {
        await this.fail(update, "Publication readiness expired");
        return;
      }
      if (!(await this.github.ready(route, release))) {
        await this.journal.put({ ...update, state: "waiting", reason: "Waiting for publication" });
        return;
      }
      // Reserve the version before dispatch: a delayed older operation cannot overtake it.
      await this.journal.advance(route.id, release.tag);
      const dispatching: Operation = {
        ...update,
        state: "dispatching",
        startedAt: this.now(),
        attempts: operation.attempts + 1,
      };
      await this.journal.put(dispatching);
      const runId = await this.github.dispatch(route, dispatching);
      await this.journal.put({ ...dispatching, state: "dispatched", runId });
    } catch {
      // Never persist API error bodies or credentials. Preserve dispatching if request outcome is unknown.
      const latest = await this.journal.get(operation.id);
      if (latest?.state === "dispatching") {
        await this.journal.put({
          ...latest,
          nextAttempt: this.now() + RETRY_MS,
          updatedAt: this.now(),
        });
      } else {
        await this.journal.put(update);
      }
    }
  }
  private async fail(operation: Operation, reason: string, runId?: number): Promise<void> {
    const retry =
      runId === undefined
        ? null
        : {
            runId,
            until:
              operation.state === "failed" && operation.retry !== null
                ? operation.retry.until
                : this.now() + MAX_AGE_MS,
          };
    await this.journal.put({ ...operation, state: "failed", reason, retry, updatedAt: this.now() });
  }
}
