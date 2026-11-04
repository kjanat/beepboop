import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { RefChange } from '@/automation/refs';
import { compareVersions, record } from '@/model';
import { publishRefs } from '../../../actions/runtime/refs.ts';

type Bump = 'major' | 'minor' | 'patch';
interface Contract {
	inputs: Map<string, boolean>;
	outputs: Set<string>;
}

function git(...args: string[]): string {
	const result = spawnSync('git', args, { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

function contracts(revision: string): Map<string, Contract> {
	const files = git('ls-tree', '-r', '--name-only', revision, '--', 'actions').split('\n')
		.filter(path => /^actions\/[^/]+\/action\.ya?ml$/.test(path));
	return new Map(files.map(path => {
		const action = record(parse(git('show', `${revision}:${path}`)));
		const inputs = Object.entries(record(action.inputs ?? {})).map(([name, value]): [string, boolean] => {
			const input = record(value);
			return [name, input.required === true && input.default === undefined];
		});
		return [path.split('/')[1] ?? path, {
			inputs: new Map(inputs),
			outputs: new Set(Object.keys(record(action.outputs ?? {}))),
		}];
	}));
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

const distribution = process.env.DISTRIBUTION_COMMIT ?? '';
const repository = process.env.GITHUB_REPOSITORY ?? '';
if (!/^[a-f0-9]{40}$/.test(distribution)) throw new Error('DISTRIBUTION_COMMIT must be a full commit SHA');
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY is required');

const tags = new Map<string, { oid: string; commit: string }>();
for (const line of git('ls-remote', '--tags', 'origin', 'refs/tags/v*').split('\n').filter(Boolean)) {
	const [oid = '', ref = ''] = line.split('\t');
	const name = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
	const known = tags.get(name);
	tags.set(name, ref.endsWith('^{}') ? { oid: known?.oid ?? oid, commit: oid } : { oid, commit: known?.commit ?? oid });
}
const latest = [...tags.keys()].filter(name => /^v\d+\.\d+\.\d+$/.test(name))
	.sort((a, b) => compareVersions(a.slice(1), b.slice(1))).at(-1);
const latestCommit = latest ? tags.get(latest)?.commit : undefined;

if (latestCommit === distribution) {
	console.log(`${latest} already points at ${distribution}`);
} else {
	let version = '1.0.0';
	if (latest && latestCommit) {
		git('fetch', '--no-tags', 'origin', latestCommit);
		const level = bump(contracts(`${latestCommit}^1`), contracts(`${distribution}^1`));
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
	publishRefs(
		{
			repository,
			executionId: `publish-actions:${process.env.GITHUB_RUN_ID ?? ''}`,
			version,
			changes: [change(`v${version}`, true), change(`v${major}`, false), change(`v${major}.${minor}`, false)],
		},
		process.cwd(),
		'origin',
	);
	console.log(`Tagged v${version}; moved v${major} and v${major}.${minor}`);
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`Released \`v${version}\`. Pin consumers to \`${repository}/actions/<name>@v${major}\`.\n`,
		);
	}
}
