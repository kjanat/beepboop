import { expect, expectTypeOf, test } from 'bun:test';
import { join } from 'node:path';
import { TestD1 } from '@root/test/support/d1.ts';
import { origin } from '@root/test/support/world.ts';
import { experimental_AstroContainer } from 'astro/container';
import { Effect, Schema } from 'effect';
import type { Actor } from '@/domain/audit';
import { actorLabel, parseActor } from '@/domain/audit';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import { AuditStore } from '@/persistence/d1/audit';

type Shown = { kind: 'admin' } | { kind: 'run'; runId: number } | { kind: 'system'; component: string };

interface Case {
	readonly input: string;
	readonly shown: Shown;
	readonly stored: Actor;
}

const admin = (subject: string): Case => ({
	input: subject,
	shown: { kind: 'admin' },
	stored: { kind: 'admin', subject },
});

const agreed: readonly Case[] = [
	{ input: 'run:7', shown: { kind: 'run', runId: 7 }, stored: { kind: 'run', runId: 7 } },
	{ input: 'run:42', shown: { kind: 'run', runId: 42 }, stored: { kind: 'run', runId: 42 } },
	{
		input: 'beepboop',
		shown: { kind: 'system', component: 'beepboop' },
		stored: { kind: 'system', component: 'beepboop' },
	},
	{ input: 'winget', shown: { kind: 'system', component: 'winget' }, stored: { kind: 'system', component: 'winget' } },
	admin('run:0'),
	admin('run:07'),
	admin('run:'),
	admin('run:abc'),
	admin('run:5:7'),
	admin('run:12:7:0'),
	admin('run:12:7:02'),
	admin('run:12:0:2'),
	admin('run:0:7:1'),
	admin('run:07:7:1'),
	admin('run:1:2:3:4'),
	admin('run:9007199254740993'),
	admin(`run:${'9'.repeat(400)}`),
	admin('run:9007199254740993:7:2'),
	admin('run:12:9007199254740993:2'),
	admin('run:12:7:9007199254740993'),
	admin(' run:7'),
	admin('run:7\n'),
	admin('setup:'),
	admin('Beepboop'),
	admin('github|1234'),
	admin(''),
];

const widened: readonly Case[] = [
	{
		input: 'run:12:7:2',
		shown: { kind: 'admin' },
		stored: { kind: 'run', runId: 7, repositoryId: 12, attempt: 2 },
	},
	{ input: 'setup:exec-1', shown: { kind: 'admin' }, stored: { kind: 'setup', execution: 'exec-1' } },
	{ input: 'setup:a:b', shown: { kind: 'admin' }, stored: { kind: 'setup', execution: 'a:b' } },
];

function shown(actor: Actor): Shown {
	switch (actor.kind) {
		case 'run':
			return { kind: 'run', runId: actor.runId };
		case 'system':
			return { kind: 'system', component: actor.component };
		default:
			return { kind: 'admin' };
	}
}

test('parseActor returns the actor_json the audit parser stored for each listed input', () => {
	expect([...agreed, ...widened].map(({ input }) => [input, JSON.stringify(parseActor(input))])).toEqual(
		[...agreed, ...widened].map(({ input, stored }) => [input, JSON.stringify(stored)]),
	);
});

test('parseActor shows each actor the activity parser recognised the same way', () => {
	expect(agreed.map(({ input }) => [input, shown(parseActor(input))])).toEqual(
		agreed.map(({ input, shown }) => [input, shown]),
	);
});

test('the activity log names credential reads by a workflow run and by setup', () => {
	expect(widened.map(({ input }) => actorLabel(parseActor(input)))).toEqual([
		'Workflow run 7',
		'Beepboop setup',
		'Beepboop setup',
	]);
	expect(agreed.map(({ input }) => actorLabel(parseActor(input)))).toEqual([
		'Workflow run 7',
		'Workflow run 42',
		'Beepboop',
		'WinGet automation',
		...Array.from({ length: 22 }, () => 'Administrator'),
	]);
});

test('the largest exact run identifiers stay run actors', () => {
	const largest = Number.MAX_SAFE_INTEGER;
	expect(parseActor(`run:${largest}`)).toEqual({ kind: 'run', runId: largest });
	expect(parseActor(`run:${largest}:${largest}:${largest}`)).toEqual({
		kind: 'run',
		runId: largest,
		repositoryId: largest,
		attempt: largest,
	});
});

test('a run actor carries its repository and attempt together or not at all', () => {
	type Run = Extract<Actor, { kind: 'run' }>;
	expectTypeOf<{ kind: 'run'; runId: number; attempt: number }>().not.toExtend<Run>();
	expectTypeOf<{ kind: 'run'; runId: number; repositoryId: number }>().not.toExtend<Run>();
	expectTypeOf<{ kind: 'run'; runId: number }>().toExtend<Run>();
	expectTypeOf<{ kind: 'run'; runId: number; repositoryId: number; attempt: number }>().toExtend<Run>();
});

test('the audit table stores the parsed actor and the activity table renders it', async () => {
	const db = new TestD1();
	const store = new AuditStore(db);
	const records = [
		['run:12:7:2', 'credential.read', 'octo/widget'],
		['run:9007199254740993', 'credential.read', 'octo/widget'],
		['setup:exec-1', 'credential.read', 'octo/widget'],
	] as const;
	for (const [actor, action, target] of records) await Effect.runPromise(store.record(actor, action, target));

	const stored = db.sqlite.query('SELECT actor, actor_json FROM audit ORDER BY rowid').all();
	expect(stored).toEqual([
		{ actor: 'run:12:7:2', actor_json: '{"kind":"run","runId":7,"repositoryId":12,"attempt":2}' },
		{ actor: 'run:9007199254740993', actor_json: '{"kind":"admin","subject":"run:9007199254740993"}' },
		{ actor: 'setup:exec-1', actor_json: '{"kind":"setup","execution":"exec-1"}' },
	]);

	type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
	const module = mutableStruct({
		default: Schema.declare<Component>((value): value is Component => typeof value === 'function'),
	});
	const loaded: unknown = await import(join(import.meta.dir, '../../src/components/Activity.astro'));
	const activity = await Effect.runPromise(store.recent());
	const html = await (await experimental_AstroContainer.create()).renderToString(decodeSync(module, loaded).default, {
		props: { data: { section: 'activity', activity } },
		request: new Request(`${origin}/activity`),
	});
	expect(html).toContain('Workflow run 7');
	expect(html).toContain('https://github.com/octo/widget/actions/runs/7');
	expect(html).toContain('Beepboop setup');
	expect(html).not.toContain('Workflow run 9007199254740992');
	expect(html).not.toContain('Infinity');
	expect(html).toContain('Administrator');
});
