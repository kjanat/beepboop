import { spawnSync } from 'node:child_process';
import type { Environment, Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, attemptAsync, fail, required } from '@root/actions/runtime/protocol.ts';
import { Effect } from 'effect';
import { repositoryNamePattern } from '@/automation/repository-name.ts';
import { array, record, text } from '@/model.ts';
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

function run(root: string, args: string[]): Effect.Effect<Buffer, ActionFailure> {
	return Effect.gen(function*() {
		const result = yield* Effect.fromResult(
			attempt(() => spawnSync('git', args, { cwd: root, maxBuffer: 1024 * 1024 * 1024 })),
		);
		if (result.status !== 0) {
			return yield* fail(`git ${args[0]} failed: ${result.stderr?.toString().trim() ?? ''}`);
		}
		return result.stdout;
	});
}

function read(root: string, ...args: string[]): Effect.Effect<string, ActionFailure> {
	return run(root, args).pipe(Effect.map(output => output.toString().trim()));
}

function github(environment: Environment, token: string) {
	const origin = environment.GITHUB_API_URL || 'https://api.github.com';
	return (method: string, path: string, body?: unknown, missing = false): Effect.Effect<unknown, ActionFailure> =>
		Effect.gen(function*() {
			const response = yield* attemptAsync(() =>
				fetch(`${origin}${path}`, {
					method,
					headers: {
						Accept: 'application/vnd.github+json',
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
						'User-Agent': 'beepboop-pull-request',
						'X-GitHub-Api-Version': '2022-11-28',
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
					signal: AbortSignal.timeout(60000),
				})
			);
			if (missing && response.status === 404) return undefined;
			if (!response.ok) {
				const detail = yield* Effect.promise(() => response.text().catch(() => ''));
				return yield* fail(`GitHub HTTP ${response.status} on ${method} ${path}: ${detail.slice(0, 500)}`);
			}
			return yield* Effect.tryPromise({
				try: (): Promise<unknown> => response.json(),
				catch: () => new ActionFailure({ message: `GitHub answered ${method} ${path} with invalid JSON` }),
			});
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

function staged(root: string, paths: string[]): Effect.Effect<Entry[], ActionFailure> {
	return Effect.gen(function*() {
		yield* run(root, ['add', '--all', '--', ...(paths.length ? paths : ['.'])]);
		const names = (yield* run(root, ['diff', '--cached', '--name-status', '--no-renames', '-z', 'HEAD'])).toString()
			.split('\0');
		const entries: Entry[] = [];
		for (let index = 0; index + 1 < names.length; index += 2) {
			const status = names[index], path = names[index + 1];
			if (!status || !path) continue;
			if (status === 'D') {
				entries.push({ path, mode: '100644', type: 'blob', sha: null });
				continue;
			}
			const listed = (yield* run(root, ['ls-files', '--stage', '-z', '--', path])).toString().split('\0')[0] ?? '';
			const [mode, sha] = listed.split('\t')[0]?.split(' ') ?? [];
			if (!mode || !sha) return yield* fail(`Cannot read the staged entry of ${path}`);
			entries.push({ path, mode, type: mode === '160000' ? 'commit' : 'blob', sha });
		}
		return entries;
	});
}

export function pullRequest(environment: Environment): Effect.Effect<PullRequestResult, Invalid> {
	return Effect.gen(function*() {
		const need = (name: string) => Effect.fromResult(required(environment, name));
		const root = yield* need('GITHUB_WORKSPACE');
		const repository = yield* need('GITHUB_REPOSITORY');
		if (!repositoryNamePattern.test(repository)) return yield* fail('Invalid GITHUB_REPOSITORY');
		const branch = yield* need('PR_BRANCH');
		const title = yield* need('PR_TITLE');
		const body = environment.PR_BODY ?? '';
		const message = environment.PR_COMMIT_MESSAGE || title;
		const checkedOut = yield* read(root, 'rev-parse', '--abbrev-ref', 'HEAD');
		const base = environment.PR_BASE
			|| (checkedOut !== 'HEAD'
				? checkedOut
				: environment.GITHUB_REF_TYPE === 'branch'
				? environment.GITHUB_REF_NAME
				: undefined);
		if (!base) return yield* fail('The checkout is on no branch. Set the base input.');
		if (base === branch) return yield* fail(`The pull request branch ${branch} is its own base`);
		yield* read(root, 'check-ref-format', '--branch', branch);
		const parent = yield* read(root, 'rev-parse', 'HEAD');
		const paths = (environment.PR_ADD_PATHS ?? '').split('\n').map(path => path.trim()).filter(Boolean);
		const entries = yield* staged(root, paths);
		if (!entries.length) {
			console.log('The checkout has no changes. Beepboop opens no pull request.');
			return { operation: 'none' };
		}

		const api = github(environment, yield* need('PR_TOKEN'));
		const repo = `/repos/${repository}`;
		const ref = `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
		const tree: Entry[] = [];
		for (const entry of entries) {
			if (entry.sha === null || entry.type === 'commit') {
				tree.push(entry);
				continue;
			}
			const content = (yield* run(root, ['cat-file', 'blob', entry.sha])).toString('base64');
			const blob = yield* api('POST', `${repo}/git/blobs`, { content, encoding: 'base64' });
			tree.push({ ...entry, sha: yield* textAt(blob, 'sha') });
		}
		const baseTree = yield* textAt(yield* api('GET', `${repo}/git/commits/${parent}`), 'tree', 'sha');
		const next = yield* textAt(yield* api('POST', `${repo}/git/trees`, { base_tree: baseTree, tree }), 'sha');

		const existing = yield* api('GET', `${repo}/git/ref/${ref}`, undefined, true);
		const current = existing === undefined ? undefined : yield* textAt(existing, 'object', 'sha');
		let head = current;
		if (current !== undefined) {
			const commit = yield* api('GET', `${repo}/git/commits/${current}`);
			const parents = yield* Effect.fromResult(array(yield* field(commit, 'parents')));
			const first = parents.length === 1 ? yield* textAt(parents[0], 'sha') : undefined;
			if ((yield* textAt(commit, 'tree', 'sha')) !== next || first !== parent) head = undefined;
		}
		const pushed = head === undefined;
		if (head === undefined) {
			head = yield* textAt(
				yield* api('POST', `${repo}/git/commits`, { message, tree: next, parents: [parent] }),
				'sha',
			);
			if (current === undefined) yield* api('POST', `${repo}/git/refs`, { ref: `refs/${ref}`, sha: head });
			else yield* api('PATCH', `${repo}/git/refs/${ref}`, { sha: head, force: true });
		}

		const owner = repository.split('/')[0] ?? '';
		const open = yield* Effect.fromResult(array(
			yield* api(
				'GET',
				`${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}`,
			),
		));
		const [found] = open;
		if (found === undefined) {
			const created = yield* api('POST', `${repo}/pulls`, { title, head: branch, base, body });
			const number = yield* field(created, 'number');
			if (typeof number !== 'number') return yield* fail('GitHub returned no pull request number');
			return { operation: 'created', number, url: yield* textAt(created, 'html_url'), headSha: head };
		}
		const number = yield* field(found, 'number');
		if (typeof number !== 'number') return yield* fail('GitHub returned no pull request number');
		const stale = (yield* field(found, 'title')) !== title || ((yield* field(found, 'body')) ?? '') !== body;
		if (stale) yield* api('PATCH', `${repo}/pulls/${number}`, { title, body });
		return {
			operation: pushed || stale ? 'updated' : 'none',
			number,
			url: yield* textAt(found, 'html_url'),
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
