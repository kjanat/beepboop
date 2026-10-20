import { importPKCS8, SignJWT } from "jose";
import {
  array,
  boolean,
  compareVersions,
  type GitHubPort,
  integer,
  type Operation,
  type Release,
  type Repository,
  type Route,
  type Run,
  record,
  semver,
  sha,
  text,
} from "@/model.ts";

export interface Credentials {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}
export type Transport = (request: Request) => Promise<Response>;
const API = "https://api.github.com";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response size limit exceeded");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function parseRun(value: unknown): Run {
  const data = record(value);
  return {
    id: integer(data.id),
    status: text(data.status),
    conclusion: data.conclusion === null ? null : text(data.conclusion),
    title: text(data.display_title),
    sha: sha(data.head_sha),
    branch: text(data.head_branch),
    event: text(data.event),
    path: text(data.path),
    repositoryId: integer(record(data.repository).id),
  };
}
export class GitHub implements GitHubPort {
  constructor(
    private readonly credentials: Credentials,
    private readonly ownerId: number,
    private readonly transport: Transport = fetch,
  ) {}
  private async request(
    path: string,
    token: string,
    method = "GET",
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.transport(
      new Request(`${API}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "beepboop",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      }),
    );
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return responseJson(response);
  }
  private async token(repository: Repository, write: boolean): Promise<string> {
    const key = await importPKCS8(this.credentials.GITHUB_APP_PRIVATE_KEY, "RS256");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.credentials.GITHUB_APP_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime("9m")
      .sign(key);
    const installation = record(await this.request(`/repos/${repository.name}/installation`, jwt));
    if (integer(record(installation.account).id) !== this.ownerId)
      throw new Error("Installation owner mismatch");
    const result = record(
      await this.request(
        `/app/installations/${integer(installation.id)}/access_tokens`,
        jwt,
        "POST",
        {
          repository_ids: [repository.id],
          permissions: { contents: "read", actions: write ? "write" : "read" },
        },
      ),
    );
    const token = text(result.token);
    const actual = record(await this.request(`/repos/${repository.name}`, token));
    if (
      integer(actual.id) !== repository.id ||
      integer(record(actual.owner).id) !== this.ownerId ||
      text(actual.full_name) !== repository.name
    )
      throw new Error("Repository identity mismatch");
    return token;
  }
  private async parseRelease(route: Route, value: unknown, token: string): Promise<Release | null> {
    const data = record(value);
    if (boolean(data.draft) || boolean(data.prerelease)) return null;
    const tag = text(data.tag_name);
    try {
      semver(tag);
    } catch {
      return null;
    }
    const reference = record(
      await this.request(
        `/repos/${route.source.name}/git/ref/tags/${encodeURIComponent(tag)}`,
        token,
      ),
    );
    const tagReference = record(reference.object);
    if (tagReference.type !== "tag") throw new Error("Release tag must be annotated");
    const signed = record(
      await this.request(`/repos/${route.source.name}/git/tags/${sha(tagReference.sha)}`, token),
    );
    const commit = record(signed.object);
    if (
      signed.tag !== tag ||
      record(signed.verification).verified !== true ||
      commit.type !== "commit"
    )
      throw new Error("Release tag signature or target is invalid");
    const publishedAt = text(data.published_at);
    if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Invalid publication date");
    const assets = array(data.assets)
      .map((value) => {
        const asset = record(value);
        const size = asset.size;
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
          throw new Error("Invalid asset size");
        const digest = text(asset.digest);
        if (!/^sha256:[0-9a-f]{64}$/.test(digest))
          throw new Error("Release asset has no SHA256 digest");
        return { id: integer(asset.id), name: text(asset.name), size, digest };
      })
      .sort((a, b) => a.id - b.id);
    return { id: integer(data.id), tag, sha: sha(commit.sha), publishedAt, assets };
  }
  async latest(route: Route): Promise<Release | null> {
    const token = await this.token(route.source, false);
    // List instead of /latest: a missing release is an ordinary empty state, not an API failure.
    const releases: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const entries = array(
        await this.request(`/repos/${route.source.name}/releases?per_page=100&page=${page}`, token),
      );
      releases.push(...entries);
      if (entries.length < 100) break;
      if (page === 10) throw new Error("Release pagination limit exceeded");
    }
    const eligible = releases
      .map(record)
      .filter((item) => {
        if (boolean(item.draft) || boolean(item.prerelease)) return false;
        try {
          return compareVersions(semver(item.tag_name), route.minimumVersion) >= 0;
        } catch {
          return false;
        }
      })
      .sort((left, right) => compareVersions(semver(right.tag_name), semver(left.tag_name)));
    const latest = eligible[0];
    return latest ? this.parseRelease(route, latest, token) : null;
  }
  async release(route: Route, id: number): Promise<Release | null> {
    const token = await this.token(route.source, false);
    return this.parseRelease(
      route,
      await this.request(`/repos/${route.source.name}/releases/${id}`, token),
      token,
    );
  }
  private async runs(
    repository: Repository,
    workflow: string,
    token: string,
    filters: string,
  ): Promise<Run[]> {
    const result: Run[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = record(
        await this.request(
          `/repos/${repository.name}/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=100&page=${page}&${filters}`,
          token,
        ),
      );
      const entries = array(data.workflow_runs).map(parseRun);
      result.push(...entries);
      if (entries.length < 100) return result;
    }
    throw new Error("Workflow pagination limit exceeded");
  }
  async ready(route: Route, release: Release): Promise<boolean> {
    for (const expected of route.assets)
      if (
        !release.assets.some(
          (asset) => asset.name === expected.replaceAll("{version}", release.tag.replace(/^v/, "")),
        )
      )
        return false;
    const token = await this.token(route.source, false);
    for (const prerequisite of route.readiness) {
      const runs = await this.runs(
        route.source,
        prerequisite.workflow,
        token,
        `event=release&head_sha=${release.sha}`,
      );
      const matching = runs
        .filter(
          (run) =>
            run.repositoryId === route.source.id &&
            run.sha === release.sha &&
            run.branch === release.tag &&
            run.event === "release" &&
            run.path === `.github/workflows/${prerequisite.workflow}`,
        )
        .sort((a, b) => b.id - a.id);
      const run = matching[0];
      if (!run) return false;
      const jobs: Record<string, unknown>[] = [];
      for (let page = 1; page <= 10; page++) {
        const response = record(
          await this.request(
            `/repos/${route.source.name}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`,
            token,
          ),
        );
        const entries = array(response.jobs).map(record);
        jobs.push(...entries);
        if (entries.length < 100) break;
        if (page === 10) throw new Error("Job pagination limit exceeded");
      }
      if (
        !prerequisite.jobs.every((expected) =>
          jobs.some(
            (job) =>
              job.name === expected && job.status === "completed" && job.conclusion === "success",
          ),
        )
      )
        return false;
    }
    if (route.pypi) {
      const response = await this.transport(
        new Request(
          `https://pypi.org/pypi/${encodeURIComponent(route.pypi)}/${encodeURIComponent(release.tag.replace(/^v/, ""))}/json`,
          { redirect: "error", signal: AbortSignal.timeout(20_000) },
        ),
      );
      if (response.status === 404) return false;
      if (!response.ok) throw new Error("PyPI readiness lookup failed");
      const data = record(await responseJson(response));
      if (
        text(record(data.info).version) !== release.tag.replace(/^v/, "") ||
        array(data.urls).length === 0
      )
        return false;
    }
    return true;
  }
  async dispatch(route: Route, operation: Operation): Promise<number> {
    const token = await this.token(route.destination, true);
    const response = record(
      await this.request(
        `/repos/${route.destination.name}/actions/workflows/${encodeURIComponent(route.workflow)}/dispatches`,
        token,
        "POST",
        {
          ref: route.ref,
          inputs: {
            source_repository_id: String(route.source.id),
            release_id: String(operation.release.id),
            source_sha: operation.release.sha,
            operation_id: operation.id,
            dry_run: route.dryRun,
          },
        },
      ),
    );
    return integer(response.workflow_run_id);
  }
  private validDestinationRun(route: Route, run: Run): boolean {
    return (
      run.repositoryId === route.destination.id &&
      run.event === "workflow_dispatch" &&
      run.branch === route.ref &&
      run.path === `.github/workflows/${route.workflow}`
    );
  }
  async reconcile(route: Route, operation: Operation): Promise<Run | null> {
    const token = await this.token(route.destination, false);
    const runs = await this.runs(
      route.destination,
      route.workflow,
      token,
      `event=workflow_dispatch&branch=${encodeURIComponent(route.ref)}`,
    );
    const matching = runs.filter(
      (run) => this.validDestinationRun(route, run) && run.title === `Beepboop ${operation.id}`,
    );
    // Oldest accepted dispatch is the authority; consumers independently enforce idempotency.
    return matching.sort((a, b) => a.id - b.id)[0] ?? null;
  }
  async run(route: Route, id: number, operationId: string): Promise<Run> {
    const token = await this.token(route.destination, false);
    const run = parseRun(
      await this.request(`/repos/${route.destination.name}/actions/runs/${id}`, token),
    );
    if (
      !this.validDestinationRun(route, run) ||
      run.id !== id ||
      run.title !== `Beepboop ${operationId}`
    )
      throw new Error("Destination run identity mismatch");
    return run;
  }
}
