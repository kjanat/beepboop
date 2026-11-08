import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { runAction } from '@root/test/support/actions.ts';
import { botId, ownerId, type Repository } from '@root/test/support/github.ts';
import { bearer, type Reply } from '@root/test/support/http.ts';
import { passChecks, widget } from '@root/test/support/repositories.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

async function promotions(api: (path: string) => Promise<Reply>): Promise<Execution[]> {
	const listed = await api('/api/executions');
	if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
	return listed.body.map(decodeExecutionV1).filter(execution => execution.operation === 'promote');
}
function manifest(name: string, version: string, dependencies?: Record<string, string>): string {
	return `${JSON.stringify({ name, version, ...(dependencies ? { dependencies } : {}) }, null, 2)}\n`;
}
async function elevate() {
	await world.db.prepare('INSERT INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)')
		.bind(
			'proof',
			'elevation',
			JSON.stringify({ subject: world.env.ADMIN_SUBJECT, elevated: true }),
			Date.now() + 60_000,
		)
		.run();
}
async function finish(repository: Repository, promotion: Execution, name: string, version: string) {
	const run = repository.runs.find(entry => entry.inputs.beepboop_execution_id === promotion.id);
	if (!run) throw new Error(`No run for ${promotion.stream}`);
	run.status = 'in_progress';
	const identity = { repository, runId: run.id, sha: run.headSha, file: 'publish.yml', actorId: botId };
	await runAction(world, 'begin', identity, {
		EXECUTION_ID: promotion.id,
		STREAM: promotion.stream,
		OPERATION: 'promote',
	});
	world.npm.publish(name, version);
	await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([{ id: `pkg:npm/${name}`, manager: 'npm', name, version, outcome: 'succeeded' }]),
	});
	run.status = 'completed';
	run.conclusion = 'success';
	await world.webhook('workflow_run', {
		action: 'completed',
		workflow_run: {
			id: run.id,
			conclusion: 'success',
			event: 'workflow_dispatch',
			path: run.path,
			head_repository: { id: repository.id },
		},
		repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
	});
	await world.wait(2_000);
}

test('a push release waits for its credential grant and dispatches once the grant exists', async () => {
	const repository = widget(world.github, { approval: 'push' });
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const merged = world.github.push(repository, { 'package.json': manifest('widget', '1.1.0') }, 'Release 1.1.0');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(60_000);
	const [waiting] = await promotions(api);
	expect([waiting?.state, waiting?.sourceSha, waiting?.reason]).toEqual([
		'awaiting-approval',
		merged.sha,
		'Releases once npm-token has a runtime grant for publish.yml',
	]);
	expect(world.github.dispatches).toEqual([]);

	await elevate();
	expect(
		(await api('/api/credentials/replace', {
			alias: 'npm-token',
			value: 'secret',
			proof: 'proof',
			expectedVersion: null,
		}))
			.status,
	).toBe(200);
	await elevate();
	const granted = await api('/api/credentials/grant', {
		proof: 'proof',
		selection: {
			alias: 'npm-token',
			repositoryId: repository.id,
			stream: 'main',
			operation: 'promote',
			delivery: 'runtime',
		},
	});
	expect(granted.status).toBe(200);
	await world.wait(16_000);
	const [approved] = await promotions(api);
	expect(approved?.reason).toBeUndefined();
	expect(approved?.approvedAt).toBeNumber();
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([approved?.id]);
}, 60_000);

test('a promotion waits for the promotion of the same commit that publishes its dependency', async () => {
	const promote = (name: string) => ({
		packages: [`pkg:npm/${name}`],
		required: [`pkg:npm/${name}`],
		prepare: { strategy: 'managed' },
		promote: { approval: 'push', workflow: { file: 'publish.yml', publications: [`pkg:npm/${name}`] } },
	});
	const repository = widget(world.github, { configured: false });
	world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: { main: promote('widget'), cli: promote('gadget') },
		}),
		'packages/gadget/package.json': manifest('gadget', '1.0.0', { widget: '^1.0.0' }),
	}, 'Release the gadget CLI separately');
	passChecks(repository, world.github.head(repository));
	world.npm.publish('widget', '1.0.0');
	world.npm.publish('gadget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const merged = world.github.push(repository, {
		'package.json': manifest('widget', '1.1.0'),
		'packages/gadget/package.json': manifest('gadget', '1.1.0', { widget: '^1.1.0' }),
	}, 'Release 1.1.0');
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(16_000);
	const byStream = async () => new Map((await promotions(api)).map(promotion => [promotion.stream, promotion]));
	const first = await byStream();
	const main = first.get('main'), cli = first.get('cli');
	if (!main || !cli) throw new Error('Expected promotions for both streams');
	expect([cli.state, cli.reason]).toEqual([
		'awaiting-approval',
		'Releases after the main release publishes pkg:npm/widget',
	]);
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([main.id]);

	await finish(repository, main, 'widget', '1.1.0');
	await world.wait(16_000);
	const second = await byStream();
	expect(second.get('main')?.state).toBe('succeeded');
	expect(second.get('cli')?.reason).toBeUndefined();
	expect(world.github.dispatches.map(dispatch => dispatch.inputs.beepboop_execution_id)).toEqual([main.id, cli.id]);
}, 60_000);
