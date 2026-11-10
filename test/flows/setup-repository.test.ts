import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { applyChoices, editPull, previewSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { parse } from 'yaml';
import { z } from 'zod';
import type { SetupChoices } from '@/automation/setup-types';
import { binaries, binaryTargets, workflowSetup } from '@/contract/setup';

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
		['automation/setup-update', 'chore: update release setup'],
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

function engineRepository(): Repository {
	return world.github.create('octo/engine', {
		'Cargo.toml':
			'[workspace]\nmembers = ["crates/*"]\n\n[workspace.dependencies]\nengine = { path = "crates/engine", version = "1.0.0" }\nuzers = "0.12"\nrustix = { version = "1", features = ["fs", "process"] }\n',
		'crates/engine/Cargo.toml':
			'[package]\nname = "engine"\nversion = "1.0.0"\nedition = "2024"\n\n[dependencies]\nuzers.workspace = true\nrustix.workspace = true\n',
		'crates/engine/src/lib.rs': '',
		'crates/cli/Cargo.toml':
			'[package]\nname = "engine-cli"\nversion = "1.0.0"\nedition = "2024"\n\n[[bin]]\nname = "engine"\npath = "src/main.rs"\n\n[dependencies]\nengine.workspace = true\n',
		'crates/cli/src/main.rs': 'fn main() {}\n',
	});
}
const engineChoices: SetupChoices = {
	streams: [{
		name: 'main',
		packages: ['pkg:cargo/engine', 'pkg:cargo/engine-cli'],
		required: ['pkg:cargo/engine', 'pkg:cargo/engine-cli'],
		versioning: 'workspace',
		promote: {
			file: 'release.yml',
			job: 'publish',
			triggers: 'review',
			commands: 'beepboop publish',
			publicationSteps: {},
		},
	}],
};
const unixTargets = binaryTargets.filter(target => !target.startsWith('windows-'));

test('the migration PR proposes each Cargo binary with the targets its dependencies build for', async () => {
	const repository = engineRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, engineChoices);
	world.github.merge(repository, 1);
	const source = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	const legacy = JSON.stringify(source, (key, value) => key === 'setup' ? undefined : value, '\t');
	world.github.push(repository, { '.github/beepboop.json': `${legacy}\n` }, 'Configuration from before setup input');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	const [pull] = repository.pulls.filter(entry => entry.state === 'open');
	if (!pull) throw new Error('Missing migration PR');
	expect(pull.body).toContain(
		'  - Release binaries\n    - [x] <!-- beepboop:choice:binary:main:engine --> `engine` (Cargo, `crates/cli/Cargo.toml`)\n  - Binary targets\n',
	);
	for (const target of unixTargets) {
		expect(pull.body).toContain(`- [x] <!-- beepboop:choice:target:main:${target.replace('-', '%2D')} -->`);
	}
	expect(pull.body).toContain('- [ ] <!-- beepboop:choice:target:main:windows%2Damd64 --> windows-amd64');
	expect(pull.body).toContain(
		'engine leaves out Windows: engine-cli depends on uzers and rustix (fs, process), which build only for Unix.',
	);
	expect(pull.body).toContain('- [ ] <!-- beepboop:release-after-merge --> Release after merge');
	expect(configuration(repository, 'automation/setup-update').streams.main.promote.workflow.setup.binaries).toEqual({
		builds: [{
			toolchain: 'cargo',
			name: 'engine',
			manifest: 'crates/cli/Cargo.toml',
			asset: '{name}-{rust.target}{ext}',
		}],
		targets: unixTargets,
	});
	const workflow = world.github.file(repository, '.github/workflows/release.yml', 'automation/setup-update') ?? '';
	expect(workflow).toContain('build-engine:');
	expect(workflow).not.toContain('windows');

	await editPull(
		world,
		repository,
		pull,
		pull.body.replace(
			'- [x] <!-- beepboop:choice:binary:main:engine -->',
			'- [ ] <!-- beepboop:choice:binary:main:engine -->',
		),
	);
	await world.wait(16_000);
	expect(pull.body).toContain('- [ ] <!-- beepboop:choice:binary:main:engine -->');
	expect(configuration(repository, 'automation/setup-update').streams.main.promote.workflow.setup.binaries)
		.toBeUndefined();
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	expect(pull.body).toContain('- [ ] <!-- beepboop:choice:binary:main:engine -->');
});

const sharedJobs = z.object({
	jobs: z.record(
		z.string(),
		z.looseObject({
			if: z.string().optional(),
			needs: z.array(z.string()).optional(),
			steps: z.array(z.looseObject({ id: z.string().optional(), uses: z.string().optional() })),
		}),
	),
});
function sharedChoices(withBinaries: boolean): SetupChoices {
	const [stream] = engineChoices.streams;
	if (!stream?.promote) throw new Error('Missing engine stream');
	return {
		streams: [{
			...stream,
			prepare: {
				file: 'release.yml',
				job: 'prepare',
				triggers: 'review',
				commands: 'cargo test',
				publicationSteps: {},
			},
			promote: {
				...stream.promote,
				tagPrefix: 'v',
				...(withBinaries
					? {
						binaries: binaries.parse({
							builds: [{ toolchain: 'cargo', name: 'engine', manifest: 'crates/cli/Cargo.toml' }],
							targets: unixTargets,
						}),
					}
					: {}),
			},
		}],
	};
}

test('a shared release workflow gates its binary jobs, uploads before the tag and drops them when unticked', async () => {
	const repository = engineRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, sharedChoices(true));
	world.github.merge(repository, 1);
	const source = world.github.file(repository, '.github/workflows/release.yml') ?? '';
	const { jobs } = sharedJobs.parse(parse(source));
	const publish = "${{ inputs.beepboop_operation == 'publish' }}";
	expect([jobs.begin?.if, jobs['build-engine']?.if, jobs.publish?.if]).toEqual([publish, publish, publish]);
	expect(jobs.prepare?.if).toBe("${{ inputs.beepboop_operation == 'prepare' }}");
	const order = (jobs.publish?.steps ?? []).map(step => step.id ?? step.uses ?? '');
	const index = (name: string) => order.findIndex(entry => entry.includes(name));
	expect(index('beepboop_publish')).toBeLessThan(index('beepboop_binaries'));
	expect(index('beepboop_binaries')).toBeLessThan(index('beepboop_token'));
	expect(index('beepboop_token')).toBeLessThan(index('publish-release'));
	expect((await previewSetup(api, repository.name)).edits).toEqual([]);

	const unticked = await previewSetup(api, repository.name, sharedChoices(false));
	expect(unticked.blockers).toEqual([]);
	const regenerated = unticked.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	const remaining = sharedJobs.parse(parse(regenerated)).jobs;
	expect(Object.keys(remaining).sort()).toEqual(['prepare', 'publish']);
	expect(remaining.publish?.needs).toBeUndefined();
	expect(remaining.publish?.steps.some(step => step.id === 'beepboop_binaries')).toBe(false);
});

test('binaries added to an existing shared ledger workflow upload after the crates and before the tag', async () => {
	const repository = engineRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, sharedChoices(false));
	world.github.merge(repository, 1);
	const plan = await previewSetup(api, repository.name, sharedChoices(true));
	expect(plan.blockers).toEqual([]);
	const after = plan.edits.find(edit => edit.path === '.github/workflows/release.yml')?.after ?? '';
	const { jobs } = sharedJobs.parse(parse(after));
	const publish = "${{ inputs.beepboop_operation == 'publish' }}";
	expect([jobs.begin?.if, jobs['build-engine']?.if]).toEqual([publish, publish]);
	expect(jobs.publish?.needs).toEqual(['build-engine']);
	const order = (jobs.publish?.steps ?? []).map(step => step.id ?? step.uses ?? '');
	const index = (name: string) => order.findIndex(entry => entry.includes(name));
	expect(index('download-artifact')).toBeGreaterThan(index('beepboop_publish'));
	expect(index('beepboop_binaries')).toBeLessThan(index('beepboop_token'));
	expect(index('beepboop_token')).toBeLessThan(index('publish-release'));
});

const releaseMode = z.object({
	streams: z.object({
		main: z.object({
			prepare: z.looseObject({ bump: z.string().optional() }).optional(),
			promote: z.looseObject({ approval: z.string().optional() }),
			start: z.array(z.looseObject({ via: z.string() })).optional(),
		}),
	}),
});
function modeOf(repository: Repository, ref?: string) {
	const { main } = releaseMode.parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', ref) ?? '{}'))
		.streams;
	return { approval: main.promote.approval, bump: main.prepare?.bump, start: main.start };
}
function crateChoices(mode: Partial<SetupChoices['streams'][number]> = {}): SetupChoices {
	return {
		streams: [{
			name: 'main',
			packages: ['pkg:cargo/tool'],
			required: ['pkg:cargo/tool'],
			versioning: 'workspace',
			promote: {
				file: 'release.yml',
				job: 'publish',
				triggers: 'review',
				commands: "cargo publish --package 'tool' --locked",
				publicationSteps: {},
			},
			...mode,
		}],
	};
}
const tick = (body: string, id: string) =>
	body.replace(`- [ ] <!-- beepboop:choice:${id} -->`, `- [x] <!-- beepboop:choice:${id} -->`);

test('a fresh setup ticks no approval, start or bump and writes none of them', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	const plan = await applyChoices(api, repository.name, crateChoices());
	expect(plan.blockers).toEqual([]);
	expect(plan.choices.streams[0]).not.toHaveProperty('approval');
	expect(plan.choices.streams[0]).not.toHaveProperty('start');
	expect(plan.choices.streams[0]).not.toHaveProperty('bump');
	expect(modeOf(repository, 'automation/onboarding')).toEqual({
		approval: undefined,
		bump: undefined,
		start: undefined,
	});
	expect(world.github.file(repository, '.github/workflows/start-release.yml', 'automation/onboarding')).toBeUndefined();
	const body = repository.pulls[0]?.body ?? '';
	for (
		const id of ['start:main:action', 'start:main:dashboard', 'start:main:cli', 'bump:main:commit', 'bump:main:pr']
	) {
		expect(body).toContain(`- [ ] <!-- beepboop:choice:${id} -->`);
	}
	for (const value of ['required', 'merge', 'push']) {
		expect(body).toContain(`- [ ] <!-- beepboop:choice:approval:main:${value} -->`);
	}
	expect(body).toContain(
		'- main: tick when a version raised without a start publishes. Until you do, Beepboop waits for your approval.',
	);
	expect(body).toContain(
		'- main: tick how a version bump reaches the default branch. Until you do, Beepboop opens a version PR.',
	);
	expect(body).not.toContain('Set up registry access');
	expect(body).not.toContain('keeps this proposal current');
	expect(body).not.toContain('The earlier setup proposal differs');
});

test('each choice ticked in the setup PR body is written as ticked, and push stays push after the merge', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, crateChoices());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('Missing setup PR');
	await editPull(
		world,
		repository,
		pull,
		['approval:main:push', 'start:main:action', 'start:main:cli', 'bump:main:commit'].reduce(tick, pull.body),
	);
	await world.wait(16_000);
	expect(modeOf(repository, 'automation/onboarding')).toEqual({
		approval: 'push',
		bump: 'commit',
		start: [{ via: 'action', workflow: 'start-release.yml' }, { via: 'cli' }],
	});
	expect(pull.body).toContain('- [x] <!-- beepboop:choice:approval:main:push -->');
	expect(pull.body).toContain('- [ ] <!-- beepboop:choice:approval:main:required -->');
	expect(pull.body).toContain('- [ ] <!-- beepboop:choice:start:main:dashboard -->');
	expect(pull.body).not.toContain('Until you do');
	const dispatch = z.object({
		on: z.object({
			workflow_dispatch: z.object({ inputs: z.record(z.string(), z.record(z.string(), z.unknown())) }),
		}),
		jobs: z.object({
			start: z.object({
				permissions: z.record(z.string(), z.string()),
				steps: z.array(z.object({ uses: z.string(), with: z.record(z.string(), z.string()) })),
			}),
		}),
	}).parse(parse(world.github.file(repository, '.github/workflows/start-release.yml', 'automation/onboarding') ?? ''));
	expect(dispatch.on.workflow_dispatch.inputs).toEqual({
		stream: { description: 'Release stream', type: 'choice', options: ['main'], default: 'main' },
		bump: { description: 'Version bump', type: 'choice', options: ['patch', 'minor', 'major'], default: 'patch' },
		version: { description: 'Semantic version; replaces the bump when set', type: 'string' },
	});
	expect(dispatch.jobs.start.permissions).toEqual({ 'id-token': 'write' });
	expect(dispatch.jobs.start.steps).toEqual([{
		uses: 'kjanat/beepboop/actions/release@v1',
		with: { stream: '${{ inputs.stream }}', version: '${{ inputs.version || inputs.bump }}' },
	}]);
	world.github.merge(repository, pull.number);
	const plan = await previewSetup(api, repository.name);
	expect(plan.edits).toEqual([]);
	expect(plan.choices.streams[0]).toMatchObject({ approval: 'push', bump: 'commit', start: ['action', 'cli'] });
});

test('unticking every start writes an empty start list, and setup reads it back without asking again', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, crateChoices({ approval: 'required', bump: 'pr', start: [] }));
	expect(modeOf(repository, 'automation/onboarding')).toEqual({ approval: 'required', bump: 'pr', start: [] });
	world.github.merge(repository, 1);
	const plan = await previewSetup(api, repository.name);
	expect(plan.edits).toEqual([]);
	expect(plan.notes.filter(note => note.includes('Until you do'))).toEqual([]);
	expect(plan.choices.streams[0]).toMatchObject({ approval: 'required', bump: 'pr', start: [] });
});

test('a maintenance rebuild keeps the approval, starts and bump the default branch configures', async () => {
	const repository = toolRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, crateChoices({ approval: 'push', bump: 'pr', start: ['dashboard'] }));
	world.github.merge(repository, 1);
	const source = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	const legacy = JSON.stringify(source, (key, value) => key === 'setup' ? undefined : value, '\t')
		.replace('"approval": "push"', '"approval": "required"');
	world.github.push(repository, { '.github/beepboop.json': `${legacy}\n` }, 'Require approval');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	const kept = { approval: 'required', bump: 'pr', start: [{ via: 'dashboard' }] };
	expect(modeOf(repository, 'automation/setup-update')).toEqual(kept);
	world.github.push(repository, { 'README.md': '# tool\n' }, 'Document the tool');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	expect(modeOf(repository, 'automation/setup-update')).toEqual(kept);
	expect(repository.pulls.find(pull => pull.state === 'open')?.body).toContain(
		'- [x] <!-- beepboop:choice:approval:main:required -->',
	);
});

test('a rebuild keeps the needs and the GitHub release publication of an observed workflow', async () => {
	const repository = world.github.create('octo/tool', {
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
		'src/main.rs': 'fn main() {}\n',
		'.github/workflows/github-release.yml':
			'name: GitHub release\non: { push: { tags: [\'v*\'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh release create "$GITHUB_REF_NAME"\n',
	});
	const api = bearer(world, await world.cliSession());
	const observed = {
		name: 'release',
		file: 'github-release.yml',
		ref: 'refs/tags/v*',
		publications: ['pkg:github/octo/tool'],
		needs: ['promote'],
	};
	const choices = crateChoices({ observe: [observed] });
	const plan = await applyChoices(api, repository.name, choices);
	const workflows = z.object({
		streams: z.object({ main: z.object({ workflows: z.record(z.string(), z.looseObject({})) }) }),
	});
	const binding = (ref?: string) =>
		workflows.parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', ref) ?? '{}')).streams.main
			.workflows.release;
	expect(binding('automation/onboarding')).toMatchObject({
		publications: ['pkg:github/octo/tool'],
		needs: ['promote'],
	});
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('Missing setup PR');
	await editPull(world, repository, pull, tick(pull.body, 'approval:main:required'));
	await world.wait(16_000);
	expect(modeOf(repository, 'automation/onboarding').approval).toBe('required');
	expect(binding('automation/onboarding')).toMatchObject({
		publications: ['pkg:github/octo/tool'],
		needs: ['promote'],
	});
	world.github.merge(repository, pull.number);
	const reread = await previewSetup(api, repository.name);
	expect(reread.edits).toEqual([]);
	expect(reread.choices.streams[0]?.observe).toEqual([observed]);
	expect(plan.choices.streams[0]?.observe).toEqual([observed]);
});

test('a setup update whose saved choices lost observed needs and publications gets them back', async () => {
	const repository = world.github.create('octo/tool', {
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
		'src/main.rs': 'fn main() {}\n',
		'.github/workflows/github-release.yml':
			'name: GitHub release\non: { push: { tags: [\'v*\'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh release create "$GITHUB_REF_NAME"\n',
	});
	const api = bearer(world, await world.cliSession());
	await applyChoices(
		api,
		repository.name,
		crateChoices({
			observe: [{
				name: 'release',
				file: 'github-release.yml',
				ref: 'refs/tags/v*',
				publications: ['pkg:github/octo/tool'],
				needs: ['promote'],
			}],
		}),
	);
	world.github.merge(repository, 1);
	const source = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	const legacy = JSON.stringify(source, (key, value) => key === 'setup' ? undefined : value, '\t');
	world.github.push(repository, { '.github/beepboop.json': `${legacy}\n` }, 'Drop setup inputs');
	const discover = async () =>
		expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await discover();
	await world.wait(16_000);
	const pull = repository.pulls.find(entry => entry.state === 'open');
	if (!pull) throw new Error('Missing setup update PR');
	const document = z.looseObject({
		choices: z.looseObject({
			streams: z.array(z.looseObject({ observe: z.array(z.looseObject({})).optional() })),
		}),
	});
	const lose = async () => {
		const row = z.object({ document: z.string() }).parse(
			await world.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(repository.id).first(),
		);
		const saved = document.parse(JSON.parse(row.document));
		saved.inferred = false;
		for (const stream of saved.choices.streams) {
			stream.observe = stream.observe?.map(({ needs: _needs, ...entry }) => ({ ...entry, publications: [] }));
		}
		await world.db.prepare('UPDATE onboarding SET document=? WHERE repository_id=?').bind(
			JSON.stringify(saved),
			repository.id,
		).run();
	};
	const workflows = z.object({
		streams: z.object({ main: z.object({ workflows: z.record(z.string(), z.looseObject({})) }) }),
	});
	const binding = () =>
		workflows.parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', pull.head.ref) ?? '{}')).streams
			.main.workflows.release;
	const kept = () => {
		expect(binding()).toMatchObject({ publications: ['pkg:github/octo/tool'], needs: ['promote'] });
		expect(pull.body).not.toContain('pkg:github/octo/tool');
		expect(pull.body).not.toContain('workflows.release.needs');
	};
	await lose();
	world.github.push(repository, { 'README.md': '# tool\n' }, 'Document the tool');
	await discover();
	await world.wait(16_000);
	kept();
	await lose();
	await editPull(world, repository, pull, tick(pull.body, 'approval:main:required'));
	await world.wait(16_000);
	expect(modeOf(repository, pull.head.ref).approval).toBe('required');
	kept();
});

test('unticking a package drops it from the observed workflow that publishes it', async () => {
	const repository = world.github.create('octo/tool', {
		'Cargo.toml': '[workspace]\nmembers = ["tool", "extra"]\n',
		'tool/Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
		'tool/src/main.rs': 'fn main() {}\n',
		'extra/Cargo.toml': '[package]\nname = "extra"\nversion = "1.0.0"\nedition = "2024"\n',
		'extra/src/lib.rs': '\n',
		'.github/workflows/github-release.yml':
			"name: GitHub release\non: { push: { tags: ['v*'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: cargo publish --package extra\n",
	});
	const api = bearer(world, await world.cliSession());
	await applyChoices(
		api,
		repository.name,
		crateChoices({
			packages: ['pkg:cargo/tool', 'pkg:cargo/extra'],
			observe: [{
				name: 'release',
				file: 'github-release.yml',
				ref: 'refs/tags/v*',
				publications: ['pkg:github/octo/tool', 'pkg:cargo/extra'],
			}],
		}),
	);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('Missing setup PR');
	const extra = '- [x] <!-- beepboop:choice:package:main:pkg%3Acargo%2Fextra -->';
	expect(pull.body).toContain(extra);
	await editPull(world, repository, pull, pull.body.replace(extra, extra.replace('[x]', '[ ]')));
	await world.wait(16_000);
	const stored = z.object({
		streams: z.object({
			main: z.object({ packages: z.array(z.string()), workflows: z.record(z.string(), z.looseObject({})) }),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', 'automation/onboarding') ?? '{}'));
	expect(stored.streams.main.packages).toEqual(['pkg:cargo/tool']);
	expect(stored.streams.main.workflows.release).toMatchObject({ publications: ['pkg:github/octo/tool'] });
});

for (const name of ['octo/tool', 'Octo/Tool']) {
	test(`setup proposes no binaries when an observed workflow already publishes the GitHub release of ${name}`, async () => {
		const repository = world.github.create(name, {
			'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
			'src/main.rs': 'fn main() {}\n',
			'.github/workflows/github-release.yml':
				'name: GitHub release\non: { push: { tags: [\'v*\'] } }\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: gh release create "$GITHUB_REF_NAME"\n',
		});
		const api = bearer(world, await world.cliSession());
		await applyChoices(
			api,
			repository.name,
			crateChoices({
				observe: [{
					name: 'release',
					file: 'github-release.yml',
					ref: 'refs/tags/v*',
					publications: [`pkg:github/${name}`],
				}],
			}),
		);
		world.github.merge(repository, 1);
		const source = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
		const legacy = (publications: string[]) =>
			`${
				JSON.stringify(
					source,
					(key, value) =>
						key === 'setup'
							? undefined
							: key === 'publications' && value[0]?.startsWith('pkg:github')
							? publications
							: value,
					'\t',
				)
			}\n`;
		world.github.push(repository, { '.github/beepboop.json': legacy([`pkg:github/${name}`]) }, 'Drop setup inputs');
		const observed = await previewSetup(api, repository.name);
		expect(observed.choices.streams[0]?.promote?.binaries).toBeUndefined();
		world.github.push(repository, { '.github/beepboop.json': legacy([]) }, 'Stop observing the GitHub release');
		const unobserved = await previewSetup(api, repository.name);
		expect(unobserved.choices.streams[0]?.promote?.binaries?.builds.map(build => build.name)).toEqual(['tool']);
	});
}

test('a ticked target that the binary is expected to fail on stays ticked with a note beside it', async () => {
	const repository = engineRepository();
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, engineChoices);
	world.github.merge(repository, 1);
	const source = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	const legacy = JSON.stringify(source, (key, value) => key === 'setup' ? undefined : value, '\t');
	world.github.push(repository, { '.github/beepboop.json': `${legacy}\n` }, 'Configuration from before setup input');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	await world.wait(16_000);
	const [pull] = repository.pulls.filter(entry => entry.state === 'open');
	if (!pull) throw new Error('Missing migration PR');
	expect(pull.title).toBe('chore: build engine release binaries');
	expect(pull.body).toContain(
		'- [ ] <!-- beepboop:choice:target:main:windows%2Damd64 --> windows-amd64 (engine expected to fail)',
	);
	expect(pull.body).toContain('engine leaves out Windows: engine-cli depends on uzers and rustix (fs, process)');
	await editPull(world, repository, pull, tick(pull.body, 'target:main:windows%2Damd64'));
	await world.wait(16_000);
	expect(pull.body).toContain(
		'- [x] <!-- beepboop:choice:target:main:windows%2Damd64 --> windows-amd64 (engine expected to fail)',
	);
	expect(pull.body).toContain(
		'- main: engine is expected to fail on windows-amd64: engine-cli depends on uzers and rustix (fs, process), which build only for Unix.',
	);
	expect(pull.body).not.toContain('engine leaves out Windows');
	const targets = z.object({
		streams: z.object({
			main: z.object({
				promote: z.object({
					workflow: z.object({ setup: z.object({ binaries: z.object({ targets: z.array(z.string()) }) }) }),
				}),
			}),
		}),
	}).parse(JSON.parse(world.github.file(repository, '.github/beepboop.json', pull.head.ref) ?? '{}'));
	expect(targets.streams.main.promote.workflow.setup.binaries.targets).toContain('windows-amd64');
});
