import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Effect } from 'effect';
import { z } from 'zod';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { executionId, releaseEventId } from '@/persistence/identity-keys';
import { runAction } from '@root/test/support/actions.ts';
import { packedRelease } from '@root/test/support/packed-release.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { bearer, type Reply, text } from '@root/test/support/http.ts';
import { passChecks, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import { World } from '@root/test/support/world.ts';

let world: World;
async function only(api: (path: string) => Promise<Reply>, operation: string): Promise<Execution> {
	const listed = await api('/api/executions');
	if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
	const matches = listed.body.map(decodeExecutionV1).filter(execution => execution.operation === operation);
	if (matches.length !== 1 || !matches[0]) {
		throw new Error(`Expected one ${operation} execution, found ${matches.length}`);
	}
	return matches[0];
}
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

test('a managed release travels from discovery to a verified publication', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());

	const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
	expect(discovered.status).toBe(200);
	expect(text(discovered.body, 'name')).toBe('octo/widget');

	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	expect(plan.status).toBe(200);
	const prepared = await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	expect(prepared.status).toBe(200);
	expect(text(prepared.body, 'state')).toBe('ready');
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	expect(world.github.file(repository, 'package.json', pull.head.sha)).toContain('"version": "1.1.0"');

	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const promotion = await only(api, 'promote');
	expect(promotion.state).toBe('blocked');
	expect(promotion.sourceSha).toBe(merged.sha);

	const readiness = await api('/api/executions/approval', { id: promotion.id });
	expect(readiness.body).toEqual({ problems: [] });
	const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha });
	expect(text(approved.body, 'state')).toBe('ready');

	await world.wait(16_000);
	const [dispatch] = world.github.dispatches;
	expect(dispatch?.inputs.beepboop_execution_id).toBe(promotion.id);
	const run = repository.runs.at(-1);
	if (!run) throw new Error('No workflow run');
	run.status = 'in_progress';
	const identity = { repository, runId: run.id, sha: run.headSha, file: 'publish.yml', actorId: botId };
	const begun = await runAction(world, 'begin', identity, {
		EXECUTION_ID: promotion.id,
		STREAM: 'main',
		OPERATION: 'promote',
	});
	expect(begun.outputs['execution-id']).toBe(promotion.id);
	expect(text(JSON.parse(begun.outputs.context ?? '{}'), 'state')).toBe('running');

	world.npm.publish('widget', '1.1.0');
	const reported = await runAction(world, 'report', identity, {
		EXECUTION_ID: promotion.id,
		PUBLICATIONS: JSON.stringify([
			{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.1.0', outcome: 'succeeded' },
		]),
	});
	expect(reported.outputs.result).toContain('"outcome":"succeeded"');

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
	expect((await only(api, 'promote')).state).toBe('succeeded');
	const journal = await world.coordinator(repository).exportJournal();
	const executions = journal.filter(entry => entry.key.startsWith('execution:')).map(entry =>
		decodeExecutionV1(entry.value)
	);
	expect(executions.map(execution => execution.operation).sort()).toEqual(['prepare', 'promote']);
	for (const execution of executions) {
		expect(execution.id).toBe(
			await Effect.runPromise(
				executionId(execution.repositoryId, execution.stream, execution.operation, execution.eventId),
			),
		);
	}
	const preparation = executions.find(execution => execution.operation === 'prepare');
	expect(preparation?.eventId).toBe(`plan:${text(plan.body, 'planId')}`);
	const succeeded = await only(api, 'promote');
	expect(journal.filter(entry => entry.key.startsWith('release-event:')).map(entry => entry.key)).toEqual([
		`release-event:${releaseEventId({ ...succeeded, version: '1.1.0' })}`,
	]);
	expect(world.github.unhandled).toEqual([]);
	expect(world.network.unrouted).toEqual([]);
});

test('a promotion whose workflow branch was deleted fails with the missing ref named', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = z.looseObject({
		streams: z.looseObject({
			main: z.looseObject({ promote: z.looseObject({ workflow: z.looseObject({}) }) }),
		}),
	}).parse(JSON.parse(widgetConfiguration()));
	configuration.streams.main.promote.workflow.ref = 'release-line';
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Release from a branch');
	passChecks(repository, world.github.head(repository));
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });

	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);
	repository.refs.set('heads/release-line', merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	const promotion = await only(api, 'promote');
	const approved = await api('/api/executions/approve', { id: promotion.id, sourceSha: merged.sha });
	expect(text(approved.body, 'state')).toBe('ready');

	repository.refs.delete('heads/release-line');
	await world.wait(16_000);
	expect(world.github.dispatches).toEqual([]);
	expect((await only(api, 'promote')).reason).toBe(
		'Beepboop could not continue: Workflow ref release-line no longer exists',
	);
});

test('a merge-approved release whose merge cannot be confirmed waits for approval and logs why', async () => {
	const repository = widget(world.github, { approval: 'merge' });
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	const plan = await api('/api/releases/plan', request);
	await api('/api/releases/prepare', {
		...request,
		sourceSha: text(plan.body, 'sourceSha'),
		planId: text(plan.body, 'planId'),
	});
	await world.wait(20_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('No preparation pull request');
	const merged = world.github.merge(repository, pull.number);
	passChecks(repository, merged.sha);

	world.network.serve(
		'api.github.com',
		request =>
			new URL(request.url).pathname.includes('/compare/')
				? Response.json({ message: 'Resource not accessible by integration' }, { status: 403 })
				: world.github.handle(request),
	);
	const logged = spyOn(console, 'error').mockImplementation(() => {});
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const events = logged.mock.calls.flatMap(([line]): unknown[] => {
		if (typeof line !== 'string') return [];
		const parsed: unknown = JSON.parse(line);
		return [parsed];
	});
	logged.mockRestore();
	expect(events).toEqual([{
		event: 'preparation-merge.failed',
		repository: 'octo/widget',
		pull: `https://github.com/octo/widget/pull/${pull.number}`,
		error:
			`GitHub HTTP 403 on GET /repos/octo/widget/compare/${merged.sha}...${merged.sha}: Resource not accessible by integration`,
	}]);
	const promotion = await only(api, 'promote');
	expect(promotion.state).toBe('blocked');
	expect(promotion.approvedBy).toBeUndefined();
});

test('packed prepare and refs runtimes publish the planned tag', async () => {
	const { repository, promotionId } = await packedRelease(world);
	const api = bearer(world, await world.cliSession());
	const promotion = await only(api, 'promote');
	expect(promotion.id).toBe(promotionId);
	expect(promotion.state).toBe('succeeded');
	expect(promotion.publications.some(entry => entry.id === 'refs:promote' && entry.outcome === 'succeeded')).toBe(
		true,
	);
	expect(world.github.file(repository, 'package.json', promotion.sourceSha)).toContain('"version": "1.1.0"');
	const journal = await world.coordinator(repository).exportJournal();
	expect(
		journal.filter(entry => entry.key.startsWith('execution:')).map(entry => decodeExecutionV1(entry.value).operation)
			.sort(),
	).toEqual(['prepare', 'promote']);
	expect(world.github.unhandled).toEqual([]);
	expect(world.network.unrouted).toEqual([]);
});
