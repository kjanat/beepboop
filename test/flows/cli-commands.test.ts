import { beforeEach, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { call, cliTransport, discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import { editableConfiguration, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect, Schema, Struct } from 'effect';
import { app } from '@/cli/cli';
import type { Client } from '@/cli/client';
import { routes } from '@/contract/routes';
import type { ApiError } from '@/kernel/errors/domain-error.ts';
import { messageOf, statusOf } from '@/kernel/errors/domain-error.ts';
import type { Contract, Decoded, Encoded, ValidationContext } from '@/kernel/schema/structs.ts';
import {
	decodeSync,
	looseStruct,
	mapped,
	mutableArray,
	mutableStruct,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/kernel/schema/structs.ts';

let world: World, directory: string, client: Client, token: string;
eachWorld(created => {
	world = created;
});
eachDirectory('beepboop-commands-', created => {
	directory = created;
});
beforeEach(async () => {
	({ client, token } = await savedClient(world, directory));
});

async function modes(args: string[], started: string) {
	const tty = await runCli(args);
	expect([tty.exitCode, tty.stderr.join('')]).toEqual([0, '']);
	expect(tty.activity).toContainEqual({ type: 'spinner:start', text: started });
	expect(tty.activity.map(event => event.type)).toContain('spinner:succeed');
	const json = await runCli([...args, '--json']);
	expect(json.exitCode).toBe(0);
	const parsed: unknown = JSON.parse(json.stdout.join(''));
	expect([...json.stdout, ...json.stderr].join('')).not.toContain(started);
	const piped = await app.execute(args, { isTTY: false, env: {} });
	expect(piped.exitCode).toBe(0);
	expect([...piped.stdout, ...piped.stderr].join('')).not.toContain(started);
	expect(piped.stdout.join('')).toBe(tty.stdout.join(''));
	return { tty: tty.stdout.join(''), parsed };
}

async function preparation() {
	const repository = await discoveredWidget(world, token);
	const request = { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } };
	const plan = await Effect.runPromise(client.call(routes.releasesPlan, request));
	const prepared = await Effect.runPromise(
		client.call(routes.releasesPrepare, { ...request, sourceSha: plan.sourceSha, planId: plan.planId }),
	);
	return { repository, plan, prepared };
}

test('auth reports the session with a spinner, as JSON and piped, and logout revokes it', async () => {
	const { tty, parsed } = await modes(['auth', 'status'], `Checking your session with ${origin}`);
	expect(tty).toStartWith(`✔ Signed in to ${origin} as `);
	expect(parsed).toHaveProperty('subject');
	const out = await runCli(['auth', 'logout']);
	expect(out.activity).toEqual([
		{ type: 'spinner:start', text: 'Revoking this terminal session' },
		{ type: 'spinner:succeed', text: 'Session revoked' },
	]);
	expect(out.stdout.join('')).toBe('✔ Signed out.\n');
});

test('repositories list, show and discover render tables and keep JSON for scripts', async () => {
	const repository = await discoveredWidget(world, token);
	const head = world.github.head(repository);
	const listed = await modes(['repositories', 'list'], 'Listing enrolled repositories');
	expect(listed.tty).toBe(
		'repository   branch  commit        streams  problems\n'
			+ '-----------  ------  ------------  -------  --------\n'
			+ `octo/widget  main    ${head.slice(0, 12)}  main     none    \n`,
	);
	expect(listed.parsed).toEqual([expect.objectContaining({ name: 'octo/widget', sha: head })]);
	const shown = await modes(['repositories', 'show', repository.name], 'Reading octo/widget');
	expect(shown.tty).toContain(`octo/widget on main at ${head.slice(0, 12)}\n`);
	expect(shown.tty).toContain('stream  start workflow  bump             approval\n');
	expect(shown.tty).toContain('widget   npm       1.0.0    1.0.0      ✔ published\n');
	const discovered = await modes(['repositories', 'discover', repository.name], 'Inspecting octo/widget on GitHub');
	expect(discovered.parsed).toHaveProperty('sha', head);
});

test('repositories show names the workflow that starts releases', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main.start = [{ via: 'action', workflow: 'ship.yml' }];
	world.github.push(repository, { '.github/beepboop.json': JSON.stringify(configuration) }, 'Start from ship.yml');
	await call(routes.repositoriesDiscover, { repository: repository.name }, cliTransport(world, token));
	const shown = await runCli(['repositories', 'show', repository.name]);
	expect(shown.exitCode).toBe(0);
	expect(shown.stdout.join('')).toMatch(/\nmain {4}ship\.yml {7}/);
});

test('runs list, cancel and recover show each operation with its state', async () => {
	const { prepared } = await preparation();
	const short = prepared.id.slice(0, 12);
	const cwd = spyOn(process, 'cwd').mockReturnValue(directory);
	const listed = await modes(['runs', 'list'], 'Listing release operations').finally(() => cwd.mockRestore());
	expect(listed.tty).toContain(`${short}  octo/widget  main    prepare    1.0.1`);
	expect(listed.parsed).toEqual([expect.objectContaining({ id: prepared.id })]);
	const cancelled = await runCli(['runs', 'cancel', prepared.id]);
	expect(cancelled.activity).toContainEqual({ type: 'spinner:start', text: `Cancelling ${short}` });
	expect(cancelled.stdout.join('')).toContain(`○ cancelled ${short} octo/widget / main prepare 1.0.1 at `);
	const recovered = await runCli(['runs', 'recover', prepared.id, '--action', 'reconcile', '--json']);
	expect(JSON.parse(recovered.stdout.join(''))).toHaveProperty('id', prepared.id);
	expect(recovered.stderr.join('')).not.toContain('Reconciling');
});

test('releases plan prints the plan and the exact prepare command, and keeps JSON for scripts', async () => {
	const repository = await discoveredWidget(world, token);
	const head = world.github.head(repository);
	const planned = await modes(
		['releases', 'plan', repository.name, '--stream', 'main', '--releaseVersion', 'patch'],
		'Reading octo/widget',
	);
	const { planId } = await Effect.runPromise(
		client.call(routes.releasesPlan, { repositoryId: repository.id, stream: 'main', version: { bump: 'patch' } }),
	);
	expect(planned.tty).toBe(
		`Version 1.0.1 from ${head.slice(0, 12)}\n`
			+ 'edit package.json\n'
			+ `Prepare it with: beepboop releases prepare octo/widget --stream main --releaseVersion patch --sourceSha ${head} --planId ${planId}\n`,
	);
	expect(planned.parsed).toHaveProperty('planId', planId);
	expect(planned.parsed).toHaveProperty('starts', true);
	const prepared = await runCli([
		'releases',
		'prepare',
		repository.name,
		'--stream',
		'main',
		'--releaseVersion',
		'patch',
		'--sourceSha',
		head,
		'--planId',
		planId,
	]);
	expect(prepared.activity).toContainEqual({ type: 'spinner:start', text: 'Preparing octo/widget / main' });
	expect(prepared.stdout.join('')).toMatch(
		/^◷ (ready|running|succeeded|pending) [0-9a-f]{12} octo\/widget \/ main prepare 1\.0\.1 at /,
	);
	const listed = await Effect.runPromise(client.call(routes.executionsList, {}));
	expect(listed.map(execution => [execution.operation, execution.started])).toEqual([['prepare', undefined]]);
});

test('secrets and notifications list as tables, and adding and subscribing report the result', async () => {
	const secrets = await modes(['secrets', 'list'], 'Listing secrets and workflow access');
	expect(secrets.tty).toBe('No secrets are stored.\n');
	expect(secrets.parsed).toHaveProperty('credentials', []);
	await world.elevate();
	await call(
		routes.credentialsReplace,
		{ alias: 'hook', value: 'https://hooks.example/release', proof: 'proof', expectedVersion: null },
		cliTransport(world, token),
	);
	const stored = await modes(['secrets', 'list'], 'Listing secrets and workflow access');
	expect(stored.tty).toMatch(
		/^secret  version  state     stored\s*\n-+  -+  -+  -+\s*\nhook    1        ✔ active  \S+\n$/,
	);
	const added = await runCli(['notifications', 'add', '--name', 'Releases', '--kind', 'slack', '--secret', 'hook']);
	expect([added.exitCode, added.stderr.join('')]).toEqual([0, '']);
	expect(added.activity).toContainEqual({ type: 'spinner:start', text: 'Adding the slack destination Releases' });
	const id = /Added destination (\S+)\./.exec(added.stdout.join(''))?.[1] ?? '';
	expect(id).not.toBe('');
	const subscribed = await runCli(['notifications', 'subscribe', id, 'npm:widget', '--json']);
	expect(JSON.parse(subscribed.stdout.join(''))).toEqual({ destination: id, registry: 'npm', name: 'widget' });
	const listed = await modes(['notifications', 'list'], 'Listing notification destinations');
	expect(listed.tty).toContain('Releases');
	expect(listed.tty).toContain('npm:widget');
	expect(listed.parsed).toHaveProperty('destinations', [expect.objectContaining({ name: 'Releases' })]);
});

test('auth login shows the wait for browser approval, then signs in, as JSON and piped', async () => {
	const fresh = await world.cliSession();
	let answers = 0;
	world.network.serve(new URL(origin).host, request =>
		new URL(request.url).pathname === '/auth/cli/token'
			? (answers++ % 2 === 0 ? new Response(null, { status: 202 }) : Response.json({ token: fresh }))
			: world.handle(request));
	const pauses = spyOn(client, 'pause').mockReturnValue(Effect.void);
	const tty = await runCli(['auth', 'login', '--browser=false']);
	expect([tty.exitCode, tty.stderr.join('')]).toEqual([
		0,
		expect.stringMatching(/^Login page: https:\/\/\S+\/auth\/cli\/authorize\?challenge=\S+\nConfirm code: \S+\n$/),
	]);
	expect(tty.activity).toEqual([
		{ type: 'spinner:start', text: 'Waiting for you to approve this terminal in the browser' },
		{ type: 'spinner:update', text: 'Still waiting for your approval in the browser' },
		{ type: 'spinner:succeed', text: 'Approved in the browser' },
	]);
	expect(tty.stdout.join('')).toBe(`✔ Signed in to ${origin}.\n`);
	expect(pauses).toHaveBeenCalledWith(1500);
	const json = await runCli(['auth', 'login', '--browser=false', '--json']);
	expect(JSON.parse(json.stdout.join(''))).toEqual({ server: origin, signedIn: true });
	expect(json.stderr.join('')).not.toContain('Waiting for you');
	const piped = await app.execute(['auth', 'login', '--browser=false'], { isTTY: false, env: {} });
	expect(piped.exitCode).toBe(0);
	expect([...piped.stdout, ...piped.stderr].join('')).not.toContain('Waiting for you');
	expect(piped.stdout.join('')).toBe(`✔ Signed in to ${origin}.\n`);
});

test('secrets set reads the value from stdin, shows its read spinner and keeps none open for the security key', async () => {
	let open = 0;
	const elevated = spyOn(client, 'elevated').mockImplementation(() =>
		Effect.promise(async () => {
			open = 0;
			await world.elevate();
			return 'proof';
		})
	);
	const stored: string[] = [];
	world.network.serve(new URL(origin).host, async request => {
		if (new URL(request.url).pathname === '/api/credentials/replace') {
			stored.push(decodeSync(looseStruct({ value: Schema.String }), await request.clone().json()).value);
		}
		return world.handle(request);
	});
	const terminal = { isTTY: true, color: false, env: {} };
	const saved = await app.execute(['secrets', 'set', 'npm-token'], { ...terminal, stdinData: 'secret\n' });
	expect([saved.exitCode, saved.stderr.join('')]).toEqual([0, '']);
	expect(saved.stdout.join('')).toBe('✔ Saved npm-token as version 1.\n');
	expect(saved.activity).toEqual([
		{ type: 'spinner:start', text: 'Reading the stored versions of npm-token' },
		{ type: 'spinner:succeed', text: 'Read npm-token' },
	]);
	expect(elevated).toHaveBeenCalledTimes(1);
	expect(open).toBe(0);
	const replaced = await app.execute(['secrets', 'set', 'npm-token', '--json'], {
		...terminal,
		stdinData: 'rotated\r\n',
	});
	expect(JSON.parse(replaced.stdout.join(''))).toEqual({ alias: 'npm-token', version: 2 });
	const plain = await app.execute(['secrets', 'set', 'other-token'], { isTTY: false, env: {}, stdinData: 'value' });
	expect(plain.stdout.join('')).toBe('✔ Saved other-token as version 1.\n');
	expect(plain.stderr.join('')).toBe('');
	const prompted = await runCli(['secrets', 'set', 'npm-token'], [true, 'typed']);
	expect(prompted.exitCode).toBe(0);
	expect(prompted.stdout.join('')).toBe('✔ Saved npm-token as version 3.\n');
	const redirected = await app.execute(['secrets', 'set', 'npm-token'], {
		answers: [true, 'retyped'],
		isTTY: false,
		env: {},
	});
	expect([redirected.exitCode, redirected.stderr.join('')]).toEqual([0, '']);
	expect(redirected.stdout.join('')).toBe('✔ Saved npm-token as version 4.\n');
	const padded = await app.execute(['secrets', 'set', 'npm-token'], { ...terminal, stdinData: '  padded \t\n' });
	expect(padded.stdout.join('')).toBe('✔ Saved npm-token as version 5.\n');
	expect([...new Set(stored)]).toEqual(['secret', 'rotated', 'value', 'typed', 'retyped', '  padded \t']);
	const untyped = await app.execute(['secrets', 'set', 'empty-token'], terminal);
	expect(untyped.exitCode).not.toBe(0);
	expect(untyped.stderr.join('')).toContain('Secret value is empty');
	const empty = await app.execute(['secrets', 'set', 'empty-token'], { isTTY: false, env: {}, stdinData: '\n' });
	expect(empty.exitCode).not.toBe(0);
	expect(empty.stderr.join('')).toContain('Secret value is empty');
});

test('secrets set refuses a value on the command line and leaves it out of help', async () => {
	const refused = await app.execute(['secrets', 'set', 'npm-token', '--value', 'secret'], {
		isTTY: false,
		env: {},
		stdinData: 'secret',
	});
	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr.join('')).toContain('Unknown flag --value');
	expect(refused.stderr.join('')).not.toContain('secret');
	expect(refused.stdout.join('')).toBe('');
	const help = await app.execute(['secrets', 'set', '--help'], { isTTY: false, env: {} });
	expect(help.stdout.join('')).not.toContain('--value');
	const listed = await Effect.runPromise(client.call(routes.credentialsList, {}));
	expect(listed.credentials).toEqual([]);
});

async function independent() {
	const repository = await discoveredWidget(world, token);
	world.npm.publish('gadget', '2.0.0');
	world.github.push(repository, {
		'packages/gadget/package.json': JSON.stringify({
			name: 'gadget',
			version: '2.0.0',
			description: 'A second package',
			license: 'MIT',
			repository: 'https://github.com/octo/example',
		}),
		'packages/gadget/README.md': '# gadget\n',
		'packages/gadget/LICENSE': 'MIT\n',
		'.github/beepboop.json': JSON.stringify({
			managers: ['npm', 'workflow'],
			streams: {
				main: {
					versioning: 'independent',
					packages: ['pkg:npm/widget', 'pkg:npm/gadget'],
					required: ['pkg:npm/widget', 'pkg:npm/gadget'],
					prepare: { strategy: 'managed' },
					promote: {
						approval: 'required',
						workflow: { file: 'publish.yml', publications: ['pkg:npm/widget', 'pkg:npm/gadget'] },
					},
				},
			},
		}),
	}, 'Release the packages independently');
	await Effect.runPromise(client.call(routes.repositoriesDiscover, { repository: repository.name }));
	const plan = join(directory, 'release-plan.json');
	await Bun.write(
		plan,
		JSON.stringify({
			groups: [
				{ id: 'widget', packages: ['pkg:npm/widget'], version: { bump: 'minor' } },
			],
			operations: [{ id: 'promote', group: 'widget' }],
		}),
	);
	return { repository, plan };
}

test('releases plan-set, prepare-set and start show the release set with spinners, tables and JSON', async () => {
	const { repository, plan } = await independent();
	const args = ['releases', 'plan-set', repository.name, '--stream', 'main', '--plan', plan];
	const planned = await modes(args, 'Reading octo/widget');
	expect(planned.tty).toContain('Release set from ');
	expect(planned.tty).toContain(
		'group   version  packages      \n------  -------  --------------\nwidget  1.1.0    pkg:npm/widget\n',
	);
	const reviewed = decodeSync(mutableStruct({ sourceSha: Schema.String, planId: Schema.String }), planned.parsed);
	expect(planned.tty).toContain(
		`Prepare it with: beepboop releases prepare-set octo/widget --stream main --plan ${plan} --sourceSha ${reviewed.sourceSha} --planId ${reviewed.planId}\n`,
	);
	const prepared = await runCli([
		'releases',
		'prepare-set',
		...args.slice(2),
		'--sourceSha',
		reviewed.sourceSha,
		'--planId',
		reviewed.planId,
	]);
	expect([prepared.exitCode, prepared.stderr.join('')]).toEqual([0, '']);
	expect(prepared.activity).toContainEqual({ type: 'spinner:start', text: 'Preparing octo/widget / main' });
	const preparation = /[◷✔] \S+ ([0-9a-f]{12}) octo\/widget \/ main prepare/.exec(prepared.stdout.join(''))?.[1];
	expect(preparation).toBeDefined();
	await world.wait(16_000);
	const [pull] = repository.pulls;
	if (!pull) throw new Error('The release set opened no PR');
	const merged = world.github.merge(repository, pull.number);
	const id = (await Effect.runPromise(client.call(routes.executionsList, {})))
		.find(row => row.operation === 'prepare')?.id ?? '';
	expect(preparation).toBe(id.slice(0, 12));
	const startArgs = ['releases', 'start', id, '--sourceSha', merged.sha];
	const started = await runCli(startArgs);
	expect([started.exitCode, started.stderr.join('')]).toEqual([0, '']);
	expect(started.activity).toContainEqual({
		type: 'spinner:start',
		text: `Starting the release set ${id.slice(0, 12)} at ${merged.sha.slice(0, 12)}`,
	});
	expect(started.stdout.join('')).toMatch(
		/^id {12}repository {3}stream {2}operation {2}version {2}commit {8}state\s*\n/,
	);
	expect(started.stdout.join('')).toContain('octo/widget  main    promote    1.1.0    ');
	const json = await runCli([...startArgs, '--json']);
	expect(Array.isArray(JSON.parse(json.stdout.join('')))).toBe(true);
	const piped = await app.execute(startArgs, { isTTY: false, env: {} });
	expect(piped.exitCode).toBe(0);
	expect([...piped.stdout, ...piped.stderr].join('')).not.toContain('Starting the release set');
});

for (
	const problem of [
		{ code: 'internal', incident: '14eaa401-e904-49ac-888f-8a1c91a10eaa' },
		{ code: 'upstream', service: 'registry', retryable: true },
		{
			code: 'precondition',
			diagnostics: [{ code: 'license-missing', severity: 'blocking', message: 'widget lacks a license' }],
		},
	] satisfies ApiError[]
) {
	test(`approval exposes structured ${problem.code} diagnostics through DreamCLI`, async () => {
		const status = statusOf[problem.code];
		const message = messageOf(problem);
		const args = ['runs', 'approve', '3ff28b790954', '--sourceSha', '34bcd339d829'];
		const respond = () =>
			spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: message, problem }, { status }));
		respond();
		const normal = await runCli(args);
		expect(normal.exitCode).toBe(1);
		expect(normal.stderr.join('')).toContain(message);
		expect(normal.stderr.join('')).not.toContain('"status"');
		respond();
		const verbose = await runCli([...args, '--verbose']);
		expect(verbose.exitCode).toBe(1);
		expect(verbose.stderr.join('')).toContain(JSON.stringify({ status, problem }, null, 2));
		expect(verbose.stderr.join('')).toContain(message);
		respond();
		const json = await runCli([...args, '--verbose', '--json']);
		expect(json.exitCode).toBe(1);
		expect(JSON.parse(json.stdout.join('')).error).toMatchObject({ message, details: { status, problem } });
		expect(json.stderr.join('')).toBe('');
	});
}
