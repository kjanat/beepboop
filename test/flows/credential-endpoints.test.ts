import { expect, test } from 'bun:test';
import { runAction } from '@root/test/support/actions.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import type { Reply } from '@root/test/support/http.ts';
import { bearer } from '@root/test/support/http.ts';
import { editableConfiguration, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Cause, Effect, Exit } from 'effect';
import { deliverCredentials } from '@/credentials/http/credentials.ts';
import { DomainError, errorEnvelope } from '@/kernel/errors/domain-error.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';

let world: World;
eachWorld(created => {
	world = created;
});

function refusal(response: Reply): [number, string] {
	return [response.status, decodeSync(errorEnvelope, response.body).error];
}

test('credential endpoints refuse unknown names and grants and serve a stored value', async () => {
	const repository = await discoveredWidget(world, await world.cliSession());
	const api = bearer(world, await world.cliSession());
	const elevated = async (path: string, body: Record<string, unknown>) => {
		await world.db.prepare('DELETE FROM sessions WHERE id=?').bind('proof').run();
		await world.elevate();
		return api(path, { ...body, proof: 'proof' });
	};
	const selection = {
		alias: 'npm-token',
		repositoryId: repository.id,
		stream: 'main',
		operation: 'promote',
		delivery: 'runtime',
	};
	const missing: [number, string] = [404, 'No stored value under this name'];

	expect(refusal(await elevated('/api/credentials/reveal', { alias: 'npm-token' }))).toEqual(missing);
	expect(refusal(await elevated('/api/credentials/sync', { alias: 'npm-token' }))).toEqual(missing);
	expect(refusal(await elevated('/api/credentials/grant', { selection }))).toEqual([
		422,
		'Store a value under this name before granting access',
	]);
	expect(refusal(await elevated('/api/credentials/revoke', { grantId: 'missing' }))).toEqual([404, 'Unknown grant']);
	expect(refusal(await elevated('/api/credentials/grant', { selection: { ...selection, repositoryId: 999 } })))
		.toEqual([404, 'Repository is not enrolled']);
	expect(await world.db.prepare('SELECT id FROM sessions WHERE id=?').bind('proof').first()).toEqual({ id: 'proof' });

	expect((await elevated('/api/credentials/replace', { alias: 'npm-token', value: 'secret' })).body).toEqual({
		version: 1,
	});
	expect(refusal(
		await elevated('/api/credentials/replace', {
			alias: 'npm-token',
			value: 'newer',
			expectedVersion: null,
		}),
	)).toEqual([409, 'npm-token changed since you checked it; review it again']);
	expect((await elevated('/api/credentials/reveal', { alias: 'npm-token' })).body).toEqual({
		value: 'secret',
		version: 1,
	});
	expect((await elevated('/api/credentials/grant', { selection })).body).toEqual({ granted: true });
	expect((await elevated('/api/credentials/sync', { alias: 'npm-token' })).body).toEqual([]);
	const listed = await api('/api/credentials');
	expect(listed.body).toMatchObject({
		credentials: [{ alias: 'npm-token', version: 1, active: 1 }],
		grants: [{ alias: 'npm-token', repositoryId: repository.id, delivery: 'runtime' }],
		deliveries: [],
	});
});

test('workflow credential delivery refuses an alias the stream does not request before it reads the vault', async () => {
	const read: string[] = [];
	const vault = {
		runtime: (alias: string) =>
			Effect.sync(() => {
				read.push(alias);
				return `${alias}-value`;
			}),
	};
	const run = {
		repositoryId: 42,
		repository: 'octo/widget',
		ref: 'refs/heads/main',
		workflowRef: 'octo/widget/.github/workflows/release.yml@refs/heads/main',
		runId: 7,
		attempt: 1,
	};
	expect(
		await Effect.runPromise(
			deliverCredentials(vault, { allowed: ['npm-token'], aliases: ['npm-token'], operation: 'promote', run }),
		),
	).toEqual({ 'npm-token': 'npm-token-value' });
	const exit = await Effect.runPromiseExit(
		deliverCredentials(vault, {
			allowed: ['npm-token'],
			aliases: ['npm-token', 'cargo-token'],
			operation: 'promote',
			run,
		}),
	);
	const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
	expect(error instanceof DomainError ? [error.problem.code, error.message] : error).toEqual([
		'forbidden',
		'Alias not requested by the stream',
	]);
	expect(read).toEqual(['npm-token', 'npm-token']);
});

test('triage delivers only its granted credential to the configured default-branch workflow', async () => {
	const repository = widget(world.github);
	const configuration = editableConfiguration();
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify({
			...configuration,
			streams: {
				main: {
					...configuration.streams.main,
					credentials: ['npm-token', 'TYPESAFE_API_KEY'],
					workflows: { triage: { file: 'triage.yml', mode: 'observe', required: false } },
				},
			},
		}),
		'.github/workflows/triage.yml':
			'name: Triage\non: { issues: { types: [opened] } }\njobs:\n  triage:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ready\n',
	}, 'Configure triage');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);

	const elevated = async (path: string, body: Record<string, unknown>) => {
		await world.db.prepare('DELETE FROM sessions WHERE id=?').bind('proof').run();
		await world.elevate();
		return api(path, { ...body, proof: 'proof' });
	};
	const run = { repository, sha: world.github.head(repository), file: 'triage.yml', runId: 42, event: 'issues' };
	const triage = async (overrides: Partial<typeof run> & { ref?: string } = {}) =>
		bearer(world, await world.runToken({ ...run, ...overrides }))('/api/workflow/triage', {});

	const credentials = [['TYPESAFE_API_KEY', 'test-classifier-key'], ['npm-token', 'test-release-key']];
	for (const [alias, value] of credentials) {
		expect((await elevated('/api/credentials/replace', { alias, value })).status).toBe(200);
	}
	expect(refusal(await triage())).toEqual([403, 'Credential grant denied']);
	for (const [alias] of credentials) {
		expect(
			(await elevated('/api/credentials/grant', {
				selection: { alias, repositoryId: repository.id, stream: 'main', operation: 'triage', delivery: 'runtime' },
			})).body,
		).toEqual({ granted: true });
	}
	for (const event of ['issues', 'pull_request_target', 'workflow_dispatch']) {
		const token = await world.runToken({ ...run, event });
		const result = await bearer(world, token)('/api/workflow/triage', { aliases: ['npm-token'] });
		expect(result.status).toBe(200);
		expect(result.body).toEqual({ key: 'test-classifier-key' });
	}
	expect(refusal(await triage({ file: 'ci.yml' }))).toEqual([403, 'Workflow is not configured for triage credentials']);
	for (const overrides of [{ ref: 'refs/heads/feature' }, { event: 'pull_request' }, { event: 'push' }]) {
		expect(refusal(await triage(overrides)), JSON.stringify(overrides)).toEqual([
			403,
			'Triage requires an issue, target pull request or manual run from the default branch',
		]);
	}
	const pullRequestTarget = bearer(world, await world.runToken({ ...run, event: 'pull_request_target' }));
	expect(
		refusal(await pullRequestTarget('/api/workflow/credentials', { executionId: 'x', aliases: ['TYPESAFE_API_KEY'] })),
	)
		.toEqual([403, 'Workflow identity is not eligible']);
	expect(refusal(await pullRequestTarget('/api/workflow/token', {}))).toEqual([
		403,
		'Workflow identity is not eligible',
	]);
});

const deactivatedTypeSafeKeys = [
	[
		'first',
		'apikey_211647c1719f14c74be089009b9b5666587e_a9231087badd7e233b5a7676cda2df2dea9c76553ebeaf9224eb6e397be5386f',
	],
	[
		'second',
		'apikey_211655573ff2144d438784bf8c5f83ff30a6_521aff90f9ca1c77a490d337a50b088b2532ae305df1aab012a79160838f0a53',
	],
] as const;

test.each(deactivatedTypeSafeKeys)(
	'triage action masks the OIDC token and the %s TypeSafe key',
	async (_, typeSafeKey) => {
		const oidcToken = 'fake-triage-oidc-token';
		world.network.serve('triage.test', async request => {
			expect(request.method).toBe('POST');
			expect(new URL(request.url).pathname).toBe('/api/workflow/triage');
			expect(request.headers.get('Authorization')).toBe(`Bearer ${oidcToken}`);
			expect(await request.json()).toEqual({});
			return Response.json({ key: typeSafeKey });
		});
		const action = await runAction(world, 'triage', oidcToken, { SERVICE_ORIGIN: 'https://triage.test' });
		expect(action.outputs).toEqual({ 'typesafe-api-key': typeSafeKey });
		expect(action.logs).toEqual([`::add-mask::${oidcToken}`, `::add-mask::${typeSafeKey}`]);
		expect(action.environment).toBe('');
	},
);
