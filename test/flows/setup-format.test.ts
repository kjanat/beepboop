import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { applyChoices, previewSetup } from '@root/test/support/setup.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Schema } from 'effect';
import { Automation } from '@/automation/service';
import { setupAutoMerge } from '@/automation/setup-pull-requests';
import { canonicalConfiguration } from '@/domain/configuration/canonical.ts';
import { legacyConfiguration } from '@/domain/configuration/names.ts';
import type { Package } from '@/domain/inventory.ts';
import { registry } from '@/domain/package-publication.ts';
import { decodeSync, looseStruct, mutableStruct } from '@/kernel/schema/structs.ts';

let world: World;
eachWorld(created => {
	world = created;
});

const configurationPath = '.github/beepboop.json';
const releaseBox = '<!-- beepboop:release-after-merge --> Release after merge';
const updateBranch = 'automation/setup-update';

async function managed(): Promise<{ repository: Repository; canonical: string }> {
	const repository = world.github.create('octo/tool', {
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
		'src/main.rs': 'fn main() {}\n',
	});
	const api = bearer(world, await world.cliSession());
	await applyChoices(api, repository.name, {
		streams: [{
			name: 'main',
			packages: ['pkg:cargo/tool'],
			required: ['pkg:cargo/tool'],
			versioning: 'workspace',
			promote: {
				file: 'release.yml',
				job: 'publish',
				triggers: 'review',
				commands: 'beepboop publish',
				publicationSteps: {},
			},
		}],
		actionsRevision: 'v1',
	});
	world.github.merge(repository, 1);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	return { repository, canonical: world.github.file(repository, configurationPath) ?? '' };
}
function rewrite(repository: Repository, change: (configuration: Record<string, unknown>) => unknown): void {
	const current = decodeSync(looseStruct({}), JSON.parse(world.github.file(repository, configurationPath) ?? '{}'));
	world.github.push(
		repository,
		{ [configurationPath]: `${JSON.stringify(change(current), null, '\t')}\n` },
		'Configuration in an older format',
	);
}
const tick = () => world.run(Automation.use(service => service.scheduled));
const setupPulls = (repository: Repository) => repository.pulls.filter(pull => pull.head.ref === updateBranch);

test('a deprecated-key configuration gets one setup PR with the canonical file and squash auto-merge', async () => {
	const { repository, canonical } = await managed();
	repository.allowAutoMerge = true;
	rewrite(repository, legacyConfiguration);
	expect(world.github.file(repository, configurationPath)).toContain('"required"');
	await tick();
	await tick();
	const pulls = setupPulls(repository);
	expect(pulls.map(pull => [pull.state, pull.autoMerge, pull.comments])).toEqual([
		['open', 'SQUASH', [setupAutoMerge.enabled('squash')]],
	]);
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
});

const fileShape = looseStruct({
	extends: Schema.optional(Schema.Array(Schema.String)),
	streams: looseStruct({ main: looseStruct({ versionScope: Schema.optional(Schema.String) }) }),
});
const resolvedShape = looseStruct({
	configuration: looseStruct({ streams: looseStruct({ main: looseStruct({ versioning: Schema.String }) }) }),
});

test('a fresh setup extends beepboop:default and leaves out the values the preset carries', async () => {
	const { repository, canonical } = await managed();
	const written = decodeSync(fileShape, JSON.parse(canonical));
	expect([written.extends, written.streams.main.versionScope]).toEqual([['beepboop:default'], undefined]);
	const api = bearer(world, await world.cliSession());
	const discovered = await api('/api/repositories/discover', { repository: repository.name });
	expect(decodeSync(resolvedShape, discovered.body).configuration.streams.main.versioning).toBe('workspace');
});

test('a configuration without extends that states every value gets no format PR and no extends', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	rewrite(repository, configuration => {
		const { extends: _extends, ...rest } = configuration;
		const streams = decodeSync(looseStruct({ main: looseStruct({}) }), rest.streams);
		return { ...rest, streams: { ...streams, main: { ...streams.main, versionScope: 'one-for-stream' } } };
	});
	const stated = world.github.file(repository, configurationPath) ?? '';
	await tick();
	await tick();
	expect(setupPulls(repository)).toEqual([]);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const plan = await previewSetup(api, repository.name);
	const after = decodeSync(
		fileShape,
		JSON.parse(plan.edits.find(edit => edit.path === configurationPath)?.after ?? stated),
	);
	expect([after.extends, after.streams.main.versionScope]).toEqual([undefined, 'one-for-stream']);
});

const discoveredShape = looseStruct({
	configuration: Schema.optional(looseStruct({ streams: looseStruct({}) })),
	findings: Schema.Array(looseStruct({ code: Schema.String })),
});

test('a repository without the configuration file releases when its workflows run the Beepboop actions', async () => {
	const { repository } = await managed();
	world.github.push(repository, { [configurationPath]: null }, 'Drop the configuration file');
	const api = bearer(world, await world.cliSession());
	const discovered = decodeSync(
		discoveredShape,
		(await api('/api/repositories/discover', { repository: repository.name })).body,
	);
	expect(Object.keys(discovered.configuration?.streams ?? {})).toEqual(['main']);
	expect(discovered.findings.map(entry => entry.code)).not.toContain('unconfigured');
	const planned = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.0.1' });
	expect(planned.status).toBe(200);
});

test('a repository without the configuration file stays unconfigured while setup would rewrite its workflow', async () => {
	const { repository } = await managed();
	const workflow = world.github.file(repository, '.github/workflows/release.yml') ?? '';
	world.github.push(repository, {
		[configurationPath]: null,
		'.github/workflows/release.yml': workflow.replace('    timeout-minutes: 90\n', ''),
	}, 'Drop the configuration file');
	const api = bearer(world, await world.cliSession());
	const discovered = decodeSync(
		discoveredShape,
		(await api('/api/repositories/discover', { repository: repository.name })).body,
	);
	expect(discovered.configuration).toBeUndefined();
	expect(discovered.findings.map(entry => entry.code)).toContain('unconfigured');
});

test('a repository without the configuration file stays unconfigured when no workflow runs the Beepboop actions', async () => {
	const repository = world.github.create('octo/tool', {
		'Cargo.toml': '[package]\nname = "tool"\nversion = "1.0.0"\nedition = "2024"\n',
		'src/main.rs': 'fn main() {}\n',
		'.github/workflows/ci.yml':
			'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: cargo test\n',
	});
	const api = bearer(world, await world.cliSession());
	const discovered = decodeSync(
		discoveredShape,
		(await api('/api/repositories/discover', { repository: repository.name })).body,
	);
	expect(discovered.configuration).toBeUndefined();
	expect(discovered.findings.map(entry => entry.code)).toContain('unconfigured');
});

test('auto-merge uses a merge method the repository allows', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	repository.mergeMethods = { squash: false, merge: true, rebase: true };
	rewrite(repository, legacyConfiguration);
	await tick();
	expect(setupPulls(repository).map(pull => [pull.autoMerge, pull.comments])).toEqual([
		['MERGE', [setupAutoMerge.enabled('merge')]],
	]);
});

test('a repository without auto-merge gets the setup PR and a note to merge it', async () => {
	const { repository, canonical } = await managed();
	rewrite(repository, legacyConfiguration);
	await tick();
	expect(setupPulls(repository).map(pull => [pull.state, pull.autoMerge, pull.comments])).toEqual([
		['open', undefined, [setupAutoMerge.disallowed]],
	]);
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
});

test('a canonical configuration gets no setup PR', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	await tick();
	expect(setupPulls(repository)).toEqual([]);
});

test('a closed format PR is not reopened on the next cron tick', async () => {
	const { repository } = await managed();
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	if (!pull) throw new Error('Missing format PR');
	pull.state = 'closed';
	repository.refs.delete(`heads/${updateBranch}`);
	await tick();
	expect(setupPulls(repository).map(entry => entry.state)).toEqual(['closed']);
});

test('a format PR that also regenerates a workflow leaves auto-merge off', async () => {
	const { repository, canonical } = await managed();
	repository.allowAutoMerge = true;
	const workflow = world.github.file(repository, '.github/workflows/release.yml') ?? '';
	world.github.push(
		repository,
		{ '.github/workflows/release.yml': workflow.replace('    timeout-minutes: 90\n', '') },
		'Workflow from an older generator',
	);
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	expect([pull?.autoMerge, pull?.comments]).toEqual([undefined, [setupAutoMerge.workflows]]);
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
	expect(world.github.file(repository, '.github/workflows/release.yml', updateBranch)).toBe(workflow);
});

const revised = looseStruct({ actionsRevision: Schema.optional(Schema.String) });
test('a format PR that restores declined setup input leaves auto-merge off', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	rewrite(repository, configuration => {
		const parsed = decodeSync(revised, configuration);
		delete parsed.actionsRevision;
		return parsed;
	});
	await tick();
	const [declined] = setupPulls(repository);
	if (!declined) throw new Error('Missing actions revision PR');
	declined.state = 'closed';
	repository.refs.delete(`heads/${updateBranch}`);
	rewrite(repository, legacyConfiguration);
	await tick();
	const pulls = setupPulls(repository);
	expect(pulls.map(pull => [pull.state, pull.autoMerge])).toEqual([['closed', undefined], ['open', undefined]]);
	expect(pulls[1]?.comments).toEqual([setupAutoMerge.settings]);
});

test('a format PR refreshed with workflow edits turns its auto-merge off', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	rewrite(repository, legacyConfiguration);
	await tick();
	const workflow = world.github.file(repository, '.github/workflows/release.yml') ?? '';
	world.github.push(
		repository,
		{ '.github/workflows/release.yml': workflow.replace('    timeout-minutes: 90\n', '') },
		'Workflow from an older generator',
	);
	await tick();
	const [pull] = setupPulls(repository);
	expect([pull?.state, pull?.autoMerge, pull?.comments]).toEqual([
		'open',
		undefined,
		[setupAutoMerge.enabled('squash'), setupAutoMerge.revoked],
	]);
	expect(world.github.file(repository, '.github/workflows/release.yml', updateBranch)).toBe(workflow);
});

test('a format PR keeps its edits when GitHub refuses to turn auto-merge off', async () => {
	const { repository, canonical } = await managed();
	repository.allowAutoMerge = true;
	rewrite(repository, legacyConfiguration);
	await tick();
	world.network.serve('api.github.com', async request => {
		const body = request.method === 'POST' ? await request.clone().text() : '';
		return new URL(request.url).pathname === '/graphql' && body.includes('disablePullRequestAutoMerge')
			? Response.json({ data: null, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] })
			: world.github.handle(request);
	});
	const workflow = world.github.file(repository, '.github/workflows/release.yml') ?? '';
	world.github.push(
		repository,
		{ '.github/workflows/release.yml': workflow.replace('    timeout-minutes: 90\n', '') },
		'Workflow from an older generator',
	);
	await tick();
	const [pull] = setupPulls(repository);
	expect([pull?.autoMerge, pull?.comments]).toEqual(['SQUASH', [setupAutoMerge.enabled('squash')]]);
	expect(pull?.body).toContain('Automatic update stopped: Auto-merge stays on');
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
	expect(world.github.file(repository, '.github/workflows/release.yml', updateBranch)).toBe(workflow);
});

test('a refreshed format PR that is closed is not reopened', async () => {
	const { repository } = await managed();
	rewrite(repository, legacyConfiguration);
	await tick();
	rewrite(repository, configuration => {
		const parsed = decodeSync(streamStarts, configuration);
		return { ...configuration, streams: { main: { ...parsed.streams.main, startFrom: [{ via: 'dashboard' }] } } };
	});
	await tick();
	const [pull] = setupPulls(repository);
	if (!pull) throw new Error('Missing format PR');
	pull.state = 'closed';
	repository.refs.delete(`heads/${updateBranch}`);
	await tick();
	expect(setupPulls(repository).map(entry => entry.state)).toEqual(['closed']);
});

async function handConfigured(): Promise<{ repository: Repository; canonical: string }> {
	const configured = await managed();
	await world.db.prepare('DELETE FROM onboarding WHERE repository_id=?').bind(configured.repository.id).run();
	return configured;
}
const savedDocument = looseStruct({
	choices: Schema.optional(Schema.Unknown),
	formatOnly: Schema.optional(Schema.Boolean),
});
async function onboarding(repository: Repository) {
	const row = decodeSync(
		mutableStruct({ document: Schema.String }),
		await world.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(repository.id).first(),
	);
	return decodeSync(savedDocument, JSON.parse(row.document));
}
test('an outdated configuration without saved choices gets one format PR with auto-merge', async () => {
	const { repository, canonical } = await handConfigured();
	repository.allowAutoMerge = true;
	const workflow = world.github.file(repository, '.github/workflows/release.yml');
	rewrite(repository, legacyConfiguration);
	await tick();
	await tick();
	const pulls = setupPulls(repository);
	expect(pulls.map(pull => [pull.state, pull.autoMerge, pull.comments])).toEqual([
		['open', 'SQUASH', [setupAutoMerge.enabled('squash')]],
	]);
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
	expect(world.github.file(repository, '.github/workflows/release.yml', updateBranch)).toBe(workflow);
	const saved = await onboarding(repository);
	expect([saved.choices, saved.formatOnly]).toEqual([undefined, true]);
});

test('an onboarding record without choices gets a format PR', async () => {
	const { repository, canonical } = await managed();
	repository.allowAutoMerge = true;
	await world.db.prepare('UPDATE onboarding SET document=? WHERE repository_id=?').bind(
		JSON.stringify({ url: `https://github.com/${repository.name}/pull/1`, content: canonical }),
		repository.id,
	).run();
	rewrite(repository, legacyConfiguration);
	await tick();
	expect(setupPulls(repository).map(pull => [pull.state, pull.autoMerge])).toEqual([['open', 'SQUASH']]);
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
});

test('a canonical configuration without saved choices gets no setup PR', async () => {
	const { repository } = await handConfigured();
	repository.allowAutoMerge = true;
	await tick();
	expect(setupPulls(repository)).toEqual([]);
});

test('a closed format PR without saved choices is not reopened', async () => {
	const { repository } = await handConfigured();
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	if (!pull) throw new Error('Missing format PR');
	pull.state = 'closed';
	repository.refs.delete(`heads/${updateBranch}`);
	await tick();
	expect(setupPulls(repository).map(entry => entry.state)).toEqual(['closed']);
});

test('an open setup PR without an onboarding record gets no second PR', async () => {
	const { repository } = await handConfigured();
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	if (!pull) throw new Error('Missing format PR');
	await world.db.prepare('DELETE FROM onboarding WHERE repository_id=?').bind(repository.id).run();
	await tick();
	expect(setupPulls(repository).map(entry => [entry.number, entry.head.sha])).toEqual([
		[pull.number, pull.head.sha],
	]);
	const failed = await world.db.prepare("SELECT action FROM audit WHERE action='repository.setup.failed'").all();
	expect(failed.results).toEqual([]);
});

test('an unparsable configuration without saved choices gets no setup PR and no failure', async () => {
	const { repository } = await handConfigured();
	world.github.push(repository, { [configurationPath]: '{ "streams": ' }, 'Broken configuration');
	await tick();
	expect(setupPulls(repository)).toEqual([]);
	const failed = await world.db.prepare("SELECT action FROM audit WHERE action='repository.setup.failed'").all();
	expect(failed.results).toEqual([]);
});

test('an open format PR without saved choices follows a later change to the file', async () => {
	const { repository } = await handConfigured();
	repository.allowAutoMerge = true;
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	if (!pull) throw new Error('Missing format PR');
	expect(pull.body).toContain(`- [ ] ${releaseBox}`);
	pull.body = pull.body.replace(`- [ ] ${releaseBox}`, `- [x] ${releaseBox}`);
	rewrite(repository, configuration => {
		const parsed = decodeSync(streamStarts, configuration);
		return { ...configuration, streams: { main: { ...parsed.streams.main, startFrom: [{ via: 'dashboard' }] } } };
	});
	await tick();
	expect(setupPulls(repository).map(entry => [entry.state, entry.autoMerge])).toEqual([['open', 'SQUASH']]);
	expect(pull.body).toContain(`- [x] ${releaseBox}`);
	const proposed = world.github.file(repository, configurationPath, updateBranch) ?? '{}';
	expect(decodeSync(streamStarts, JSON.parse(proposed)).streams.main.startFrom).toEqual([]);
	expect(proposed).not.toContain('"versioning"');
});

test('a format PR for a repository with saved choices carries the setup proposal', async () => {
	const { repository } = await managed();
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	expect(pull?.body).toContain('<!-- beepboop:choice:');
	const saved = await onboarding(repository);
	expect(saved.formatOnly).toBeUndefined();
	expect(saved.choices).toBeDefined();
});

function rateLimitAutoMerge(times: number): void {
	let left = times;
	world.network.serve('api.github.com', async request => {
		const body = request.method === 'POST' ? await request.clone().text() : '';
		if (left > 0 && new URL(request.url).pathname === '/graphql' && body.includes('enablePullRequestAutoMerge')) {
			left--;
			return Response.json({
				data: { enablePullRequestAutoMerge: null },
				errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded for installation ID 1.' }],
			});
		}
		return world.github.handle(request);
	});
}
test('a rate-limited auto-merge request is retried', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	rateLimitAutoMerge(1);
	rewrite(repository, legacyConfiguration);
	await tick();
	expect(setupPulls(repository).map(pull => [pull.autoMerge, pull.comments])).toEqual([
		['SQUASH', [setupAutoMerge.enabled('squash')]],
	]);
});

test('an auto-merge request that keeps failing leaves the format PR recorded', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	rateLimitAutoMerge(Number.POSITIVE_INFINITY);
	rewrite(repository, legacyConfiguration);
	await tick();
	const [pull] = setupPulls(repository);
	if (!pull) throw new Error('Missing format PR');
	expect([pull.autoMerge, pull.comments]).toEqual([undefined, undefined]);
	pull.state = 'closed';
	repository.refs.delete(`heads/${updateBranch}`);
	await tick();
	expect(setupPulls(repository).map(entry => entry.state)).toEqual(['closed']);
	const failed = await world.db.prepare("SELECT action FROM audit WHERE action='repository.setup.failed'").all();
	expect(failed.results).toEqual([]);
});

const streamStarts = mutableStruct({
	streams: mutableStruct({ main: looseStruct({ startFrom: Schema.optional(Schema.Unknown) }) }),
});
test('the format PR drops the dashboard and cli start channels', async () => {
	const { repository } = await managed();
	repository.allowAutoMerge = true;
	rewrite(repository, configuration => {
		const parsed = decodeSync(streamStarts, configuration);
		return {
			...configuration,
			streams: { main: { ...parsed.streams.main, startFrom: [{ via: 'dashboard' }, { via: 'cli' }] } },
		};
	});
	await tick();
	const [pull] = setupPulls(repository);
	expect(pull?.autoMerge).toBe('SQUASH');
	const proposed = decodeSync(
		streamStarts,
		JSON.parse(world.github.file(repository, configurationPath, updateBranch) ?? '{}'),
	);
	expect(proposed.streams.main.startFrom).toEqual([]);
});

function crate(name: string): Package {
	return {
		manager: 'cargo',
		name,
		version: '1.0.0',
		manifest: 'Cargo.toml',
		versionSource: 'Cargo.toml',
		publication: registry,
		dependencies: [],
	};
}
test('canonical configuration rewrites manager:name references of discovered packages to package URLs', () => {
	const binding = (publications: string[]) => ({ file: 'release.yml', publications });
	const configuration = {
		streams: {
			main: {
				packages: ['cargo:tool', 'pkg:cargo/lib', 'npm:unknown'],
				required: ['cargo:tool'],
				packageTags: ['cargo:tool'],
				companionModules: ['cargo:lib'],
				needs: { 'cargo:tool': ['cargo:lib'] },
				promote: { workflow: binding(['cargo:tool', 'github-release:octo/tool']) },
				workflows: { docs: binding(['cargo:lib']) },
			},
		},
	};
	const packages = [crate('tool'), crate('lib'), { ...crate('octo/tool'), manager: 'github-release' as const }];
	expect(canonicalConfiguration(configuration, packages)).toEqual({
		streams: {
			main: {
				packages: ['pkg:cargo/tool', 'pkg:cargo/lib', 'npm:unknown'],
				mustPublish: ['pkg:cargo/tool'],
				packageTags: ['pkg:cargo/tool'],
				companionModules: ['pkg:cargo/lib'],
				needs: { 'pkg:cargo/tool': ['pkg:cargo/lib'] },
				promote: { workflow: binding(['pkg:cargo/tool', 'github-release:octo/tool']) },
				workflows: { docs: binding(['pkg:cargo/lib']) },
			},
		},
	});
});
