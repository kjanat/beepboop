import { expect, test } from 'bun:test';
import type { Actor } from '@/domain/audit';
import { actorLabel, parseActor } from '@/domain/audit';

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

test('parseActor returns the actor_json the audit parser stored for every input', () => {
	expect([...agreed, ...widened].map(({ input }) => [input, JSON.stringify(parseActor(input))])).toEqual(
		[...agreed, ...widened].map(({ input, stored }) => [input, JSON.stringify(stored)]),
	);
});

test('parseActor shows every actor the activity parser recognised the same way', () => {
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
		...Array.from({ length: 17 }, () => 'Administrator'),
	]);
});
