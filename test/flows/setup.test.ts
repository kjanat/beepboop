import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Effect, Result } from 'effect';
import { parse } from 'yaml';
import { z } from 'zod';
import { mergeConfiguration } from '@/automation/configuration';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices } from '@/automation/setup-types';
import { bearer, field } from '@root/test/support/http.ts';
import { publishWorkflow, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

test('a discovered repository can preview, open and refresh its setup PR', async () => {
	const repository = widget(world.github, { configured: false });
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const initial = await api('/api/repositories/setup/preview', { repository: repository.name });
	expect(initial.status).toBe(200);
	const suggested = await Effect.runPromise(parseSetupPlan(initial.body));
	expect(suggested.packageIds).toContain('pkg:npm/widget');
	const choices: SetupChoices = {
		streams: [{
			name: 'main',
			packages: ['pkg:npm/widget'],
			required: ['pkg:npm/widget'],
			versioning: 'workspace',
			prepare: {
				file: 'prepare.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'npm install',
				publicationSteps: {},
			},
			promote: {
				file: 'release.yml',
				job: 'promote',
				triggers: 'review',
				commands: 'npm publish',
				publicationSteps: {},
			},
		}],
	};
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
	expect(preview.status).toBe(200);
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
	const refreshed = await api('/api/repositories/setup/preview', { repository: repository.name });
	expect(refreshed.status).toBe(200);
	const next = await Effect.runPromise(parseSetupPlan(refreshed.body));
	expect(next.blockers).toEqual([]);
	expect(next.choices).toEqual(choices);
	const reapplied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: next.choices,
		planId: next.planId,
		sourceSha: next.sourceSha,
		setupHead: next.setupHead,
	});
	expect(reapplied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
});

const workflowSchema = z.object({
	jobs: z.object({
		publish: z.object({
			steps: z.array(z.object({
				uses: z.string().optional(),
				run: z.string().optional(),
				id: z.string().optional(),
				with: z.record(z.string(), z.unknown()).optional(),
			})),
		}),
	}),
});

for (const configured of [false, true]) {
	test(`setup adopts an existing integration with managed preparation (configured=${configured})`, async () => {
		const repository = widget(world.github, { configured });
		const api = bearer(world, await world.cliSession());
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
		expect(preview.status).toBe(200);
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([]);
		expect(plan.choices.streams[0]?.prepare).toBeUndefined();
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
		expect(applied.status).toBe(200);
		expect(repository.pulls).toHaveLength(1);
		const edit = plan.edits.find(edit => edit.path === '.github/workflows/publish.yml');
		const steps = workflowSchema.parse(parse(edit?.after ?? '')).jobs.publish.steps;
		expect(steps.map(step => step.uses ?? step.run)).toEqual([
			'actions/checkout@v7',
			'kjanat/beepboop/actions/begin@actions',
			'actions/checkout@v7',
			'npm publish',
			'kjanat/beepboop/actions/report@actions',
		]);
		expect(steps[2]?.with).toEqual({
			ref: '${{ fromJSON(steps.release.outputs.context).sourceSha }}',
			'persist-credentials': false,
		});
		const refresh = await api('/api/repositories/setup/preview', { repository: repository.name });
		const refreshed = await Effect.runPromise(parseSetupPlan(refresh.body));
		expect(refreshed.blockers).toEqual([]);
		expect(refreshed.edits).toEqual(plan.edits);
		world.github.merge(repository, 1);
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
		expect(
			(await api('/api/releases/plan', {
				repositoryId: repository.id,
				stream: 'main',
				version: '1.1.0',
			})).status,
		).toBe(200);
	});
}

test('adoption preserves an ordinary checkout immediately before begin', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/workflows/publish.yml': publishWorkflow.replace(
			'    steps:\n',
			`    steps:
      - uses: actions/checkout@v6
        id: source
        with:
          fetch-depth: 0
`,
		),
	}, 'Use a root checkout before setup');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	const edit = plan.edits.find(edit => edit.path === '.github/workflows/publish.yml');
	const steps = workflowSchema.parse(parse(edit?.after ?? '')).jobs.publish.steps;
	expect(steps[0]).toEqual({
		uses: 'actions/checkout@v6',
		id: 'source',
		with: { 'fetch-depth': 0, 'persist-credentials': false },
	});
	expect(steps[1]?.uses).toBe('kjanat/beepboop/actions/begin@actions');
	expect(steps[2]?.with?.ref).toBe('${{ fromJSON(steps.release.outputs.context).sourceSha }}');
});

for (const preparation of ['run: npm install', 'uses: octo/build-artifacts@v1']) {
	test(`adoption refuses to clean workspace preparation before begin (${preparation})`, async () => {
		const repository = widget(world.github, { configured: false });
		world.github.push(repository, {
			'.github/workflows/publish.yml': publishWorkflow.replace(
				'    steps:\n',
				`    steps:
      - uses: actions/checkout@v7
      - ${preparation}
`,
			),
		}, 'Prepare workspace before begin');
		const api = bearer(world, await world.cliSession());
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toContain(
			'publish.yml: steps before begin need explicit integration; prepare dependencies and build output after the approved checkout',
		);
		expect(plan.edits.find(edit => edit.path === '.github/workflows/publish.yml')).toBeUndefined();
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
		expect(applied.status).toBe(422);
		expect(repository.pulls).toHaveLength(0);
	});
}

for (const versioning of ['workspace', 'independent', 'none'] as const) {
	test(`tag-only packages need a preparation workflow (versioning=${versioning})`, async () => {
		const repository = world.github.create('octo/tagged', { 'go.mod': 'module github.com/octo/tagged\n\ngo 1.26\n' });
		const api = bearer(world, await world.cliSession());
		const choices: SetupChoices = {
			streams: [{
				name: 'main',
				packages: ['pkg:golang/github.com/octo/tagged'],
				required: [],
				versioning,
				promote: {
					file: 'publish.yml',
					job: 'publish',
					triggers: 'review',
					commands: 'goreleaser release',
					publicationSteps: {},
				},
			}],
		};
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([
			'main: select a preparation workflow; managed preparation needs a version stored in a file.',
		]);
		const applied = await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: plan.choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
		expect(applied.status).toBe(422);
		expect(repository.pulls).toHaveLength(0);
	});
}

test('tag-only packages with a version file can use managed preparation', async () => {
	const repository = world.github.create('octo/tagged', {
		'go.mod': 'module github.com/octo/tagged\n\ngo 1.26\n',
		'VERSION': 'version=1.0.0\n',
		'.github/beepboop.json': JSON.stringify({
			managers: ['go', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:golang/github.com/octo/tagged'],
					versionFiles: [{ path: 'VERSION', format: 'text', prefix: 'version=', suffix: '\n' }],
				},
			},
		}),
	});
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', {
		repository: repository.name,
		choices: {
			streams: [{
				name: 'main',
				packages: ['pkg:golang/github.com/octo/tagged'],
				required: [],
				versioning: 'workspace',
				promote: {
					file: 'publish.yml',
					job: 'publish',
					triggers: 'review',
					commands: 'goreleaser release',
					publicationSteps: {},
				},
			}],
		},
	});
	const setup = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(setup.blockers).toEqual([]);
	expect(
		(await api('/api/repositories/setup/apply', {
			repository: repository.name,
			choices: setup.choices,
			planId: setup.planId,
			sourceSha: setup.sourceSha,
			setupHead: setup.setupHead,
		})).status,
	).toBe(200);
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const release = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect(release.status).toBe(200);
	expect(field(release.body, 'requiresPreparation')).toBe(false);
	expect(field(release.body, 'edits')).toEqual([{
		path: 'VERSION',
		before: 'version=1.0.0\n',
		after: 'version=1.1.0\n',
	}]);
	expect(
		(await api('/api/releases/prepare', {
			repositoryId: repository.id,
			stream: 'main',
			version: '1.1.0',
			planId: field(release.body, 'planId'),
			sourceSha: field(release.body, 'sourceSha'),
		})).status,
	).toBe(200);
});

test('managed setup still requires a workflow to regenerate lockfiles', async () => {
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, { 'package-lock.json': '{"lockfileVersion":3}\n' }, 'Add a lockfile');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('main: select a preparation workflow to regenerate lockfiles.');
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(422);
	expect(repository.pulls).toHaveLength(0);
});

test('setup preserves a configured workflow preparation strategy', async () => {
	const repository = widget(world.github);
	world.github.push(repository, {
		'.github/beepboop.json': widgetConfiguration().replace('"strategy": "managed"', '"strategy": "workflow"'),
	}, 'Delegate preparation to a workflow');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('main: select a preparation workflow for the configured workflow strategy.');
});

test('adoption leaves custom checkout refs for explicit integration', async () => {
	const repository = widget(world.github, { configured: false });
	const workflow = publishWorkflow.replace(
		'    steps:\n',
		`    steps:
      - uses: actions/checkout@v7
        with:
          ref: another-branch
`,
	);
	world.github.push(repository, { '.github/workflows/publish.yml': workflow }, 'Use an explicit checkout ref');
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toContain('publish.yml: checkout the execution sourceSha after begin');
	expect(plan.edits.find(edit => edit.path === '.github/workflows/publish.yml')).toBeUndefined();
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(422);
	expect(repository.pulls).toHaveLength(0);
});

test('configuration-only adoption does not request workflow write permission', async () => {
	const repository = widget(world.github, { configured: false });
	const workflow = publishWorkflow.replace(
		'    steps:\n',
		`    steps:
      - uses: actions/checkout@v7
`,
	).replace(
		'      - run: npm publish',
		`      - uses: actions/checkout@v7
        with:
          ref: \${{ fromJSON(steps.release.outputs.context).sourceSha }}
      - run: npm publish`,
	);
	world.github.push(repository, { '.github/workflows/publish.yml': workflow }, 'Complete the integration');
	world.network.serve('api.github.com', async request => {
		if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/access_tokens')) {
			const body = z.object({ permissions: z.record(z.string(), z.string()) }).parse(await request.clone().json());
			if (body.permissions.workflows === 'write') {
				return Response.json({ message: 'The permissions requested are not granted to this installation' }, {
					status: 422,
				});
			}
		}
		return world.github.handle(request);
	});
	const api = bearer(world, await world.cliSession());
	const preview = await api('/api/repositories/setup/preview', { repository: repository.name });
	const plan = await Effect.runPromise(parseSetupPlan(preview.body));
	expect(plan.blockers).toEqual([]);
	expect(plan.edits.map(edit => edit.path)).toEqual(['.github/beepboop.json']);
	const applied = await api('/api/repositories/setup/apply', {
		repository: repository.name,
		choices: plan.choices,
		planId: plan.planId,
		sourceSha: plan.sourceSha,
		setupHead: plan.setupHead,
	});
	expect(applied.status).toBe(200);
	expect(repository.pulls).toHaveLength(1);
});

for (const inherited of [false, true]) {
	test(`separating workflows removes only the generated phase input (inherited=${inherited})`, async () => {
		const repository = widget(world.github, { configured: false });
		const policy = {
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					packages: ['pkg:npm/widget'],
					required: ['pkg:npm/widget'],
					prepare: {
						workflow: {
							file: 'release.yml',
							inputs: { beepboop_operation: 'prepare', channel: 'stable', dryRun: false },
						},
					},
					promote: {
						workflow: { file: 'release.yml', inputs: { beepboop_operation: 'publish', channel: 'stable', retries: 0 } },
					},
				},
			},
		};
		if (inherited) world.github.create('octo/presets', { 'release.json': JSON.stringify(policy) });
		world.github.push(repository, {
			'.github/beepboop.json': JSON.stringify(inherited ? { extends: ['github>octo/presets:release'] } : policy),
		}, 'Configure shared workflow inputs');
		const api = bearer(world, await world.cliSession());
		const choices = {
			streams: [{
				name: 'main',
				packages: ['pkg:npm/widget'],
				required: ['pkg:npm/widget'],
				versioning: 'workspace',
				prepare: { file: 'prepare-release.yml', job: 'prepare', commands: 'npm install' },
				promote: { file: 'publish-release.yml', job: 'publish', commands: 'npm publish' },
			}],
		};
		const preview = await api('/api/repositories/setup/preview', { repository: repository.name, choices });
		const plan = await Effect.runPromise(parseSetupPlan(preview.body));
		expect(plan.blockers).toEqual([]);
		const binding = z.object({ file: z.string(), inputs: z.record(z.string(), z.unknown()) });
		const configuration = z.object({
			streams: z.object({
				main: z.object({
					prepare: z.object({ workflow: binding }),
					promote: z.object({ workflow: binding }),
				}),
			}),
		});
		const proposed = configuration.parse(
			JSON.parse(plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? '{}'),
		);
		expect(proposed.streams.main.prepare.workflow.inputs).toEqual({ channel: 'stable', dryRun: false });
		expect(proposed.streams.main.promote.workflow.inputs).toEqual({ channel: 'stable', retries: 0 });
		expect(
			(await api('/api/repositories/setup/apply', {
				repository: repository.name,
				choices: plan.choices,
				planId: plan.planId,
				sourceSha: plan.sourceSha,
				setupHead: plan.setupHead,
			})).status,
		).toBe(200);
		world.github.merge(repository, 1);
		const discovered = await api('/api/repositories/discover', { repository: repository.name });
		expect(discovered.status).toBe(200);
		const resolved = configuration.parse(field(discovered.body, 'configuration'));
		expect(resolved.streams.main.prepare.workflow.inputs).toEqual({ channel: 'stable', dryRun: false });
		expect(resolved.streams.main.promote.workflow.inputs).toEqual({ channel: 'stable', retries: 0 });
	});
}

test('workflow input merging keeps shared phase inputs until the target file changes or explicitly overrides them', () => {
	const base = { file: 'release.yml', inputs: { beepboop_operation: 'prepare', retries: 0 } };
	const unchanged = mergeConfiguration(base, { file: 'release.yml', inputs: { dryRun: false } });
	if (Result.isFailure(unchanged)) throw unchanged.failure;
	expect(unchanged.success).toEqual({
		file: 'release.yml',
		inputs: { beepboop_operation: 'prepare', retries: 0, dryRun: false },
	});
	const explicit = mergeConfiguration(base, { file: 'custom.yml', inputs: { beepboop_operation: 'custom' } });
	if (Result.isFailure(explicit)) throw explicit.failure;
	expect(explicit.success).toEqual({ file: 'custom.yml', inputs: { beepboop_operation: 'custom', retries: 0 } });
	expect(base.inputs.beepboop_operation).toBe('prepare');
});
