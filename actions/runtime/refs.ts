import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionFailure, attempt, type Invalid, refuse } from '@root/actions/runtime/protocol.ts';
import { Effect, Result } from 'effect';
import type { RefChange, RefPlan } from '@/automation/refs.ts';
import { array, boolean, record, text } from '@/model.ts';

interface Git {
	read(...args: string[]): Effect.Effect<string, ActionFailure>;
	write(input: string, ...args: string[]): Effect.Effect<string, ActionFailure>;
	exists(ref: string): Effect.Effect<boolean>;
}

function createGit(root: string, token?: string, keyring?: string): Git {
	const env = { ...process.env };
	if (token) {
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
		env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
	}
	if (keyring) env.GNUPGHOME = keyring;
	const run = (input: string | undefined, args: string[]) =>
		Effect.sync(() => spawnSync('git', args, { cwd: root, env, encoding: 'utf8', input }));
	const output = (input: string | undefined, args: string[]) =>
		run(input, args).pipe(Effect.flatMap(result =>
			result.status === 0
				? Effect.succeed(result.stdout.trim())
				: Effect.fail(new ActionFailure({ message: `Git ${args[0]} failed; inspect the repository and ref plan` }))
		));
	return {
		read: (...args) => output(undefined, args),
		write: (input, ...args) => output(input, args),
		exists: ref => run(undefined, ['rev-parse', '--verify', ref]).pipe(Effect.map(result => result.status === 0)),
	};
}

function importKey(keyring: string, publicKey: string): Effect.Effect<void, ActionFailure> {
	return Effect.gen(function*() {
		yield* Effect.fromResult(attempt(() => writeFileSync(join(keyring, 'gpg.conf'), 'no-autostart\n')));
		const result = yield* Effect.sync(() =>
			spawnSync('gpg', ['--batch', '--no-tty', '--import'], {
				env: { ...process.env, GNUPGHOME: keyring },
				encoding: 'utf8',
				input: publicKey,
			})
		);
		if (result.status !== 0) return yield* new ActionFailure({ message: 'Could not import the signing key' });
	});
}

function verifyTag(git: Git, ref: string, change: RefChange, message: string): Effect.Effect<void, ActionFailure> {
	return Effect.gen(function*() {
		if (
			(yield* git.read('cat-file', '-t', ref)) !== 'tag'
			|| (yield* git.read('rev-parse', `${ref}^{commit}`)) !== change.commit
		) return yield* new ActionFailure({ message });
		if (change.signed) yield* git.read('verify-tag', ref);
	});
}

function verifyPublishedTag(
	git: Git,
	remote: string,
	ref: string,
	change: RefChange,
): Effect.Effect<void, ActionFailure> {
	return Effect.gen(function*() {
		yield* git.read('fetch', '--no-tags', remote, ref);
		if ((yield* git.read('rev-parse', 'FETCH_HEAD')) !== change.expected) {
			return yield* new ActionFailure({ message: 'Published version tag changed' });
		}
		yield* verifyTag(git, 'FETCH_HEAD', change, 'Published version tag changed');
	});
}

function createTag(git: Git, ref: string, change: RefChange, version: string): Effect.Effect<void, ActionFailure> {
	return Effect.gen(function*() {
		if (change.object === undefined) {
			yield* git.read('tag', change.signed ? '-s' : '-a', '-m', `Release ${version}`, '--', change.name, change.commit);
			return;
		}
		yield* git.read('update-ref', ref, yield* git.write(change.object, 'mktag'), '');
	});
}

function prepareTag(git: Git, ref: string, change: RefChange, version: string): Effect.Effect<string, ActionFailure> {
	return Effect.gen(function*() {
		if (yield* git.exists(ref)) {
			yield* verifyTag(git, ref, change, 'Local tag differs from the ref plan');
		} else {
			yield* createTag(git, ref, change, version);
			yield* verifyTag(git, ref, change, 'Created tag differs from the ref plan');
		}
		return yield* git.read('rev-parse', ref);
	});
}

function publish(plan: RefPlan, git: Git, remote: string): Effect.Effect<void, ActionFailure> {
	return Effect.gen(function*() {
		const leases: string[] = [];
		const refspecs: string[] = [];
		for (const change of plan.changes) {
			if (
				!/^[a-f0-9]{40}$/.test(change.commit) || change.expected !== null && !/^[a-f0-9]{40}$/.test(change.expected)
			) return yield* new ActionFailure({ message: 'Invalid ref object' });
			const ref = `refs/tags/${change.name}`;
			yield* git.read('check-ref-format', ref);
			yield* git.read('cat-file', '-e', `${change.commit}^{commit}`);
			if (change.annotated && change.expected !== null) {
				yield* verifyPublishedTag(git, remote, ref, change);
				continue;
			}
			const object = change.annotated ? yield* prepareTag(git, ref, change, plan.version) : change.commit;
			leases.push(`--force-with-lease=${ref}:${change.expected ?? ''}`);
			refspecs.push(`${object}:${ref}`);
		}
		if (refspecs.length) yield* git.read('push', '--atomic', ...leases, remote, ...refspecs);
	});
}

export function publishRefs(
	plan: RefPlan,
	root: string,
	remote: string,
	token?: string,
): Effect.Effect<void, ActionFailure> {
	const publicKey = plan.publicKey;
	if (publicKey === undefined) return publish(plan, createGit(root, token), remote);
	return Effect.acquireUseRelease(
		Effect.fromResult(attempt(() => mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'beepboop-gnupg-')))),
		keyring =>
			importKey(keyring, publicKey).pipe(Effect.andThen(publish(plan, createGit(root, token, keyring), remote))),
		keyring => Effect.sync(() => rmSync(keyring, { recursive: true, force: true })),
	);
}

function parseChange(entry: unknown): Result.Result<RefChange, Invalid> {
	return Result.gen(function*() {
		const change = yield* record(entry);
		return {
			name: yield* text(change.name),
			expected: change.expected === null ? null : yield* text(change.expected),
			commit: yield* text(change.commit),
			annotated: yield* boolean(change.annotated),
			signed: yield* boolean(change.signed),
			...(change.object === undefined ? {} : { object: yield* text(change.object) }),
		};
	});
}

function parsePlan(value: unknown): Result.Result<RefPlan, Invalid> {
	return Result.gen(function*() {
		const plan = yield* record(value);
		return {
			repository: yield* text(plan.repository),
			executionId: yield* text(plan.executionId),
			version: yield* text(plan.version),
			changes: yield* Result.all((yield* array(plan.changes)).map(parseChange)),
			...(plan.publicKey === undefined ? {} : { publicKey: yield* text(plan.publicKey) }),
		};
	});
}

if (import.meta.main) {
	await Effect.runPromise(Effect.gen(function*() {
		const { REF_PLAN, REF_TOKEN, GITHUB_WORKSPACE } = process.env;
		if (!REF_PLAN) return yield* Effect.fromResult(refuse('Ref plan required'));
		if (!REF_TOKEN) return yield* Effect.fromResult(refuse('Destination token required'));
		if (!GITHUB_WORKSPACE) return yield* Effect.fromResult(refuse('Checkout directory required'));
		const plan = yield* Effect.fromResult(
			attempt((): unknown => JSON.parse(REF_PLAN)).pipe(Result.flatMap(parsePlan)),
		);
		if (!/^[\w.-]+\/[\w.-]+$/.test(plan.repository)) return yield* Effect.fromResult(refuse('Invalid destination'));
		yield* publishRefs(plan, GITHUB_WORKSPACE, `https://github.com/${plan.repository}.git`, REF_TOKEN);
	}));
}
