import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Repository } from '@root/test/support/github.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { widget } from '@root/test/support/repositories.ts';
import { applySetup, discoverSetup, previewSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Result, Schema } from 'effect';
import { discover } from '@/automation/managers';
import type { SetupChoices } from '@/automation/setup-types';
import { integrateWorkflow, workflowActions, workflowCredentials } from '@/automation/setup-workflows';
import { decodeSync, looseStruct, mutableArray, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';

let world: World;
eachWorld(created => {
	world = created;
});

const workflow = readFileSync(join(import.meta.dir, '../fixtures/workflows/multi-job-publish.yml'), 'utf8');
const packages = ['pkg:cargo/git-remote-refs', 'pkg:npm/git-remote-refs'];

function refsRepository(publish = workflow) {
	return world.github.create('octo/refs', {
		'Cargo.toml': '[package]\nname = "git-remote-refs"\nversion = "0.1.0"\nedition = "2024"\nlicense = "MIT"\n',
		'package.json': '{"name":"git-remote-refs","version":"0.1.0","license":"MIT"}\n',
		'.github/workflows/publish.yml': publish,
	});
}

function choices(job = 'crates-io'): SetupChoices {
	return {
		streams: [{
			name: 'git-remote-refs',
			packages,
			required: packages,
			versioning: 'workspace',
			promote: { file: 'publish.yml', job, triggers: 'preserve', commands: '', publicationSteps: {}, tagPrefix: 'v' },
		}],
	};
}

const configuration = mutableStruct({
	streams: mutableRecord(
		Schema.String,
		looseStruct({
			credentials: mutableArray(Schema.String),
			promote: looseStruct({
				workflow: looseStruct({ file: Schema.String, publications: mutableArray(Schema.String) }),
			}),
		}),
	),
});

async function mergedGrants(repository: Repository) {
	const merged = world.github.merge(repository, 1);
	await world.webhook('pull_request', {
		action: 'closed',
		pull_request: {
			number: 1,
			merged: true,
			merge_commit_sha: merged.sha,
			user: { id: botId },
			merged_by: { id: ownerId, login: 'octo' },
			head: { ref: 'automation/onboarding', repo: { id: repository.id } },
			base: { repo: { id: repository.id } },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
	const rows = await world.db.prepare('SELECT document FROM grants WHERE repository_id=?').bind(repository.id).all();
	return decodeSync(mutableArray(mutableStruct({ document: Schema.String })), rows.results).map(row => {
		const grant = decodeSync(
			looseStruct({
				alias: Schema.String,
				operation: Schema.String,
				workflow: Schema.String,
				environment: Schema.optional(Schema.String),
			}),
			JSON.parse(row.document),
		);
		return [grant.alias, grant.operation, grant.workflow, grant.environment];
	}).sort();
}

test('setup adopts a publish workflow that already runs Beepboop in several jobs', async () => {
	const repository = refsRepository();
	const api = bearer(world, await world.cliSession());
	const inferred = await discoverSetup(api, repository.name);
	expect(inferred.blockers).toEqual([]);
	expect(inferred.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
	expect(inferred.choices.streams[0]?.promote).toMatchObject({ file: 'publish.yml', tagPrefix: 'v' });
	for (const job of ['package', 'crates-io', 'npm', 'release']) {
		const plan = await previewSetup(api, repository.name, choices(job));
		expect(plan.blockers).toEqual([]);
		expect(plan.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
		const stream = decodeSync(
			configuration,
			JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
		).streams['git-remote-refs'];
		expect(stream?.credentials).toEqual(['crates-io', 'npm-token']);
		expect(stream?.promote.workflow.publications).toEqual([...packages, 'github-release:octo/refs']);
		expect(stream?.promote.workflow['refs']).toEqual({ phase: 'version', prefix: 'v' });
		expect(stream?.['packageTags']).toEqual(packages);
		expect(plan.notes).toEqual(expect.arrayContaining([
			'publish.yml: runs Beepboop in jobs package, crates-io, npm, release; setup leaves the workflow unchanged.',
			'publish.yml: when the repository owner merges this PR, Beepboop grants it the stored crates-io secret for the promote operation in the crates-io environment.',
			'publish.yml: when the repository owner merges this PR, Beepboop grants it the stored npm-token secret for the promote operation in the npm environment.',
		]));
	}
});

test('setup names each gap in a workflow that runs Beepboop in several jobs', async () => {
	const broken = workflow
		.replace('"id": "pkg:npm/git-remote-refs"', '"id": "pkg:npm/other"')
		.replace('ref: ${{ needs.package.outputs.source-sha }}\n', 'fetch-depth: 1\n')
		.replace('run-name: ${{ inputs.beepboop_title || github.workflow }}\n', '')
		.replace(
			'      - name: Tag the published version\n        uses: kjanat/beepboop/actions/publish-refs@v1\n',
			'      - name: Tag the published version\n        uses: actions/github-script@v8\n',
		);
	const repository = refsRepository(broken);
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const plan = await previewSetup(api, repository.name, choices());
	expect(plan.blockers).toEqual([
		'publish.yml: set run-name to ${{ inputs.beepboop_title || github.workflow }}',
		'publish.yml: job crates-io: check out the begin context sourceSha, or a job output that carries it',
		'publish.yml: report a result for pkg:npm/git-remote-refs from a job with a begin step',
		'publish.yml: tag the release with publish-refs',
	]);
});

test('a credential job with an expression environment blocks the grant it cannot match', async () => {
	const repository = refsRepository(
		workflow.replace('    environment: crates-io\n', '    environment: ${{ inputs.registry }}\n'),
	);
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const plan = await previewSetup(api, repository.name, choices());
	expect(plan.blockers).toEqual([
		'publish.yml: give the job that requests crates-io a fixed environment name. Beepboop grants a credential to one named environment.',
	]);
	expect(plan.notes.filter(note => note.includes('grants it the stored'))).toEqual([
		'publish.yml: when the repository owner merges this PR, Beepboop grants it the stored npm-token secret for the promote operation in the npm environment.',
	]);
});

test('merging the adoption PR grants each workflow credential in its job environment', async () => {
	const repository = refsRepository();
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const plan = await previewSetup(api, repository.name, choices());
	expect(plan.blockers).toEqual([]);
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
	await world.sealCredential('crates-io');
	await world.sealCredential('npm-token');
	expect(await mergedGrants(repository)).toEqual([
		['crates-io', 'promote', 'publish.yml', 'crates-io'],
		['npm-token', 'promote', 'publish.yml', 'npm'],
	]);
});

const base = readFileSync(join(import.meta.dir, '../fixtures/workflows/multi-job-minimal.yml'), 'utf8');

function integrated(
	source: string,
	options: { tagPrefix?: string; release?: boolean; job?: string; files?: readonly string[] } = {},
) {
	const snapshot = {
		repository: { id: 1, name: 'octo/widget', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: { 'package.json': '{"name":"widget","version":"1.0.0"}\n', '.github/workflows/publish.yml': source },
		paths: ['package.json', '.github/workflows/publish.yml'],
	};
	const result = integrateWorkflow(
		snapshot,
		'main',
		'promote',
		{
			file: 'publish.yml',
			triggers: 'review',
			commands: '',
			publicationSteps: {},
			...(options.tagPrefix ? { tagPrefix: options.tagPrefix } : {}),
			...(options.job ? { job: options.job } : {}),
		},
		discover(snapshot).packages,
		undefined,
		undefined,
		options.release,
		options.files ? [...options.files] : undefined,
	);
	if (Result.isFailure(result)) throw result.failure;
	expect(result.success.content).toBe(source);
	return result.success;
}

test('a workflow wired across jobs, or one wired job that depends on another, stays unchanged', () => {
	expect(integrated(base)).toEqual({
		content: base,
		blockers: [],
		notes: ['publish.yml: runs Beepboop in jobs build, publish; setup leaves the workflow unchanged.'],
	});
	const single = base.replace(/ {6}- uses: kjanat\/beepboop\/actions\/begin@v1\n {8}id: start\n.*\n/, '');
	expect(integrated(single).notes).toEqual([
		'publish.yml: runs Beepboop in jobs publish; setup leaves the workflow unchanged.',
	]);
	const carried = base
		.replace(
			'  build:\n    runs-on: ubuntu-latest\n',
			'  build-package:\n    runs-on: ubuntu-latest\n    outputs:\n      source: ${{ fromJSON(steps.start.outputs.context).sourceSha }}\n',
		)
		.replace('    needs: build\n', '    needs: build-package\n')
		.replace(
			'      - id: npm\n',
			'      - uses: actions/checkout@v7\n        with: { ref: "${{ needs.build-package.outputs.source }}" }\n      - id: npm\n',
		);
	expect(integrated(carried).notes).toEqual([
		'publish.yml: runs Beepboop in jobs build-package, publish; setup leaves the workflow unchanged.',
	]);
	const distributed =
		`${base}      - uses: kjanat/beepboop/actions/publish-refs@v1\n        with: { files: '["dist/index.js"]' }\n`;
	expect(integrated(distributed, { files: ['dist/index.js'] }).blockers).toEqual([]);
	const handBegun = carried.replaceAll('build-package', 'begin');
	expect(integrated(handBegun).notes).toEqual([
		'publish.yml: runs Beepboop in jobs begin, publish; setup leaves the workflow unchanged.',
	]);
	const writeAll = base.replace('permissions: { contents: read, id-token: write }', 'permissions: write-all');
	expect(integrated(writeAll).blockers).toEqual([]);
	const conditional = single.replace('    needs: build\n', "    if: ${{ github.ref == 'refs/heads/main' }}\n");
	expect(integrated(conditional, { job: 'publish' }).blockers).toEqual([
		'publish.yml: reusable, matrix, dependent, conditional or container jobs require explicit workflow integration before setup',
	]);
	const ledger = base.replace(
		/ {6}- id: npm\n[\s\S]*$/,
		'      - uses: kjanat/beepboop/actions/publish@v1\n        with: { execution-id: "${{ steps.beepboop.outputs.execution-id }}" }\n',
	);
	expect(integrated(ledger).blockers).toEqual([]);
});

for (
	const [label, source, blockers, options] of [
		[
			'another trigger',
			base.replace('on:\n', 'on:\n  push: { branches: [main] }\n'),
			['a workflow that runs Beepboop in several jobs must run only on workflow_dispatch'],
		],
		[
			'an optional execution input',
			base.replace(
				'beepboop_execution_id: { type: string, required: true }',
				'beepboop_execution_id: { type: string }',
			),
			['workflow_dispatch needs the required string input beepboop_execution_id'],
		],
		[
			'a required title input',
			base.replace(
				'beepboop_title: { type: string, required: false }',
				'beepboop_title: { type: string, required: true }',
			),
			['workflow_dispatch needs the optional string input beepboop_title'],
		],
		[
			'a required input without a default',
			base.replace(
				'      beepboop_title: { type: string, required: false }\n',
				'      beepboop_title: { type: string, required: false }\n      target: { type: string, required: true }\n',
			),
			['required dispatch input target needs a configured default'],
		],
		[
			'another run name',
			base.replace(/^run-name: .*\n/m, ''),
			['set run-name to ${{ inputs.beepboop_title || github.workflow }}'],
		],
		[
			'a reporting job without begin',
			`${base}  stray:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: kjanat/beepboop/actions/report@v1\n`,
			['job stray reports publications without a begin step'],
		],
		[
			'two begin steps in one job',
			base.replace(
				'      - uses: actions/checkout@v7\n',
				'      - uses: kjanat/beepboop/actions/begin@v1\n        with: { stream: main, operation: promote }\n      - uses: actions/checkout@v7\n',
			),
			['job build has more than one begin step'],
		],
		[
			'a begin step without an ID',
			base.replace('        id: start\n', ''),
			[
				'job build: begin needs a static step ID',
				'job build: check out the begin context sourceSha, or a job output that carries it',
			],
		],
		[
			'a begin step without the execution input',
			base.replace(
				'with: { execution-id: "${{ inputs.beepboop_execution_id }}", stream: main, operation: promote }\n      - uses: actions/checkout',
				'with: { stream: main, operation: promote }\n      - uses: actions/checkout',
			),
			['job build: begin must take inputs.beepboop_execution_id'],
		],
		[
			'a job without an OIDC token',
			base.replace(
				'  build:\n    runs-on: ubuntu-latest\n',
				'  build:\n    runs-on: ubuntu-latest\n    permissions: { contents: read }\n',
			),
			['job build needs id-token: write'],
		],
		[
			'a checkout of the dispatch ref',
			base.replace(
				'with: { ref: "${{ fromJSON(steps.start.outputs.context).sourceSha }}" }',
				'with: { fetch-depth: 0 }',
			),
			['job build: check out the begin context sourceSha, or a job output that carries it'],
		],
		[
			'a checkout before its begin step',
			base.replace(
				'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(steps.start.outputs.context).sourceSha }}" }\n      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
			),
			['job build: check out the begin context sourceSha after the begin step'],
		],
		[
			'a checkout of the dispatch commit',
			base.replace('"${{ fromJSON(steps.start.outputs.context).sourceSha }}"', '"${{ github.sha }}"'),
			['job build: check out the begin context sourceSha, or a job output that carries it'],
		],
		[
			'a checkout of a job output that carries something else',
			base.replace('"${{ fromJSON(steps.start.outputs.context).sourceSha }}"', '"${{ needs.publish.outputs.other }}"'),
			['job build: check out the begin context sourceSha, or a job output that carries it'],
		],
		[
			'a report for another execution',
			base.replace('execution-id: ${{ steps.beepboop.outputs.execution-id }}', 'execution-id: ${{ github.run_id }}'),
			['job publish: report must take the begin execution ID'],
		],
		[
			'unreadable publications',
			base.replace(`publications: '[{"id":"pkg:npm/widget"}]'`, `publications: '{"id":"pkg:npm/widget"}'`),
			[
				'job publish: report publications must be a JSON array',
				'report a result for pkg:npm/widget from a job with a begin step',
			],
		],
		[
			'a missing publication',
			base.replace('pkg:npm/widget', 'pkg:npm/other'),
			['report a result for pkg:npm/widget from a job with a begin step'],
		],
		['tags without publish-refs', base, ['tag the release with publish-refs'], { tagPrefix: 'v' }],
		[
			'a distribution publish-refs step without its files',
			`${base}      - uses: kjanat/beepboop/actions/publish-refs@v1\n`,
			['job publish: pass the distribution files ["dist/index.js"] to publish-refs'],
			{ files: ['dist/index.js'] },
		],
		['a release without publish-release', base, ['publish the GitHub release with publish-release'], { release: true }],
	] as const
) {
	test(`setup names ${label} in a workflow that runs Beepboop in several jobs`, () => {
		const result = integrated(source, options);
		expect(result.blockers).toEqual(blockers.map(blocker => `publish.yml: ${blocker}`));
		expect(result.notes).toEqual([]);
	});
}

test('workflow credentials carry the environment of their job', () => {
	const source = [
		'jobs:',
		'  first:',
		'    environment: { name: crates-io, url: https://crates.io }',
		'    steps:',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: \'["crates-io", 7, ""]\' }',
		'  second:',
		'    steps:',
		'      - uses: $/actions/credentials',
		'        with: { aliases: \'["npm-token"]\' }',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: \'["npm-token"]\' }',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: not json }',
		'  third:',
		'    environment: npm',
		'    steps:',
		'      - uses: kjanat/beepboop/actions/publish@v1',
		'        with: { credentials: \'{"NODE_AUTH_TOKEN": "npm-token"}\' }',
		'      - uses: actions/checkout@v7',
	].join('\n');
	expect(workflowCredentials(source)).toEqual([
		{ alias: 'crates-io', environment: 'crates-io' },
		{ alias: 'npm-token' },
		{ alias: 'npm-token', environment: 'npm' },
	]);
	expect(workflowCredentials(undefined)).toEqual([]);
	expect([...workflowActions(source)].sort()).toEqual(['credentials', 'publish']);
});

test('merging a setup PR grants a credential once when the choice and the workflow both request it', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			promote: {
				file: 'release-widget.yml',
				job: 'publish',
				triggers: 'review',
				commands: 'npm publish',
				publicationSteps: {},
				credentials: { NODE_AUTH_TOKEN: 'npm-token' },
			},
		}],
	};
	const plan = await previewSetup(api, repository.name, choices);
	expect(plan.blockers).toEqual([]);
	expect(plan.notes.filter(note => note.includes('grants it the stored'))).toEqual([
		'release-widget.yml: when the repository owner merges this PR, Beepboop grants it the stored npm-token secret for the promote operation.',
	]);
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
	await world.sealCredential('npm-token');
	expect(await mergedGrants(repository)).toEqual([['npm-token', 'promote', 'release-widget.yml', undefined]]);
});

test('package tags follow a plain v tag and keep a configured list', async () => {
	const repository = refsRepository();
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const stream = async (tagPrefix: string) => {
		const chosen = choices();
		const [first] = chosen.streams;
		if (!first?.promote) throw new Error('No promote choice');
		first.promote.tagPrefix = tagPrefix;
		const plan = await previewSetup(api, repository.name, chosen);
		expect(plan.blockers).toEqual([]);
		return decodeSync(
			configuration,
			JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
		).streams['git-remote-refs'];
	};
	expect((await stream('v'))?.['packageTags']).toEqual(packages);
	expect((await stream('refs-v'))?.['packageTags']).toBeUndefined();
	world.github.push(
		repository,
		{
			'.github/beepboop.json': JSON.stringify({
				streams: { 'git-remote-refs': { packages, packageTags: ['pkg:npm/git-remote-refs'] } },
			}),
		},
		'Tag only the npm package',
	);
	await discoverSetup(api, repository.name);
	expect((await stream('v'))?.['packageTags']).toEqual(['pkg:npm/git-remote-refs']);
});

const extra = readFileSync(join(import.meta.dir, '../fixtures/workflows/multi-job-extra.yml'), 'utf8');

test('an additional operation workflow gets its credential grant in its job environment', async () => {
	const repository = world.github.create('octo/refs', {
		'Cargo.toml': '[package]\nname = "git-remote-refs"\nversion = "0.1.0"\nedition = "2024"\nlicense = "MIT"\n',
		'package.json': '{"name":"git-remote-refs","version":"0.1.0","license":"MIT"}\n',
		'.github/workflows/publish.yml': workflow,
		'.github/workflows/extra.yml': extra,
	});
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const chosen = choices();
	const [stream] = chosen.streams;
	if (!stream) throw new Error('No stream');
	stream.operations = [{
		name: 'extra',
		file: 'extra.yml',
		triggers: 'review',
		commands: '',
		publicationSteps: {},
		needs: ['promote'],
		publications: ['pkg:npm/git-remote-refs'],
	}];
	const plan = await previewSetup(api, repository.name, chosen);
	expect(plan.blockers).toEqual([]);
	expect(plan.notes).toContain(
		'extra.yml: when the repository owner merges this PR, Beepboop grants it the stored extra-token secret for the extra operation in the extra environment.',
	);
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
	for (const alias of ['crates-io', 'npm-token', 'extra-token']) await world.sealCredential(alias);
	expect(await mergedGrants(repository)).toEqual([
		['crates-io', 'promote', 'publish.yml', 'crates-io'],
		['extra-token', 'extra', 'extra.yml', 'extra'],
		['npm-token', 'promote', 'publish.yml', 'npm'],
	]);
});

test('merging skips an alias that the merged workflow adds without the configuration listing it', async () => {
	const repository = refsRepository();
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const plan = await previewSetup(api, repository.name, choices());
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
	world.github.push(
		repository,
		{
			'.github/workflows/publish.yml': workflow.replace(
				`aliases: '["crates-io"]'`,
				`aliases: '["crates-io", "extra-token"]'`,
			),
		},
		'Request another token',
		'automation/onboarding',
	);
	for (const alias of ['crates-io', 'npm-token', 'extra-token']) await world.sealCredential(alias);
	expect(await mergedGrants(repository)).toEqual([
		['crates-io', 'promote', 'publish.yml', 'crates-io'],
		['npm-token', 'promote', 'publish.yml', 'npm'],
	]);
});
