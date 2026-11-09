import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { applyChoices, previewSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { z } from 'zod';
import type { SetupChoices } from '@/automation/setup-types';
import { binaries, workflowSetup } from '@/contract/setup';

let world: World;
eachWorld(created => {
	world = created;
});

function toolRepository(): Repository {
	return world.github.create('octo/tool', {
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
		'src/main.rs': 'fn main() {}\n',
	});
}
function toolChoices(targets: z.input<typeof binaries>['targets'] = ['linux-amd64', 'darwin-arm64']): SetupChoices {
	return {
		streams: [{
			name: 'main',
			packages: [],
			required: [],
			versioning: 'workspace',
			versionSource: { kind: 'tags', prefix: 'v' },
			promote: {
				file: 'release.yml',
				job: 'publish',
				triggers: 'review',
				commands: '',
				publicationSteps: {},
				binaries: binaries.parse({
					builds: [{ toolchain: 'cargo', name: 'tool', manifest: 'Cargo.toml' }],
					targets,
				}),
			},
		}],
		actionsRevision: 'v1',
	};
}
const stored = z.object({
	actionsRevision: z.string().optional(),
	streams: z.object({ main: z.object({ promote: z.object({ workflow: z.looseObject({ setup: workflowSetup }) }) }) }),
});
function configuration(repository: Repository, ref?: string) {
	return stored.parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', ref) ?? '{}'));
}

test('the setup PR writes each workflow setup input into its binding in beepboop.json', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, toolChoices());
	const proposed = configuration(repository, 'automation/onboarding');
	expect(proposed.actionsRevision).toBe('v1');
	expect(proposed.streams.main.promote.workflow.setup).toEqual(workflowSetup.parse({
		job: 'publish',
		binaries: {
			builds: [{ toolchain: 'cargo', name: 'tool', manifest: 'Cargo.toml' }],
			targets: toolChoices().streams[0]?.promote?.binaries?.targets,
		},
	}));
});

test('setup reads its choices back from the default branch and proposes no change', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, toolChoices());
	world.github.merge(repository, 1);
	const plan = await previewSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	expect(plan.edits).toEqual([]);
	expect(plan.choices.actionsRevision).toBe('v1');
	expect(plan.choices.streams[0]?.promote?.binaries).toEqual(toolChoices().streams[0]?.promote?.binaries);
});

test('an edit of the setup input on the default branch regenerates the workflow', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, toolChoices());
	world.github.merge(repository, 1);
	const source = world.github.file(repository, '.github/beepboop.json') ?? '';
	world.github.push(
		repository,
		{ '.github/beepboop.json': source.replace('"darwin-arm64"', '"windows-amd64"') },
		'Build for Windows instead of macOS',
	);
	const plan = await previewSetup(api, repository.name);
	expect(plan.blockers).toEqual([]);
	expect(plan.edits.map(edit => edit.path)).toEqual(['.github/workflows/release.yml']);
	expect(plan.edits[0]?.after).toContain('x86_64-pc-windows-msvc');
	expect(plan.edits[0]?.after).not.toContain('aarch64-apple-darwin');
});

test('a repository whose stored choices are not in beepboop.json gets one setup update PR that moves them', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, toolChoices());
	world.github.merge(repository, 1);
	const current = z.looseObject({
		actionsRevision: z.string().optional(),
		streams: z.object({
			main: z.looseObject({
				promote: z.looseObject({ workflow: z.looseObject({ setup: z.unknown().optional() }) }),
			}),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}'));
	delete current.actionsRevision;
	delete current.streams.main.promote.workflow.setup;
	world.github.push(
		repository,
		{ '.github/beepboop.json': `${JSON.stringify(current, null, '\t')}\n` },
		'Configuration from before repository-held setup',
	);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	const update = repository.pulls.filter(pull => pull.state === 'open');
	expect(update.map(pull => [pull.head.ref, pull.title])).toEqual([
		['automation/setup-update', 'chore: update release setup (release configuration)'],
	]);
	const migrated = configuration(repository, 'automation/setup-update');
	expect(migrated.actionsRevision).toBe('v1');
	expect(migrated.streams.main.promote.workflow.setup.binaries).toEqual(toolChoices().streams[0]?.promote?.binaries);
	expect(world.github.file(repository, '.github/workflows/release.yml', 'automation/setup-update')).toBe(
		world.github.file(repository, '.github/workflows/release.yml'),
	);

	const [pull] = update;
	if (!pull) throw new Error('Missing update PR');
	pull.state = 'closed';
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	expect(repository.pulls.filter(entry => entry.state === 'open')).toEqual([]);
});
