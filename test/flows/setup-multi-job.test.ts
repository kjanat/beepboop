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

test('a credential step with an expression for its aliases blocks setup', async () => {
	const repository = refsRepository(
		workflow.replace(`aliases: '["crates-io"]'`, 'aliases: ${{ vars.RELEASE_ALIASES }}'),
	);
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const plan = await previewSetup(api, repository.name, choices());
	expect(plan.blockers).toEqual([
		'publish.yml: list the credential aliases of job crates-io as literal JSON. Beepboop grants the aliases that setup reads from the workflow.',
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

function integration(
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
	return result.success;
}

function integrated(
	source: string,
	options: { tagPrefix?: string; release?: boolean; job?: string; files?: readonly string[] } = {},
) {
	const result = integration(source, options);
	expect(result.content).toBe(source);
	return result;
}

const tooling = [
	'      - uses: kjanat/beepboop/actions/token@v1\n        id: token\n        with: { execution-id: "${{ inputs.beepboop_execution_id }}" }\n',
	'      - uses: actions/create-github-app-token@v2\n        id: app\n',
	'      - uses: step-security/harden-runner@v2\n        with: { egress-policy: audit }\n',
];

test('a single job counts only an unconditional planned checkout after its existing begin step', () => {
	const single = [
		'name: Publish',
		'run-name: ${{ inputs.beepboop_title || github.workflow }}',
		'on:',
		'  workflow_dispatch:',
		'    inputs:',
		'      beepboop_execution_id: { type: string, required: true }',
		'      beepboop_title: { type: string, required: false }',
		'permissions: { contents: read, id-token: write }',
		'jobs:',
		'  publish:',
		'    runs-on: ubuntu-latest',
		'    steps:',
		'      - uses: actions/checkout@v7',
		'      - uses: ./actions/begin',
		'        id: beepboop',
		'        with: { execution-id: "${{ inputs.beepboop_execution_id }}", stream: main, operation: promote }',
		'      - uses: actions/checkout@v7',
		'        with: { ref: "${{ fromJSON(steps.beepboop.outputs.context).sourceSha }}" }',
		'      - run: npm publish',
		'',
	].join('\n');
	const blocker = 'publish.yml: checkout the execution sourceSha after begin';
	expect(integration(single).blockers).not.toContain(blocker);
	const conditional = single.replace(
		'      - uses: actions/checkout@v7\n        with: { ref:',
		'      - uses: actions/checkout@v7\n        if: false\n        with: { ref:',
	);
	expect(integration(conditional).blockers).toContain(blocker);
	const elsewhere = single.replace(
		'        with: { ref: "${{ fromJSON(steps.beepboop.outputs.context).sourceSha }}" }',
		'        with: { ref: "${{ fromJSON(steps.beepboop.outputs.context).sourceSha }}", path: release }',
	);
	expect(integration(elsewhere).blockers).toContain(blocker);
	const order = 'publish.yml: move the steps before the checkout of the execution sourceSha after that checkout';
	expect(integration(single).blockers).not.toContain(order);
	const early = single
		.replace('      - run: npm publish\n', '')
		.replace('      - uses: actions/checkout@v7\n        with: { ref:', '      - run: npm publish\n$&');
	expect(integration(early).blockers).toContain(order);
	expect(
		integration(single.replace('      - uses: actions/checkout@v7\n        with: { ref:', `${tooling[0]}$&`)).blockers,
	).toContain(
		'publish.yml: move the steps between the first checkout and the checkout of the execution sourceSha after that checkout',
	);
	for (const setup of tooling) {
		const prepared = single
			.replace('      - uses: actions/checkout@v7\n      - uses: ./actions/begin', '      - uses: ./actions/begin')
			.replace('      - uses: actions/checkout@v7\n        with: { ref:', `${setup}$&`);
		expect(integration(prepared).blockers).not.toContain(order);
	}
	expect(
		integration(
			single.replace('      - uses: actions/checkout@v7\n      - uses: ./actions/begin', '      - run: echo start\n$&'),
		)
			.blockers,
	).not.toContain(order);
	expect(
		integration(
			early.replace(
				'      - uses: actions/checkout@v7\n      - uses: ./actions/begin',
				'      - uses: ./actions/begin',
			),
		).blockers,
	)
		.toContain(order);
});

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
	const spaced = distributed.replace(`'["dist/index.js"]'`, `'[ "dist/index.js" ]'`);
	expect(integrated(spaced, { files: ['dist/index.js'] }).blockers).toEqual([]);
	const handBegun = carried.replaceAll('build-package', 'begin');
	expect(integrated(handBegun).notes).toEqual([
		'publish.yml: runs Beepboop in jobs begin, publish; setup leaves the workflow unchanged.',
	]);
	const bootstrapped = base.replace(
		'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
		'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
	);
	expect(integrated(bootstrapped).blockers).toEqual([]);
	for (const setup of tooling) {
		const before = base.replace('      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n', `${setup}$&`);
		expect(integrated(before).blockers).toEqual([]);
		const after = base.replace('      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(', `${setup}$&`);
		expect(integrated(after).blockers).toEqual([]);
	}
	const announced = base.replace(
		'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
		'      - run: echo start\n$&',
	);
	expect(integrated(announced).blockers).toEqual([]);
	const always = base.replace(
		'      - uses: kjanat/beepboop/actions/report@v1\n',
		'      - uses: kjanat/beepboop/actions/report@v1\n        if: always()\n',
	);
	expect(integrated(always).blockers).toEqual([]);
	const skippedBuild = base.replace(
		'  build:\n    runs-on: ubuntu-latest\n',
		'  build:\n    if: false\n    runs-on: ubuntu-latest\n',
	);
	for (const status of ['always()', '${{ !cancelled() }}']) {
		const resilient = skippedBuild.replace('    needs: build\n', `    needs: build\n    if: ${status}\n`);
		expect(integrated(resilient).blockers).toEqual([]);
	}
	const independent = skippedBuild.replace('    needs: build\n', '');
	expect(integrated(independent).blockers).toEqual([]);
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
			'a bootstrap checkout without a planned checkout after begin',
			base.replace(
				'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
				'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
			).replace(
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(steps.start.outputs.context).sourceSha }}" }\n',
				'',
			),
			['job build: check out the begin context sourceSha, or a job output that carries it'],
		],
		...['path: release', 'repository: octo/other'].map(input =>
			[
				`a bootstrap checkout whose planned checkout sets ${input}`,
				base.replace(
					'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
					'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
				).replace(
					'sourceSha }}" }\n',
					`sourceSha }}", ${input} }\n`,
				),
				['job build: check out the begin context sourceSha at the path and repository of the bootstrap checkout'],
			] as const
		),
		[
			'a step that uses the bootstrap checkout before the planned checkout',
			base.replace(
				'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
				'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
			).replace(
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(',
				'      - run: npm publish\n$&',
			),
			['job build: move the steps before the planned checkout after it'],
		],
		[
			'a step between the bootstrap checkout and its planned replacement after another planned checkout',
			base.replace(
				'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
				'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
			).replace(
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(',
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(steps.start.outputs.context).sourceSha }}", path: tools }\n      - run: npm publish\n$&',
			),
			['job build: move the steps between the bootstrap checkout and the planned checkout after the planned checkout'],
		],
		[
			'a token step between the bootstrap checkout and the planned checkout',
			base.replace(
				'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
				'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
			).replace('      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(', `${tooling[0]}$&`),
			['job build: move the steps between the bootstrap checkout and the planned checkout after the planned checkout'],
		],
		[
			'a publication action before begin and the planned checkout',
			base.replace(
				'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
				'      - uses: kjanat/beepboop/actions/publish-release@v1\n$&',
			),
			['job build: move the steps before the planned checkout after it'],
		],
		[
			'a step before the planned checkout',
			base.replace(
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(',
				'      - run: npm publish\n$&',
			),
			['job build: move the steps before the planned checkout after it'],
		],
		...['if: false', 'continue-on-error: true'].map(guard =>
			[
				`a begin step with ${guard}`,
				base.replace('        id: start\n', `        id: start\n        ${guard}\n`),
				['job build: run begin without if or continue-on-error'],
			] as const
		),
		...['if: false', 'if: ${{ false }}'].map(guard =>
			[
				`a report step with ${guard}`,
				base.replace(
					'      - uses: kjanat/beepboop/actions/report@v1\n',
					`      - uses: kjanat/beepboop/actions/report@v1\n        ${guard}\n`,
				),
				['report a result for pkg:npm/widget from a job with a begin step'],
			] as const
		),
		[
			'a publishing job with if: false',
			base.replace('    needs: build\n', '    needs: build\n    if: false\n'),
			['report a result for pkg:npm/widget from a job with a begin step'],
		],
		[
			'a publishing job that needs a job with if: false',
			base.replace('  build:\n    runs-on: ubuntu-latest\n', '  build:\n    if: false\n    runs-on: ubuntu-latest\n'),
			['report a result for pkg:npm/widget from a job with a begin step'],
		],
		[
			'a publishing job that needs a job with if: false through another job',
			base
				.replace('  build:\n    runs-on: ubuntu-latest\n', '  build:\n    if: false\n    runs-on: ubuntu-latest\n')
				.replace(
					'  publish:\n    needs: build\n',
					'  gate:\n    needs: build\n    if: success()\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo gate\n  publish:\n    needs: gate\n',
				),
			['report a result for pkg:npm/widget from a job with a begin step'],
		],
		[
			'a publish-refs step with if: false',
			`${base}      - uses: kjanat/beepboop/actions/publish-refs@v1\n        if: false\n`,
			['tag the release with publish-refs'],
			{ tagPrefix: 'v' },
		],
		...['if: ${{ false }}', 'if: false', 'continue-on-error: true'].flatMap(guard => {
			const guarded = base.replace(
				'      - uses: actions/checkout@v7\n        with: { ref: "${{ fromJSON(',
				`      - uses: actions/checkout@v7\n        ${guard}\n        with: { ref: "\${{ fromJSON(`,
			).replace('  publish:\n', '      - run: npm ci && npm run build\n$&');
			const unconditional =
				'job build: check out the begin context sourceSha in a step without if or continue-on-error';
			return [
				[`a planned checkout with ${guard}`, guarded, [unconditional]],
				[
					`a bootstrap checkout whose planned checkout has ${guard}`,
					guarded.replace(
						'      - uses: kjanat/beepboop/actions/begin@v1\n        id: start\n',
						'      - uses: actions/checkout@v7\n      - uses: ./actions/begin\n        id: start\n',
					),
					[unconditional, 'job build: check out the begin context sourceSha, or a job output that carries it'],
				],
			] as const;
		}),
		[
			'a checkout of the dispatch commit',
			base.replace('"${{ fromJSON(steps.start.outputs.context).sourceSha }}"', '"${{ github.sha }}"'),
			['job build: check out the begin context sourceSha, or a job output that carries it'],
		],
		[
			'a checkout of a job output from a job it does not need',
			base
				.replace(
					'  build:\n    runs-on: ubuntu-latest\n',
					'  build-package:\n    runs-on: ubuntu-latest\n    outputs:\n      source: ${{ fromJSON(steps.start.outputs.context).sourceSha }}\n',
				)
				.replace('    needs: build\n', '')
				.replace(
					'      - id: npm\n',
					'      - uses: actions/checkout@v7\n        with: { ref: "${{ needs.build-package.outputs.source }}" }\n      - id: npm\n',
				),
			['job publish: check out the begin context sourceSha, or a job output that carries it'],
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
		[
			'a distribution publish-refs step with other files',
			`${base}      - uses: kjanat/beepboop/actions/publish-refs@v1\n        with: { files: '["dist/other.js"]' }\n`,
			['job publish: pass the distribution files ["dist/index.js"] to publish-refs'],
			{ files: ['dist/index.js'] },
		],
		[
			'a distribution publish-refs step with files that are not JSON',
			`${base}      - uses: kjanat/beepboop/actions/publish-refs@v1\n        with: { files: dist/index.js }\n`,
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

test('workflow credentials carry the environment of their job, belong to its operation and name unreadable requests', () => {
	const source = [
		'jobs:',
		'  first:',
		'    environment: { name: crates-io, url: https://crates.io }',
		'    steps:',
		'      - uses: kjanat/beepboop/actions/begin@v1',
		'        with: { operation: promote }',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: \'["crates-io", 7, ""]\' }',
		'  second:',
		"    if: ${{ inputs.beepboop_operation == 'publish' }}",
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
		'      - uses: kjanat/beepboop/actions/begin@v1',
		'        with: { operation: promote }',
		'      - uses: kjanat/beepboop/actions/publish@v1',
		'        with: { credentials: \'{"NODE_AUTH_TOKEN": "npm-token"}\' }',
		'      - uses: actions/checkout@v7',
		'  unwrapped:',
		"    if: inputs.beepboop_operation  ==  'publish'",
		'    steps:',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: \'["unwrapped-token"]\' }',
		'  expressed:',
		'    steps:',
		'      - uses: kjanat/beepboop/actions/begin@v1',
		'        with: { operation: promote }',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: "${{ vars.RELEASE_ALIASES }}" }',
		'  embedded:',
		"    if: ${{ inputs.beepboop_operation == 'publish' }}",
		'    steps:',
		'      - uses: kjanat/beepboop/actions/publish@v1',
		'        with: { credentials: \'{"TOKEN": "${{ vars.TOKEN }}"}\' }',
		'  preparation:',
		"    if: ${{ inputs.beepboop_operation == 'publish' }}",
		'    steps:',
		'      - uses: kjanat/beepboop/actions/begin@v1',
		'        with: { operation: prepare }',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: \'["prepare-token"]\' }',
		'  unguarded:',
		'    steps:',
		'      - uses: kjanat/beepboop/actions/credentials@v1',
		'        with: { aliases: \'["stray-token"]\' }',
	].join('\n');
	expect(workflowCredentials(source, 'promote')).toEqual({
		credentials: [
			{ alias: 'crates-io', environment: 'crates-io' },
			{ alias: 'npm-token' },
			{ alias: 'npm-token', environment: 'npm' },
			{ alias: 'unwrapped-token' },
		],
		unresolved: ['second', 'expressed', 'embedded'],
	});
	expect(workflowCredentials(source, 'prepare')).toEqual({ credentials: [{ alias: 'prepare-token' }], unresolved: [] });
	expect(workflowCredentials(undefined, 'promote')).toEqual({ credentials: [], unresolved: [] });
	expect(workflowCredentials(source, 'prepare', 'unguarded').credentials).toEqual([
		{ alias: 'prepare-token' },
		{ alias: 'stray-token' },
	]);
	const only =
		'jobs:\n  only:\n    steps:\n      - uses: kjanat/beepboop/actions/credentials@v1\n        with: { aliases: \'["only-token"]\' }\n';
	expect(workflowCredentials(only, 'promote').credentials).toEqual([{ alias: 'only-token' }]);
	expect([...workflowActions(source)].sort()).toEqual(['begin', 'credentials', 'publish']);
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

test('merging a shared workflow grants a publication credential to the publication operation only', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			prepare: {
				file: 'release-widget.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'npm install',
				publicationSteps: {},
			},
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
	await discoverSetup(api, repository.name);
	const merged = await previewSetup(api, repository.name, plan.choices);
	expect(merged.notes.filter(note => note.includes('grants it the stored'))).toEqual([
		'release-widget.yml: when the repository owner merges this PR, Beepboop grants it the stored npm-token secret for the promote operation.',
	]);
});

test('setup reads the credential aliases of the job it adds begin to', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/ship.yml': [
			'name: Ship',
			'on: { workflow_dispatch: {} }',
			'jobs:',
			'  ship:',
			'    runs-on: ubuntu-latest',
			'    steps:',
			'      - uses: actions/checkout@v7',
			'      - uses: kjanat/beepboop/actions/credentials@v1',
			'        with: { aliases: \'["npm-token"]\' }',
			'      - id: npm',
			'        run: npm publish',
			'  lint:',
			'    runs-on: ubuntu-latest',
			'    steps:',
			'      - uses: kjanat/beepboop/actions/credentials@v1',
			'        with: { aliases: \'["stray-token"]\' }',
			'',
		].join('\n'),
	}, 'Add a ship workflow');
	const api = bearer(world, await world.cliSession());
	await discoverSetup(api, repository.name);
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			promote: {
				file: 'ship.yml',
				job: 'ship',
				triggers: 'review',
				commands: '',
				publicationSteps: { 'pkg:npm/widget': 'npm' },
			},
		}],
	};
	const plan = await previewSetup(api, repository.name, choices);
	expect(plan.blockers).toEqual([]);
	expect(plan.notes.filter(note => note.includes('grants it the stored'))).toEqual([
		'ship.yml: when the repository owner merges this PR, Beepboop grants it the stored npm-token secret for the promote operation.',
	]);
	expect((await applySetup(api, repository.name, plan, plan.choices)).status).toBe(200);
	for (const alias of ['npm-token', 'stray-token']) await world.sealCredential(alias);
	expect(await mergedGrants(repository)).toEqual([['npm-token', 'promote', 'ship.yml', undefined]]);
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
