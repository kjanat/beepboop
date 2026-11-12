import { beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { Repository } from '@root/test/support/github.ts';
import type { Api } from '@root/test/support/http.ts';
import { bearer, field, text } from '@root/test/support/http.ts';
import { executions, prepareRelease } from '@root/test/support/releases.ts';
import {
	crateMetadata,
	dispatchedPublishWorkflow,
	editableConfiguration,
	licenseText,
	passChecks,
	runWorkflow,
	widget,
} from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { adminSubject, eachWorld, origin } from '@root/test/support/world.ts';
import { experimental_AstroContainer } from 'astro/container';
import { Effect, Schema, Struct } from 'effect';
import { Window } from 'happy-dom';
import { app } from '@/cli/cli';
import { errorEnvelope } from '@/contract/errors';
import { streamRelease } from '@/contract/views';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/schema';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableRecord,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';
import { loaders } from '@/server/loaders';

type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
const componentModule = mutableStruct({
	default: Schema.declare<Component>((value): value is Component => typeof value === 'function'),
});

let world: World, directory: string, api: Api;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-capability-', created => {
	directory = created;
});
beforeEach(async () => {
	const { token } = await savedClient(world, directory);
	api = bearer(world, token);
	world.network.serve(new URL(origin).host, request => world.handle(request));
	world.network.serve('proxy.golang.org', () => new Response(null, { status: 404 }));
});

const module = 'pkg:golang/github.com/octo/statute';
const observers = {
	release: { file: 'release.yml', ref: 'refs/tags/v*', mode: 'observe', publications: ['pkg:github/octo/statute'] },
	pkg: { file: 'pkg.yml', ref: 'refs/tags/v*', mode: 'observe', publications: [module] },
};
const observed =
	'release.yml on refs/tags/v* or pkg.yml on refs/tags/v* starts a release of main. Beepboop records the run and starts no release of this stream.';

async function statute(promote?: Record<string, unknown>): Promise<Repository> {
	const repository = world.github.create('octo/statute', {
		'go.mod': 'module github.com/octo/statute\n\ngo 1.26\n',
		'.github/workflows/release.yml': `name: Release\n${
			runWorkflow("{ push: { tags: ['v*'] } }", 'gh release create "$GITHUB_REF_NAME"')
		}`,
		'.github/workflows/pkg.yml': `name: Index\n${runWorkflow("{ push: { tags: ['v*'] } }", 'go list -m')}`,
		'.github/workflows/tag.yml': dispatchedPublishWorkflow('Tag', 'main', 'release', '      - run: echo tag\n'),
		'.github/beepboop.json': JSON.stringify({
			streams: {
				main: {
					packages: [module],
					mustPublish: [module],
					versionSource: { kind: 'tags', prefix: 'v' },
					...(promote ? { promote } : {}),
					workflows: observers,
				},
			},
		}),
	});
	repository.refs.set('tags/v0.13.1', world.github.head(repository));
	passChecks(repository, world.github.head(repository));
	const discovered = await api('/api/repositories/discover', { repository: repository.name });
	expect(field(discovered.body, 'diagnostics')).toEqual([]);
	return repository;
}

async function release(repository: Repository, stream = 'main') {
	const listed = decodeSync(
		mutableArray(looseStruct({ id: Schema.Finite, releases: mutableRecord(Schema.String, streamRelease) })),
		(await api('/api/repositories')).body,
	);
	const found = listed.find(entry => entry.id === repository.id)?.releases[stream];
	if (!found) throw new Error(`No release capability of ${stream}`);
	return found;
}

async function rendered(component: 'Releases' | 'Repositories', query: string) {
	const section = component === 'Releases' ? 'releases' : 'repositories';
	const context = { env: world.env, actor: adminSubject };
	const data = component === 'Releases'
		? await world.run(loaders.releases(context))
		: await world.run(loaders.repositories(context));
	const loaded: unknown = await import(join(import.meta.dir, `../../src/components/${component}.astro`));
	const container = await experimental_AstroContainer.create();
	const html = await container.renderToString(decodeSync(componentModule, loaded).default, {
		props: { data },
		request: new Request(`${origin}/${section}${query}`),
	});
	const page = new Window();
	page.document.body.innerHTML = html;
	const shown = {
		text: page.document.body.textContent.replace(/\s+/g, ' '),
		buttons: [...page.document.querySelectorAll('button, a.button')].map(element => element.textContent.trim()),
	};
	await page.happyDOM.close();
	return shown;
}

function refusal(body: unknown): string {
	return decodeSync(errorEnvelope, body).error;
}

test('a stream that only observes offers no release and every surface says what starts one', async () => {
	const repository = await statute();
	expect(await release(repository)).toEqual({ kind: 'observes', summary: observed });

	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const planned = await api('/api/releases/plan', request);
	expect([planned.status, refusal(planned.body)]).toEqual([422, observed]);
	const prepared = await api('/api/releases/prepare', { ...request, sourceSha: 'a'.repeat(40), planId: 'plan' });
	expect([prepared.status, refusal(prepared.body)]).toEqual([422, observed]);
	const set = await api('/api/releases/plan-set', { repositoryId: repository.id, stream: 'main', plan: {} });
	expect([set.status, refusal(set.body)]).toEqual([422, observed]);

	const form = await rendered('Releases', `?repository=${repository.id}`);
	expect(form.text).toContain(observed);
	expect(form.text).toContain('Releases start on GitHub');
	expect(form.buttons).toEqual(['Choose']);
	const list = await rendered('Repositories', '');
	expect(list.text).toContain(observed);
	expect(list.buttons).not.toContain('Prepare a release');

	const cli = await runCli(['release', 'patch', '--repository', repository.name, '--json']);
	expect(cli.exitCode).not.toBe(0);
	expect(cli.stdout.join('')).toContain(observed);
	const named = await runCli(['release', 'patch', '--repository', repository.name, '--stream', 'main', '--json']);
	expect(named.exitCode).not.toBe(0);
	expect(named.stdout.join('')).toContain('STREAM_CANNOT_RELEASE');
	expect(named.stdout.join('')).toContain(observed);
	const show = await runCli(['repositories', 'show', repository.name]);
	expect(show.stdout.join('')).toContain(observed);
	expect(await executions(api)).toEqual([]);
});

test('the form names the last release an observing stream recorded', async () => {
	const repository = await statute();
	const run = {
		id: 9001,
		path: '.github/workflows/pkg.yml',
		event: 'push',
		headSha: world.github.head(repository),
		headBranch: 'v0.13.1',
		status: 'completed' as const,
		conclusion: 'success',
		attempt: 1,
		title: 'Index',
		inputs: {},
	};
	world.network.serve('proxy.golang.org', () => Response.json({ Version: 'v0.13.1' }));
	repository.runs.push(run);
	await world.workflowRun(repository, run, 'success', 'push');
	await world.wait(20_000);
	const recorded = (await executions(api)).find(execution => execution.state === 'succeeded');
	expect(recorded?.version).toBe('0.13.1');
	const form = await rendered('Releases', `?repository=${repository.id}`);
	expect(form.text).toContain('Last recorded release: 0.13.1');
});

test('a tag-versioned stream with a publishing workflow goes straight to a publication run', async () => {
	const repository = await statute({
		workflow: { file: 'tag.yml', refs: { phase: 'version', prefix: 'v' }, publications: [module] },
	});
	const summary = 'main has no version to write. The release goes straight to tag.yml and waits for you to publish it.';
	expect(await release(repository)).toEqual({ kind: 'promotes', summary });

	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const planned = await api('/api/releases/plan', request);
	expect(planned.status).toBe(200);
	expect(
		decodeSync(
			looseStruct({ version: Schema.String, edits: mutableArray(Schema.Unknown), requiresPreparation: Schema.Boolean }),
			planned.body,
		),
	).toMatchObject({ version: '0.13.2', edits: [], requiresPreparation: false });
	const prepared = await api('/api/releases/prepare', {
		...request,
		sourceSha: text(planned.body, 'sourceSha'),
		planId: text(planned.body, 'planId'),
	});
	expect(prepared.status).toBe(200);
	expect([text(prepared.body, 'operation'), text(prepared.body, 'state'), text(prepared.body, 'version')]).toEqual([
		'promote',
		'awaiting-approval',
		'0.13.2',
	]);

	const form = await rendered('Releases', `?repository=${repository.id}`);
	expect(form.text).toContain(summary);
	expect(form.buttons).toEqual(['Choose', 'Release']);
	expect((await rendered('Repositories', '')).buttons).toContain('Prepare a release');

	const cli = await runCli(['release', 'minor', '--repository', repository.name, '--yes']);
	expect(cli.exitCode).toBe(0);
	const output = cli.stdout.join('');
	expect(output).toContain(summary);
	const minor = (await executions(api)).find(execution => execution.version === '0.14.0');
	expect([minor?.operation, minor?.state]).toEqual(['promote', 'awaiting-approval']);
	expect(output).toContain(`beepboop runs publish ${minor?.id} --sourceSha ${world.github.head(repository)}`);
});

async function configuredWidget(change: (main: Record<string, unknown>) => void) {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	change(configuration.streams.main);
	const head = world.github.push(
		repository,
		{ '.github/beepboop.json': JSON.stringify(configuration) },
		'Change the release setup',
	);
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	return repository;
}

test('a stream that prepares names where the version lands', async () => {
	const repository = await configuredWidget(() => {});
	const summary =
		'Beepboop opens a preparation pull request that writes the new version of main to the package manifests.';
	expect(await release(repository)).toEqual({ kind: 'prepares', summary });
	const form = await rendered('Releases', `?repository=${repository.id}`);
	expect(form.text).toContain(summary);
	expect(form.buttons).toEqual(['Choose', 'Release']);
});

test('a stream that commits its version says so', async () => {
	const repository = await configuredWidget(main => {
		main.prepare = { strategy: 'managed', bump: 'commit' };
	});
	expect((await release(repository)).summary).toBe(
		'Beepboop commits the new version of main to the package manifests.',
	);
});

test('a stream with a preparation workflow names it', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main.prepare = { strategy: 'workflow', workflow: { file: 'prepare.yml' } };
	const head = world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/prepare.yml': dispatchedPublishWorkflow(
			'Prepare',
			'main',
			'release',
			'      - run: ./prepare\n',
		),
	}, 'Delegate preparation');
	passChecks(repository, head.sha);
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(await release(repository)).toEqual({
		kind: 'prepares',
		summary: 'prepare.yml prepares the new version of main.',
	});
});

test('a tag-versioned stream with version files names them', async () => {
	const repository = await statute({
		workflow: { file: 'tag.yml', refs: { phase: 'version', prefix: 'v' }, publications: [module] },
	});
	const configuration = JSON.parse(world.github.file(repository, '.github/beepboop.json') ?? '{}');
	configuration.streams.main.versionFiles = [
		{ path: 'VERSION', format: 'text', prefix: 'v', suffix: '\n' },
		{ path: 'docs/version.json', format: 'json', key: ['version'] },
	];
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		VERSION: 'v0.13.1\n',
		'docs/version.json': '{"version":"0.13.1"}\n',
	}, 'Carry the version in files');
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	expect(await release(repository)).toEqual({
		kind: 'prepares',
		summary:
			'Beepboop opens a preparation pull request that writes the new version of main to VERSION and docs/version.json.',
	});
});

test('a stream without any workflow asks for a publishing workflow', async () => {
	const repository = await configuredWidget(main => {
		main.promote = { approval: 'required' };
	});
	const summary = 'main has no publishing workflow. Add one in release setup.';
	expect(await release(repository)).toEqual({ kind: 'unpublishable', summary });
	const planned = await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	expect([planned.status, refusal(planned.body)]).toEqual([422, summary]);
	const form = await rendered('Releases', `?repository=${repository.id}`);
	expect(form.text).toContain(summary);
	expect(form.buttons).toEqual(['Choose', 'Open release setup']);
	const cli = await runCli(['release', '1.1.0', '--repository', repository.name, '--json']);
	expect(cli.exitCode).not.toBe(0);
	expect(cli.stdout.join('')).toContain(summary);
});

test('a plan whose lockfiles need regenerating names the missing preparation workflow', async () => {
	world.network.serve('crates.io', () => new Response(null, { status: 404 }));
	const repository = world.github.create('octo/gear', {
		'Cargo.toml': `[package]\nname = "gear"\nversion = "1.0.0"\n${crateMetadata}`,
		'Cargo.lock': '# Lockfile\n',
		'README.md': '# gear\n',
		LICENSE: licenseText,
		'.github/workflows/publish.yml': dispatchedPublishWorkflow(
			'Publish',
			'main',
			'release',
			'      - run: cargo publish\n',
		),
		'.github/beepboop.json': JSON.stringify({
			streams: {
				main: {
					packages: ['pkg:cargo/gear'],
					mustPublish: ['pkg:cargo/gear'],
					promote: { workflow: { file: 'publish.yml', publications: ['pkg:cargo/gear'] } },
				},
			},
		}),
	});
	passChecks(repository, world.github.head(repository));
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const { plan, prepared } = await prepareRelease(api, {
		repositoryId: repository.id,
		stream: 'main',
		version: '1.1.0',
	});
	expect(field(plan.body, 'requiresPreparation')).toBe(true);
	expect([prepared.status, refusal(prepared.body)]).toEqual([
		422,
		'Lockfiles need regenerating and main has no preparation workflow. Add one in release setup.',
	]);
});

test('a direct release under version-commit-pushed says that it publishes without another approval', async () => {
	const repository = await statute({
		publishWhen: 'version-commit-pushed',
		workflow: { file: 'tag.yml', refs: { phase: 'version', prefix: 'v' }, publications: [module] },
	});
	const summary =
		'main has no version to write. The release goes straight to tag.yml and publishes once the commit is verified and its checks pass.';
	expect(await release(repository)).toEqual({ kind: 'promotes', summary });
	const prompts: string[] = [];
	const cli = await app.execute(['release', 'patch', '--repository', repository.name], {
		prompter: {
			async promptOne(config) {
				prompts.push(config.message);
				return { answered: true, value: true };
			},
		},
		isTTY: true,
		env: {},
	});
	expect(cli.exitCode).toBe(0);
	const output = cli.stdout.join('');
	expect(output).toContain(summary);
	expect(output).toContain('Beepboop publishes once the commit is verified and its checks pass.');
	expect(output).not.toContain('runs publish');
	expect(prompts).toEqual(['Publish 0.13.2 once its commit is verified and its checks pass?']);
});
