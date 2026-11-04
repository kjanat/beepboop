import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Execution } from '@/automation/types';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { runAction } from '../support/actions.ts';
import { botId, ownerId } from '../support/github.ts';
import { bearer, type Reply, text } from '../support/http.ts';
import { passChecks, widget } from '../support/repositories.ts';
import { World } from '../support/world.ts';

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
	expect(journal.some(entry => entry.key.startsWith('release-event:'))).toBe(true);
	expect(world.github.unhandled).toEqual([]);
	expect(world.network.unrouted).toEqual([]);
});
