import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Environment, Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, attemptAsync, fail, required } from '@root/actions/runtime/protocol.ts';
import { Effect } from 'effect';
import type { Fetcher } from '@/automation/managers/registry.ts';
import { repositoryNamePattern } from '@/automation/repository-name.ts';
import { githubApiVersion } from '@/contract/http.ts';
import { shaPattern } from '@/contract/ids.ts';
import { array, record, text } from '@/model.ts';
import { responseJson, responseText } from '@/runtime/http.ts';
import type { OutputFailure } from '@/tooling/github-output.ts';
import { writeOutput } from '@/tooling/github-output.ts';

export type PullRequestOperation = 'created' | 'updated' | 'none';
export interface PullRequestResult {
	operation: PullRequestOperation;
	number?: number;
	url?: string;
	headSha?: string;
}

type Entry =
	| { path: string; mode: string; type: 'blob' | 'commit'; sha: string }
	| { path: string; mode: '100644'; type: 'blob'; sha: null };

function run(
	root: string,
	args: string[],
	index?: string,
	deadline = Date.now() + 30_000,
): Effect.Effect<Buffer, ActionFailure> {
	return Effect.gen(function*() {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			return yield* fail('Pull request operation exceeded its five-minute budget; inspect the branch and rerun');
		}
		const result = yield* Effect.fromResult(
			attempt(() =>
				spawnSync('git', args, {
					cwd: root,
					maxBuffer: 16 * 1024 * 1024,
					timeout: Math.min(30_000, remaining),
					...(index ? { env: { ...process.env, GIT_INDEX_FILE: index } } : {}),
				})
			),
		);
		if (result.status !== 0) {
			return yield* fail(`git ${args[0]} failed: ${result.error?.message ?? result.stderr?.toString().trim() ?? ''}`);
		}
		return result.stdout;
	});
}

export function pullRequestTransport(token: string, transport: Fetcher, deadline = Date.now() + 300_000) {
	return (method: string, path: string, body?: unknown, missing = false): Effect.Effect<unknown, ActionFailure> =>
		Effect.gen(function*() {
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				return yield* fail('Pull request operation exceeded its five-minute budget; inspect the branch and rerun');
			}
			const response = yield* attemptAsync(signal =>
				transport(new URL(path, 'https://api.github.com'), {
					method,
					headers: {
						Accept: 'application/vnd.github+json',
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
						'User-Agent': 'beepboop-pull-request',
						'X-GitHub-Api-Version': githubApiVersion,
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
					signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(60000, remaining))]),
				})
			);
			if (missing && response.status === 404) return undefined;
			if (!response.ok) {
				const detail = yield* responseText(response).pipe(Effect.orElseSucceed(() => ''));
				return yield* fail(`GitHub HTTP ${response.status} on ${method} ${path}: ${detail.slice(0, 500)}`);
			}
			return yield* responseJson(response).pipe(
				Effect.mapError(() => new ActionFailure({ message: `GitHub answered ${method} ${path} with invalid JSON` })),
			);
		});
}

function field(value: unknown, ...keys: string[]): Effect.Effect<unknown, Invalid> {
	return Effect.gen(function*() {
		let current = value;
		for (const key of keys) current = (yield* Effect.fromResult(record(current)))[key];
		return current;
	});
}

function textAt(value: unknown, ...keys: string[]): Effect.Effect<string, Invalid> {
	return field(value, ...keys).pipe(Effect.flatMap(found => Effect.fromResult(text(found))));
}

function staged(
	root: string,
	paths: string[],
	deadline: number,
): Effect.Effect<{ entries: Entry[]; tree: string }, ActionFailure> {
	return Effect.acquireUseRelease(
		Effect.fromResult(attempt(() => mkdtempSync(join(tmpdir(), 'beepboop-index-')))),
		directory => Effect.gen(function*() {
			const index = join(directory, 'index');
			const git = (args: string[]) => run(root, args, index, deadline);
			const selected = paths.length ? paths : ['.'];
			yield* git(['read-tree', 'HEAD']);
			yield* git(['add', '--all', '--', ...selected]);
			const raw = (yield* git(
				['diff', '--cached', '--raw', '--abbrev=40', '--no-renames', '-z', 'HEAD', '--', ...selected],
			)).toString().split('\0');
			const entries: Entry[] = [];
			for (let at = 0; at + 1 < raw.length; at += 2) {
				const [, mode, , sha, status] = raw[at]?.split(' ') ?? [];
				const path = raw[at + 1];
				if (!mode || !sha || !status || !path) return yield* fail('Cannot read the selected changes');
				if (status === 'D') entries.push({ path, mode: '100644', type: 'blob', sha: null });
				else entries.push({ path, mode, type: mode === '160000' ? 'commit' : 'blob', sha });
			}
			if (entries.length > 500) return yield* fail('Pull request changes exceed the 500-file limit');
			let total = 0;
			for (const entry of entries) {
				if (entry.type !== 'blob' || entry.sha === null) continue;
				const size = Number(
					yield* run(root, ['cat-file', '-s', entry.sha], undefined, deadline).pipe(
						Effect.map(value => value.toString().trim()),
					),
				);
				if (!Number.isFinite(size) || size > 10 * 1024 * 1024) {
					return yield* fail(`File ${entry.path} exceeds the 10 MiB limit`);
				}
				total += size;
				if (total > 50 * 1024 * 1024) return yield* fail('Pull request changes exceed the 50 MiB total limit');
			}
			return { entries, tree: (yield* git(['write-tree'])).toString().trim() };
		}),
		directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
	);
}

export function pullRequest(environment: Environment): Effect.Effect<PullRequestResult, Invalid> {
	return Effect.gen(function*() {
		const deadline = Date.now() + 300_000;
		const need = (name: string) => Effect.fromResult(required(environment, name));
		const root = yield* need('GITHUB_WORKSPACE');
		const git = (...args: string[]) =>
			run(root, args, undefined, deadline).pipe(Effect.map(value => value.toString().trim()));
		const repository = yield* need('GITHUB_REPOSITORY');
		if (!repositoryNamePattern.test(repository)) return yield* fail('Invalid GITHUB_REPOSITORY');
		const branch = yield* need('PR_BRANCH');
		const title = yield* need('PR_TITLE');
		const body = environment.PR_BODY ?? '';
		const requestedMessage = environment.PR_COMMIT_MESSAGE || title;
		const checkedOut = yield* git('rev-parse', '--abbrev-ref', 'HEAD');
		const base = environment.PR_BASE
			|| (checkedOut !== 'HEAD'
				? checkedOut
				: environment.GITHUB_REF?.startsWith('refs/heads/')
				? environment.GITHUB_REF_NAME
				: undefined);
		if (!base) return yield* fail('The checkout is on no branch. Set the base input.');
		if (base === branch) return yield* fail(`The pull request branch ${branch} is its own base`);
		yield* git('check-ref-format', '--branch', branch);
		const parent = yield* git('rev-parse', 'HEAD');
		if (!shaPattern.test(parent)) return yield* fail('Cannot read the checked-out commit');
		if (environment.GITHUB_REF?.startsWith('refs/pull/') && parent === environment.GITHUB_SHA) {
			return yield* fail(
				'The checkout is the merge commit of a pull request, so the new pull request would hold that whole pull request. Check out its branch with the head_ref of the github context as the checkout ref.',
			);
		}
		const paths = (environment.PR_ADD_PATHS ?? '').split('\n').map(path => path.trim()).filter(Boolean);
		const { entries, tree: desiredTree } = yield* staged(root, paths, deadline);
		if (!entries.length) {
			console.log('The checkout has no changes. Beepboop opens no pull request.');
			return { operation: 'none' };
		}

		const api = pullRequestTransport(yield* need('PR_TOKEN'), fetch, deadline);
		const repo = `/repos/${repository}`;
		const ref = `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
		const marker = `Beepboop-Pull-Request: ${repository} ${branch} ${base}`;
		const message = `${requestedMessage.trimEnd()}\n\n${marker}`;
		const owner = repository.split('/')[0] ?? '';
		const pullPath = `${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`;
		const inspectPulls = () => Effect.gen(function*() {
			const pulls = yield* Effect.fromResult(array(yield* api('GET', pullPath)));
			for (const pull of pulls) {
				if ((yield* textAt(pull, 'base', 'ref')) !== base) {
					return yield* fail(`Branch ${branch} already has a pull request against another base`);
				}
			}
			return pulls[0];
		});
		const repositoryId = yield* textAt(yield* api('GET', repo), 'node_id');
		yield* api('GET', `${repo}/git/ref/heads/${base.split('/').map(encodeURIComponent).join('/')}`);
		yield* inspectPulls();
		const existing = yield* api('GET', `${repo}/git/ref/${ref}`, undefined, true);
		const current = existing === undefined ? undefined : yield* textAt(existing, 'object', 'sha');
		if (current !== undefined && !shaPattern.test(current)) {
			return yield* fail('GitHub returned an invalid branch head');
		}
		let head: string | undefined;
		const matches = (commit: unknown) => Effect.gen(function*() {
			const parents = yield* Effect.fromResult(array(yield* field(commit, 'parents')));
			return (yield* textAt(commit, 'tree', 'sha')) === desiredTree && parents.length === 1
				&& (yield* textAt(parents[0], 'sha')) === parent && (yield* textAt(commit, 'message')) === message;
		});
		if (current) {
			const commit = yield* api('GET', `${repo}/git/commits/${current}`);
			const previousMessage = yield* textAt(commit, 'message');
			if (!previousMessage.split('\n').includes(marker) && environment.PR_ALLOW_EXISTING_BRANCH !== 'true') {
				return yield* fail(
					`Branch ${branch} is not owned by this action; set allow-existing-branch to true only to adopt it exclusively`,
				);
			}
			if (yield* matches(commit)) head = current;
		}
		let pushed = false;
		if (head === undefined) {
			const tree: Entry[] = [];
			for (const entry of entries) {
				if (entry.sha === null || entry.type === 'commit') {
					tree.push(entry);
					continue;
				}
				const content = (yield* run(root, ['cat-file', 'blob', entry.sha], undefined, deadline)).toString('base64');
				const blob = yield* api('POST', `${repo}/git/blobs`, { content, encoding: 'base64' });
				tree.push({ ...entry, sha: yield* textAt(blob, 'sha') });
			}
			const baseTree = yield* textAt(yield* api('GET', `${repo}/git/commits/${parent}`), 'tree', 'sha');
			const next = yield* textAt(yield* api('POST', `${repo}/git/trees`, { base_tree: baseTree, tree }), 'sha');
			if (next !== desiredTree) return yield* fail('GitHub tree differs from the selected local changes');
			head = yield* textAt(
				yield* api('POST', `${repo}/git/commits`, { message, tree: next, parents: [parent] }),
				'sha',
			);
			const changed = yield* Effect.result(api('POST', '/graphql', {
				query: 'mutation($input:UpdateRefsInput!){updateRefs(input:$input){clientMutationId}}',
				variables: {
					input: {
						repositoryId,
						refUpdates: [{
							name: `refs/heads/${branch}`,
							beforeOid: current ?? '0'.repeat(40),
							afterOid: head,
							force: true,
						}],
					},
				},
			}));
			const observedRef = yield* api('GET', `${repo}/git/ref/${ref}`, undefined, true);
			if (!observedRef) {
				return yield* fail(
					`Branch ${branch} was not created: ${
						changed._tag === 'Failure' ? changed.failure.message : JSON.stringify(changed.success)
					}`,
				);
			}
			const observed = yield* textAt(observedRef, 'object', 'sha');
			if (observed !== head) {
				const commit = yield* api('GET', `${repo}/git/commits/${observed}`);
				if (!(yield* matches(commit))) {
					const detail = changed._tag === 'Failure' ? changed.failure.message : JSON.stringify(changed.success);
					return yield* fail(`Branch ${branch} changed concurrently or its update was rejected: ${detail}`);
				}
				head = observed;
			}
			pushed = observed !== current;
		}
		let found = yield* inspectPulls();
		let created = false;
		if (found === undefined) {
			const result = yield* Effect.result(api('POST', `${repo}/pulls`, { title, head: branch, base, body }));
			if (result._tag === 'Success') {
				found = result.success;
				created = true;
			} else {
				found = yield* inspectPulls();
				if (found === undefined) return yield* result.failure;
			}
		}
		const number = yield* field(found, 'number');
		if (typeof number !== 'number') return yield* fail('GitHub returned no pull request number');
		const stale = (yield* field(found, 'title')) !== title || ((yield* field(found, 'body')) ?? '') !== body;
		if (stale) yield* api('PATCH', `${repo}/pulls/${number}`, { title, body });
		const final = yield* api('GET', `${repo}/pulls/${number}`);
		if (
			(yield* textAt(final, 'state')) !== 'open' || (yield* textAt(final, 'title')) !== title
			|| ((yield* field(final, 'body')) ?? '') !== body
			|| (yield* textAt(final, 'head', 'sha')) !== head || (yield* textAt(final, 'base', 'ref')) !== base
			|| (yield* textAt(yield* api('GET', `${repo}/git/ref/${ref}`), 'object', 'sha')) !== head
		) return yield* fail('Pull request changed concurrently before outputs; inspect it and rerun');
		return {
			operation: created ? 'created' : pushed || stale ? 'updated' : 'none',
			number,
			url: yield* textAt(final, 'html_url'),
			headSha: head,
		};
	});
}

export function writeResult(result: PullRequestResult): Effect.Effect<void, OutputFailure> {
	return Effect.gen(function*() {
		yield* writeOutput('pull-request-operation', result.operation);
		yield* writeOutput('pull-request-number', result.number === undefined ? '' : String(result.number));
		yield* writeOutput('pull-request-url', result.url ?? '');
		yield* writeOutput('pull-request-head-sha', result.headSha ?? '');
		if (result.url) console.log(`Pull request ${result.operation}: ${result.url}`);
	});
}

if (import.meta.main) {
	await Effect.runPromise(pullRequest(process.env).pipe(Effect.flatMap(writeResult)));
}
