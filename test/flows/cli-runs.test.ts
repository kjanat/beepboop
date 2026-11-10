import { beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gitOutput } from '@root/test/support/actions.ts';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { z } from 'zod';
import { app } from '@/cli/cli';
import type { Client } from '@/cli/client';
import { filterRuns, slimRun } from '@/cli/runs';
import type { executionFilter } from '@/contract/routes';
import { routes } from '@/contract/routes';
import type { ExecutionView } from '@/contract/views';

let world: World, directory: string, client: Client, token: string;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-runs-', created => {
	directory = created;
});
beforeEach(async () => {
	({ client, token } = await savedClient(world, directory));
});

async function checkout(name: string) {
	const dir = join(directory, name.replace('/', '-'));
	await mkdir(dir);
	gitOutput(dir, ['init']);
	gitOutput(dir, ['remote', 'add', 'origin', `https://github.com/${name}.git`]);
	return dir;
}
async function listed(args: string[], cwd: string) {
	const spy = spyOn(process, 'cwd').mockReturnValue(cwd);
	try {
		return await runCli(['runs', 'list', '--json', ...args]);
	} finally {
		spy.mockRestore();
	}
}
const ids = (result: { stdout: readonly string[] }) =>
	z.array(z.looseObject({ id: z.string() })).parse(
		JSON.parse(result.stdout.join('')),
	).map(entry => entry.id);

async function prepared() {
	const repository = await discoveredWidget(world, token);
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const plan = await Effect.runPromise(client.call(routes.releasesPlan, request));
	return Effect.runPromise(
		client.call(routes.releasesPrepare, { ...request, sourceSha: plan.sourceSha, planId: plan.planId }),
	);
}

test('runs list defaults to the checkout repository, and --all, --repository and the environment override it', async () => {
	const run = await prepared();
	const here = await checkout('octo/widget');
	const elsewhere = await checkout('octo/other');
	const outside = join(directory, 'plain');
	await mkdir(outside);
	expect(ids(await listed([], here))).toEqual([run.id]);
	expect(ids(await listed([], elsewhere))).toEqual([]);
	expect(ids(await listed(['--all'], elsewhere))).toEqual([run.id]);
	expect(ids(await listed([], outside))).toEqual([run.id]);
	expect(ids(await listed(['--repository', 'octo/widget'], elsewhere))).toEqual([run.id]);
	expect(ids(await listed(['--repository', 'octo/other'], here))).toEqual([]);
	expect(ids(await listed(['--repository', 'widget'], elsewhere))).toEqual([run.id]);
	expect(ids(await listed(['--repository', 'octo/other', '--all'], here))).toEqual([run.id]);
	const spy = spyOn(process, 'cwd').mockReturnValue(elsewhere);
	try {
		const result = await app.execute(['runs', 'list', '--json'], {
			isTTY: true,
			env: { BEEPBOOP_REPOSITORY: 'octo/widget' },
		});
		expect(ids(result)).toEqual([run.id]);
	} finally {
		spy.mockRestore();
	}
});

test('runs list filters by stream, operation, state, version and limit', async () => {
	const run = await prepared();
	const outside = join(directory, 'plain');
	await mkdir(outside);
	const only = async (...args: string[]) => ids(await listed(args, outside));
	expect(await only('--stream', 'main', '--operation', 'prepare', '--releaseVersion', '1.0.1')).toEqual([run.id]);
	expect(await only('--stream', 'other')).toEqual([]);
	expect(await only('--operation', 'promote')).toEqual([]);
	expect(await only('--releaseVersion', '9.9.9')).toEqual([]);
	expect(await only('--state', run.state, '--state', 'failed')).toEqual([run.id]);
	expect(await only('--state', 'failed')).toEqual([]);
	expect(await only('--limit', '1')).toEqual([run.id]);
	for (const limit of ['0', '-1', '1.5', '201', 'many']) {
		const refused = await runCli(['runs', 'list', `--limit=${limit}`, '--server', 'http://127.0.0.1:1']);
		expect([limit, refused.exitCode === 0]).toEqual([limit, false]);
		expect(refused.stderr.join('')).toContain(`Invalid number value '${limit}' for flag --limit`);
	}
	const bad = await runCli(['runs', 'list', '--state', 'sideways']);
	expect(bad.exitCode).not.toBe(0);
	expect(bad.stderr.join('')).toContain('sideways');
});

test('runs list --json prints a summary, and --full prints the whole record', async () => {
	const run = await prepared();
	const outside = join(directory, 'plain');
	await mkdir(outside);
	const [slim] = z.array(z.record(z.string(), z.unknown())).parse(
		JSON.parse((await listed([], outside)).stdout.join('')),
	);
	expect(Object.keys(slim ?? {}).sort()).toEqual(
		['id', 'operation', 'publications', 'repository', 'sourceSha', 'state', 'stream', 'updatedAt', 'version'],
	);
	expect(slim).toMatchObject({ id: run.id, repository: 'octo/widget', operation: 'prepare', version: '1.0.1' });
	const [full] = z.array(z.record(z.string(), z.unknown())).parse(
		JSON.parse((await listed(['--full'], outside)).stdout.join('')),
	);
	expect(full).toHaveProperty('configuration');
	expect(full).toHaveProperty('id', run.id);
});

test('filterRuns and slimRun compare repositories without case and keep only publication ids and outcomes', () => {
	const run = (id: string, repository: string, state: ExecutionView['state'], extra: object = {}): ExecutionView => ({
		id,
		repositoryId: 1,
		repository,
		stream: 'main',
		operation: 'promote',
		state,
		version: '1.0.0',
		sourceSha: 'a'.repeat(40),
		updatedAt: 1,
		...extra,
	});
	const all = [
		run('a', 'Octo/Widget', 'failed'),
		run('b', 'octo/tool', 'failed'),
		run('c', 'octo/widget', 'succeeded'),
	];
	const filters = { all: false, state: [] as ExecutionView['state'][] };
	expect(filterRuns(all, 'octo/widget', filters).map(entry => entry.id)).toEqual(['a', 'c']);
	expect(filterRuns(all, undefined, { ...filters, state: ['failed'] }).map(entry => entry.id)).toEqual(['a', 'b']);
	expect(filterRuns(all, undefined, { ...filters, limit: 2 }).map(entry => entry.id)).toEqual(['a', 'b']);
	expect(
		slimRun(run('d', 'octo/tool', 'succeeded', {
			configuration: { secret: 1 },
			publications: [{ id: 'pkg:npm/tool', outcome: 'succeeded', digest: 'x', url: 'y' }],
		})),
	).toEqual({
		id: 'd',
		repository: 'octo/tool',
		stream: 'main',
		operation: 'promote',
		state: 'succeeded',
		version: '1.0.0',
		sourceSha: 'a'.repeat(40),
		updatedAt: 1,
		publications: [{ id: 'pkg:npm/tool', outcome: 'succeeded' }],
	});
});

async function crowded() {
	const run = await prepared();
	const row = z.object({ document: z.string(), updated_at: z.number() }).parse(
		await world.db.prepare('SELECT document, updated_at FROM executions WHERE id=?').bind(run.id).first(),
	);
	const statement = world.db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?)',
	);
	await world.db.batch(
		Array.from({ length: 205 }, (_, index) => {
			const document = JSON.stringify({
				...JSON.parse(row.document),
				id: `decoy-${index}`,
				repositoryId: 777,
				repository: 'octo/other',
			});
			return statement.bind(`decoy-${index}`, 777, 'succeeded', document, row.updated_at + 1 + index);
		}),
	);
	return run;
}

test('the server filters before its 200-row limit, so busy repositories cannot hide a quiet one', async () => {
	const run = await crowded();
	const everything = await Effect.runPromise(client.call(routes.executionsList, {}));
	expect(everything).toHaveLength(200);
	expect(everything.map(entry => entry.id)).not.toContain(run.id);
	const chosen = await Effect.runPromise(client.call(routes.executionsList, { repository: 'OCTO/Widget' }));
	expect(chosen.map(entry => entry.id)).toEqual([run.id]);
	const other = await Effect.runPromise(client.call(routes.executionsList, { stream: 'main', limit: 3 }));
	expect(other).toHaveLength(3);
	const outside = join(directory, 'plain');
	await mkdir(outside);
	expect(ids(await listed(['--repository', 'octo/widget'], outside))).toEqual([run.id]);
	expect(ids(await listed(['--repository', 'octo/widget', '--state', 'succeeded'], outside))).toEqual([]);
});

test('the server applies stream, operation, state and version filters in SQL and rejects unknown states', async () => {
	const run = await crowded();
	const list = (input: z.input<typeof executionFilter>) =>
		Effect.runPromise(client.call(routes.executionsList, input)).then(rows => rows.map(entry => entry.id));
	expect(await list({ repository: 'octo/widget', stream: 'main', operation: run.operation, version: '1.0.1' })).toEqual(
		[
			run.id,
		],
	);
	expect(await list({ repository: 'octo/widget', stream: 'nope' })).toEqual([]);
	expect(await list({ repository: 'octo/widget', operation: 'promote' })).toEqual([]);
	expect(await list({ repository: 'octo/widget', version: '9.9.9' })).toEqual([]);
	expect(await list({ repository: 'octo/widget', states: `failed,${run.state}` })).toEqual([run.id]);
	expect(await list({ repository: 'octo/widget', states: 'failed' })).toEqual([]);
	expect(await list({ stream: 'main', states: 'succeeded', limit: 2 })).toHaveLength(2);
	await expect(list({ states: 'sideways' })).rejects.toThrow();
});
