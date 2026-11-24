import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Result } from 'effect';
import type { Invalid } from '@/actions/protocol.ts';
import { ActionFailure, attempt, refuse } from '@/actions/protocol.ts';
import type { DistributionEvidence, RefChange, RefPlan } from '@/domain/refs.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { git } from '@/host/git.ts';
import { runMain } from '@/host/main.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import { array, boolean, record, text } from '@/kernel/schema/result.ts';

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
		Effect.sync(() => git(args, { cwd: root, env, ...(input === undefined ? {} : { input }) }));
	const output = (input: string | undefined, args: string[]) =>
		run(input, args).pipe(
			Effect.flatMap(result =>
				result.ok && args[0] === 'push'
					&& /bypass(?:ed|ing)?[^\r\n]*(?:rule|protect)|(?:rule|protect)[^\r\n]*bypass/i.test(result.stderr)
					? Effect.fail(
						new ActionFailure({
							message: 'Git push reported a repository protection bypass; stop and inspect the remote state',
						}),
					)
					: result.ok
					? Effect.succeed(result.stdout)
					: Effect.fail(new ActionFailure({ message: `Git ${args[0]} failed; inspect the repository and ref plan` }))
			),
		);
	return {
		read: (...args) => output(undefined, args),
		write: (input, ...args) => output(input, args),
		exists: ref => run(undefined, ['rev-parse', '--verify', ref]).pipe(Effect.map(result => result.ok)),
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

function publishedTag(git: Git, remote: string, ref: string, change: RefChange): Effect.Effect<boolean, ActionFailure> {
	return Effect.gen(function*() {
		if (!(yield* git.read('ls-remote', remote, ref)).split(/\s+/)[0]) return false;
		yield* git.read('fetch', '--no-tags', remote, ref);
		return yield* verifyTag(git, 'FETCH_HEAD', change, 'Published tag differs from the ref plan').pipe(
			Effect.as(true),
			Effect.orElseSucceed(() => false),
		);
	});
}

function prepareTag(
	git: Git,
	remote: string,
	ref: string,
	change: RefChange,
	version: string,
): Effect.Effect<string, ActionFailure> {
	return Effect.gen(function*() {
		if (
			change.replaces && (yield* git.exists(ref)) && (yield* git.read('rev-parse', `${ref}^{commit}`)) !== change.commit
		) {
			yield* git.read('update-ref', '-d', ref);
		}
		if (!(yield* git.exists(ref)) && (yield* publishedTag(git, remote, ref, change))) {
			yield* git.read('update-ref', ref, 'FETCH_HEAD', '');
		}
		if (yield* git.exists(ref)) {
			yield* verifyTag(git, ref, change, 'Local tag differs from the ref plan');
		} else {
			yield* createTag(git, ref, change, version);
			yield* verifyTag(git, ref, change, 'Created tag differs from the ref plan');
		}
		return yield* git.read('rev-parse', ref);
	});
}

function prepareAncestry(
	evidence: DistributionEvidence,
	git: Git,
	remote: string,
): Effect.Effect<boolean, ActionFailure> {
	return Effect.gen(function*() {
		if (
			![evidence.sourceSha, evidence.commit, evidence.tree, evidence.ancestryCommit, evidence.expected].every(value =>
				shaPattern.test(value)
			) || evidence.sourceSha !== evidence.expected
		) return yield* new ActionFailure({ message: 'Invalid distribution evidence' });
		const ref = `refs/heads/${evidence.branch}`;
		yield* git.read('check-ref-format', ref);
		for (const commit of [evidence.commit, evidence.ancestryCommit]) {
			yield* git.read('fetch', '--no-tags', remote, commit);
			yield* git.read('verify-commit', commit);
		}
		if (
			(yield* git.read('rev-parse', `${evidence.commit}^{tree}`)) !== evidence.tree
			|| (yield* git.read('show', '-s', '--format=%P', evidence.commit)) !== evidence.sourceSha
			|| (yield* git.read('show', '-s', '--format=%P', evidence.ancestryCommit))
				!== `${evidence.sourceSha} ${evidence.commit}`
			|| (yield* git.read('rev-parse', `${evidence.ancestryCommit}^{tree}`))
				!== (yield* git.read('rev-parse', `${evidence.sourceSha}^{tree}`))
		) return yield* new ActionFailure({ message: 'Distribution ancestry proof differs from the plan' });
		const current = (yield* git.read('ls-remote', remote, ref)).split(/\s+/)[0];
		if (current === evidence.expected) return true;
		if (current === evidence.ancestryCommit) return false;
		if (current) {
			yield* git.read('fetch', '--no-tags', remote, ref);
			yield* git.read('merge-base', '--is-ancestor', evidence.ancestryCommit, 'FETCH_HEAD');
			return false;
		}
		return yield* new ActionFailure({ message: 'Distribution source branch disappeared' });
	});
}

function publish(plan: RefPlan, git: Git, remote: string): Effect.Effect<void, ActionFailure> {
	return Effect.gen(function*() {
		if (
			plan.distribution
			&& (plan.changes.some(change => change.commit !== plan.distribution?.commit)
				|| !plan.changes.some(change => change.annotated))
		) return yield* new ActionFailure({ message: 'Distribution refs must target the authorized distribution commit' });
		const leases: string[] = [];
		const refspecs: string[] = [];
		if (plan.distribution && (yield* prepareAncestry(plan.distribution, git, remote))) {
			const ref = `refs/heads/${plan.distribution.branch}`;
			leases.push(`--force-with-lease=${ref}:${plan.distribution.expected}`);
			refspecs.push(`${plan.distribution.ancestryCommit}:${ref}`);
		}
		for (const change of plan.changes) {
			if (
				!shaPattern.test(change.commit) || change.expected !== null && !shaPattern.test(change.expected)
			) return yield* new ActionFailure({ message: 'Invalid ref object' });
			const ref = `refs/tags/${change.name}`;
			yield* git.read('check-ref-format', ref);
			if (!(yield* git.exists(`${change.commit}^{commit}`))) {
				yield* git.read('fetch', '--no-tags', remote, change.commit);
			}
			yield* git.read('cat-file', '-e', `${change.commit}^{commit}`);
			if (change.annotated && change.expected !== null && !change.replaces) {
				yield* verifyPublishedTag(git, remote, ref, change);
				continue;
			}
			const object = change.annotated ? yield* prepareTag(git, remote, ref, change, plan.version) : change.commit;
			if (plan.distribution && (yield* git.read('ls-remote', remote, ref)).split(/\s+/)[0] === object) continue;
			leases.push(`--force-with-lease=${ref}:${change.expected ?? ''}`);
			refspecs.push(`${object}:${ref}`);
		}
		if (refspecs.length) yield* git.read('push', '--atomic', ...leases, remote, ...refspecs);
	});
}

function scratchRepository(root: string): Effect.Effect<string | undefined, ActionFailure> {
	return Effect.gen(function*() {
		if (git(['rev-parse', '--git-dir'], { cwd: root }).ok) return undefined;
		const scratch = join(process.env.RUNNER_TEMP || tmpdir(), `beepboop-refs-${randomUUID()}`);
		if (git(['init', '--quiet', scratch]).ok) return scratch;
		return yield* new ActionFailure({ message: 'Could not create a repository for the release refs' });
	});
}

export function publishRefs(
	plan: RefPlan,
	root: string,
	remote: string,
	token?: string,
): Effect.Effect<void, ActionFailure> {
	const publicKey = plan.publicKey;
	if (plan.distribution && publicKey === undefined) {
		return Effect.fail(new ActionFailure({ message: 'Distribution publication requires the signing key' }));
	}
	return Effect.acquireUseRelease(
		scratchRepository(root),
		scratch => {
			const repository = scratch ?? root;
			if (publicKey === undefined) return publish(plan, createGit(repository, token), remote);
			return Effect.acquireUseRelease(
				Effect.fromResult(attempt(() => mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'beepboop-gnupg-')))),
				keyring =>
					importKey(keyring, publicKey).pipe(
						Effect.andThen(publish(plan, createGit(repository, token, keyring), remote)),
					),
				keyring => Effect.sync(() => rmSync(keyring, { recursive: true, force: true })),
			);
		},
		scratch => Effect.sync(() => scratch && rmSync(scratch, { recursive: true, force: true })),
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
			...(change.replaces === undefined ? {} : { replaces: yield* boolean(change.replaces) }),
		};
	});
}

function parseDistribution(value: unknown): Result.Result<DistributionEvidence, Invalid> {
	return Result.gen(function*() {
		const evidence = yield* record(value);
		return {
			sourceSha: yield* text(evidence.sourceSha),
			commit: yield* text(evidence.commit),
			tree: yield* text(evidence.tree),
			ancestryCommit: yield* text(evidence.ancestryCommit),
			branch: yield* text(evidence.branch),
			expected: yield* text(evidence.expected),
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
			...(plan.distribution === undefined ? {} : { distribution: yield* parseDistribution(plan.distribution) }),
			...(plan.publicKey === undefined ? {} : { publicKey: yield* text(plan.publicKey) }),
		};
	});
}

if (import.meta.main) {
	await runMain(Effect.gen(function*() {
		const { REF_PLAN, REF_TOKEN, GITHUB_WORKSPACE } = process.env;
		if (!REF_PLAN) return yield* Effect.fromResult(refuse('Ref plan required'));
		if (!REF_TOKEN) return yield* Effect.fromResult(refuse('Destination token required'));
		if (!GITHUB_WORKSPACE) return yield* Effect.fromResult(refuse('Checkout directory required'));
		const plan = yield* Effect.fromResult(
			attempt((): unknown => JSON.parse(REF_PLAN)).pipe(Result.flatMap(parsePlan)),
		);
		if (!repositoryNamePattern.test(plan.repository)) return yield* Effect.fromResult(refuse('Invalid destination'));
		yield* publishRefs(plan, GITHUB_WORKSPACE, `https://github.com/${plan.repository}.git`, REF_TOKEN);
	}));
}
