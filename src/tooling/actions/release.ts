import { appendFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';
import { parse } from 'yaml';
import { publishRefs } from '@/actions/refs.ts';
import type { RefChange } from '@/domain/refs.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { compareVersions } from '@/domain/semver.ts';
import { git as runGit } from '@/host/git.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import { looseSchema } from '@/kernel/schema/result.ts';
import { mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';
import { attempt, parse as decode, main, refuse, ToolFailure } from '@/tooling/runtime';

const actionSchema = mutableStruct({
	inputs: Schema.optional(
		Schema.NullOr(mutableRecord(Schema.String, mutableStruct({ required: looseSchema, default: looseSchema }))),
	),
	outputs: Schema.optional(Schema.NullOr(mutableRecord(Schema.String, Schema.Unknown))),
});

type Bump = 'major' | 'minor' | 'patch';
interface Contract {
	inputs: Map<string, boolean>;
	outputs: Set<string>;
}

function git(cwd: string, ...args: string[]): Effect.Effect<string, ToolFailure> {
	return attempt(() => runGit(args, { cwd })).pipe(
		Effect.flatMap(result =>
			result.ok ? Effect.succeed(result.stdout) : refuse(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
		),
	);
}

function contracts(cwd: string, revision: string): Effect.Effect<Map<string, Contract>, ToolFailure> {
	return Effect.gen(function*() {
		const files = (yield* git(cwd, 'ls-tree', '-r', '--name-only', revision, '--', 'actions')).split('\n')
			.filter(path => /^actions\/[^/]+\/action\.ya?ml$/.test(path));
		const entries = yield* Effect.forEach(files, path =>
			Effect.gen(function*() {
				const source = yield* git(cwd, 'show', `${revision}:${path}`);
				const action = yield* decode(actionSchema, yield* attempt((): unknown => parse(source)));
				const inputs = Object.entries(action.inputs ?? {}).map(([name, input]): [string, boolean] => [
					name,
					input.required === true && input.default === undefined,
				]);
				const contract: Contract = {
					inputs: new Map(inputs),
					outputs: new Set(Object.keys(action.outputs ?? {})),
				};
				return [path.split('/')[1] ?? path, contract] as const;
			}));
		return new Map(entries);
	});
}

function bump(previous: Map<string, Contract>, next: Map<string, Contract>): Bump {
	let level: Bump = 'patch';
	for (const [name, before] of previous) {
		const after = next.get(name);
		if (!after) return 'major';
		for (const output of before.outputs) if (!after.outputs.has(output)) return 'major';
		for (const [input, required] of after.inputs) {
			const old = before.inputs.get(input);
			if (required && old !== true) return 'major';
			if (old === undefined) level = 'minor';
		}
		for (const input of before.inputs.keys()) if (!after.inputs.has(input)) return 'major';
		for (const output of after.outputs) if (!before.outputs.has(output)) level = 'minor';
	}
	for (const name of next.keys()) if (!previous.has(name)) level = 'minor';
	return level;
}

export const releaseLevel = Effect.fn('releaseLevel')(function*(
	cwd: string,
	previous: string,
	next: string,
): Effect.fn.Return<Bump, ToolFailure> {
	return bump(yield* contracts(cwd, previous), yield* contracts(cwd, next));
});

const release = Effect.gen(function*() {
	const root = process.cwd();
	const distribution = process.env.DISTRIBUTION_COMMIT ?? '';
	const repository = process.env.GITHUB_REPOSITORY ?? '';
	if (!shaPattern.test(distribution)) return yield* refuse('DISTRIBUTION_COMMIT must be a full commit SHA');
	if (!repositoryNamePattern.test(repository)) return yield* refuse('GITHUB_REPOSITORY is required');

	const tags = new Map<string, { oid: string; commit: string }>();
	for (const line of (yield* git(root, 'ls-remote', '--tags', 'origin', 'refs/tags/v*')).split('\n').filter(Boolean)) {
		const [oid = '', ref = ''] = line.split('\t');
		const name = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
		const known = tags.get(name);
		tags.set(
			name,
			ref.endsWith('^{}') ? { oid: known?.oid ?? oid, commit: oid } : { oid, commit: known?.commit ?? oid },
		);
	}
	const latest = [...tags.keys()].filter(name => /^v\d+\.\d+\.\d+$/.test(name))
		.sort((a, b) => compareVersions(a.slice(1), b.slice(1))).at(-1);
	const latestCommit = latest ? tags.get(latest)?.commit : undefined;

	if (latestCommit === distribution) {
		console.log(`${latest} already points at ${distribution}`);
		return;
	}
	let version = '1.0.0';
	if (latest && latestCommit) {
		yield* git(root, 'fetch', '--no-tags', 'origin', latestCommit);
		const level = yield* releaseLevel(root, latestCommit, distribution);
		const [major = 0, minor = 0, patch = 0] = latest.slice(1).split('.').map(Number);
		version = level === 'major'
			? `${major + 1}.0.0`
			: level === 'minor'
			? `${major}.${minor + 1}.0`
			: `${major}.${minor}.${patch + 1}`;
		console.log(`${level} release after ${latest}`);
	}
	const [major, minor] = version.split('.');
	const change = (name: string, annotated: boolean): RefChange => ({
		name,
		expected: annotated ? null : (tags.get(name)?.oid ?? null),
		commit: distribution,
		annotated,
		signed: false,
	});
	yield* publishRefs(
		{
			repository,
			executionId: `publish-actions:${process.env.GITHUB_RUN_ID ?? ''}`,
			version,
			changes: [change(`v${version}`, true), change(`v${major}`, false), change(`v${major}.${minor}`, false)],
		},
		process.cwd(),
		'origin',
	).pipe(Effect.mapError(error => new ToolFailure({ message: error.message, cause: error })));
	console.log(`Tagged v${version}; moved v${major} and v${major}.${minor}`);
	const summary = process.env.GITHUB_STEP_SUMMARY;
	if (summary) {
		yield* attempt(() =>
			appendFileSync(
				summary,
				`\nReleased \`v${version}\`. Pin consumers to \`${repository}/actions/<name>@v${major}\`.\n`,
			)
		);
	}
});

if (import.meta.main) await main(release);
