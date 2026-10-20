import { beforeAll, describe, expect, test } from "bun:test";
import { exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { GitHub } from "@/github.ts";
import { record } from "@/model.ts";
import { release, route } from "./fixtures.ts";

let pem = "";
let publicKey: CryptoKey;
beforeAll(async () => {
  const keys = await generateKeyPair("RS256", { extractable: true });
  pem = await exportPKCS8(keys.privateKey);
  publicKey = keys.publicKey;
});
function sourceRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123,
    status: "in_progress",
    conclusion: null,
    display_title: "Release v2.0.0",
    head_sha: release().sha,
    head_branch: "v2.0.0",
    event: "release",
    path: ".github/workflows/release.yml",
    repository: { id: 11 },
    ...overrides,
  };
}
function api(
  options: {
    repositoryId?: number;
    run?: Record<string, unknown>;
    jobs?: Record<string, unknown>[];
    prerelease?: boolean;
    digest?: string | null;
    signed?: boolean;
    tagType?: string;
    oversized?: boolean;
    oldFirstPage?: boolean;
    redirect?: boolean;
  } = {},
) {
  const requests: { url: URL; method: string; body: unknown; authorization: string }[] = [];
  const github = new GitHub(
    { GITHUB_APP_ID: "1234", GITHUB_APP_PRIVATE_KEY: pem },
    33,
    async (request) => {
      const url = new URL(request.url);
      expect(request.redirect).toBe("manual");
      if (options.redirect)
        return new Response(null, {
          status: 302,
          headers: { Location: "https://example.invalid/credentials" },
        });
      const body: unknown = request.method === "POST" ? await request.json() : null;
      requests.push({
        url,
        method: request.method,
        body,
        authorization: request.headers.get("authorization") ?? "",
      });
      if (url.hostname !== "api.github.com") throw new Error("Unexpected destination");
      if (url.pathname.endsWith("/installation"))
        return options.oversized
          ? new Response(" ".repeat(2 * 1024 * 1024 + 1))
          : Response.json({ id: 777, account: { id: 33 } });
      if (url.pathname.endsWith("/access_tokens"))
        return Response.json({ token: "installation-token" });
      if (url.pathname === "/repos/kjanat/source")
        return Response.json({
          id: options.repositoryId ?? 11,
          owner: { id: 33 },
          full_name: "kjanat/source",
        });
      if (url.pathname === "/repos/kjanat/destination")
        return Response.json({
          id: options.repositoryId ?? 22,
          owner: { id: 33 },
          full_name: "kjanat/destination",
        });
      if (url.pathname.endsWith("/dispatches")) return Response.json({ workflow_run_id: 888 });
      if (url.pathname.includes("/git/ref/tags/"))
        return Response.json({ object: { type: options.tagType ?? "tag", sha: "e".repeat(40) } });
      if (url.pathname.includes("/git/tags/"))
        return Response.json({
          tag: "v2.0.0",
          verification: { verified: options.signed ?? true },
          object: { type: "commit", sha: release().sha },
        });
      if (
        url.pathname.endsWith("/releases") &&
        options.oldFirstPage &&
        url.searchParams.get("page") === "1"
      ) {
        return Response.json(
          Array.from({ length: 100 }, (_, index) => ({
            id: 1000 + index,
            draft: false,
            prerelease: false,
            tag_name: `v1.0.${index}`,
          })),
        );
      }
      if (url.pathname.endsWith("/releases"))
        return Response.json([
          {
            id: 44,
            tag_name: "v2.0.0",
            draft: false,
            prerelease: options.prerelease ?? false,
            published_at: release().publishedAt,
            assets: [
              {
                id: 55,
                name: "SHA256SUMS",
                size: 100,
                digest: options.digest === undefined ? `sha256:${"b".repeat(64)}` : options.digest,
              },
            ],
          },
        ]);
      if (url.pathname.endsWith("/runs"))
        return Response.json({ workflow_runs: [options.run ?? sourceRun()] });
      if (url.pathname.endsWith("/jobs"))
        return Response.json({
          jobs: options.jobs ?? [
            { name: "Verify published candidate", status: "completed", conclusion: "success" },
          ],
        });
      throw new Error(`Unexpected path ${url.pathname}`);
    },
  );
  return { github, requests };
}
describe("GitHub boundary", () => {
  test("rejects redirects without forwarding credentials", async () => {
    await expect(api({ redirect: true }).github.latest(route)).rejects.toThrow("GitHub HTTP 302");
  });
  test("scopes destination token to exact repository and permissions; dispatch returns tracked ID", async () => {
    const t = api();
    const id = await t.github.dispatch(route, {
      id: "11:44:scoop",
      routeId: route.id,
      routeIdentity: JSON.stringify(route),
      release: release(),
      state: "waiting",
      reason: "ready",
      attempts: 0,
      updatedAt: 0,
      nextAttempt: 0,
    });
    expect(id).toBe(888);
    const token = t.requests.find((request) => request.url.pathname.endsWith("/access_tokens"));
    expect(token?.body).toEqual({
      repository_ids: [22],
      permissions: { contents: "read", actions: "write" },
    });
    const dispatch = t.requests.find((request) => request.url.pathname.endsWith("/dispatches"));
    expect(dispatch?.body).toEqual({
      ref: "master",
      inputs: {
        source_repository_id: "11",
        release_id: "44",
        source_sha: "a".repeat(40),
        operation_id: "11:44:scoop",
        dry_run: false,
      },
    });
    const installation = t.requests.find((request) =>
      request.url.pathname.endsWith("/installation"),
    );
    if (!installation) throw new Error("No installation lookup");
    const claims = await jwtVerify(installation.authorization.replace(/^Bearer /, ""), publicKey, {
      issuer: "1234",
    });
    expect(claims.protectedHeader.alg).toBe("RS256");
  });
  test("rejects renamed or replaced destination repository before dispatch", async () => {
    const t = api({ repositoryId: 999 });
    await expect(
      t.github.dispatch(route, {
        id: "11:44:scoop",
        routeId: route.id,
        routeIdentity: JSON.stringify(route),
        release: release(),
        state: "waiting",
        reason: "ready",
        attempts: 0,
        updatedAt: 0,
        nextAttempt: 0,
      }),
    ).rejects.toThrow("Repository identity mismatch");
    expect(t.requests.some((request) => request.url.pathname.endsWith("/dispatches"))).toBe(false);
  });
  test("readiness uses exact release commit and successful selected jobs without circular whole-run wait", async () => {
    const t = api();
    expect(await t.github.ready(route, release())).toBe(true);
    const request = t.requests.find((request) => request.url.pathname.endsWith("/runs"));
    expect(request?.url.searchParams.get("head_sha")).toBe(release().sha);
    const token = t.requests.find((request) => request.url.pathname.endsWith("/access_tokens"));
    expect(record(token?.body).permissions).toEqual({ contents: "read", actions: "read" });
  });
  test.each([
    { head_sha: "d".repeat(40) },
    { head_branch: "v2.0.1" },
    { event: "push" },
    { repository: { id: 999 } },
    { path: ".github/workflows/evil.yml" },
  ])("rejects mismatched readiness evidence %p", async (override) => {
    expect(await api({ run: sourceRun(override) }).github.ready(route, release())).toBe(false);
  });
  test("skipped readiness job does not count as publication", async () => {
    expect(
      await api({
        jobs: [{ name: "Verify published candidate", status: "completed", conclusion: "skipped" }],
      }).github.ready(route, release()),
    ).toBe(false);
  });
  test("snapshot includes immutable asset identity and resolved tag commit", async () => {
    expect(await api().github.latest(route)).toEqual(release());
  });
  test("prerelease excluded and digestless assets rejected", async () => {
    expect(await api({ prerelease: true }).github.latest(route)).toBeNull();
    await expect(api({ digest: null }).github.latest(route)).rejects.toThrow();
  });
});

test("unsigned and lightweight release tags cannot dispatch", async () => {
  await expect(api({ signed: false }).github.latest(route)).rejects.toThrow("signature");
  await expect(api({ tagType: "commit" }).github.latest(route)).rejects.toThrow("annotated");
});
test("GitHub response size is bounded before JSON parsing", async () => {
  await expect(api({ oversized: true }).github.latest(route)).rejects.toThrow("size limit");
});
test("release selection follows pagination before choosing highest eligible version", async () => {
  const t = api({ oldFirstPage: true });
  expect(await t.github.latest(route)).toEqual(release());
  expect(
    t.requests.some(
      (request) =>
        request.url.pathname.endsWith("/releases") && request.url.searchParams.get("page") === "2",
    ),
  ).toBe(true);
});
