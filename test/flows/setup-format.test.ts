import { expect, test } from 'bun:test';
import type { Repository } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { applyChoices } from '@root/test/support/setup.ts';
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
	expect(world.github.file(repository, configurationPath)).toContain('"versioning"');
	await tick();
	await tick();
	const pulls = setupPulls(repository);
	expect(pulls.map(pull => [pull.state, pull.autoMerge, pull.comments])).toEqual([
		['open', 'SQUASH', [setupAutoMerge.enabled('squash')]],
	]);
	expect(world.github.file(repository, configurationPath, updateBranch)).toBe(canonical);
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
