import { beforeEach, expect, test } from 'bun:test';
import { runCli, savedClient } from '@root/test/support/cli.ts';
import { call, cliTransport, discoveredWidget } from '@root/test/support/client.ts';
import { eachDirectory } from '@root/test/support/directories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { app } from '@/cli/cli';
import type { Client } from '@/cli/client';
import { routes } from '@/contract/routes';

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
	expect(shown.tty).toContain('stream  starts  bump             approval\n');
	expect(shown.tty).toContain('widget   npm       1.0.0    1.0.0      ✔ published\n');
	const discovered = await modes(['repositories', 'discover', repository.name], 'Inspecting octo/widget on GitHub');
	expect(discovered.parsed).toHaveProperty('sha', head);
});

test('runs list, cancel and recover show each operation with its state', async () => {
	const { prepared } = await preparation();
	const short = prepared.id.slice(0, 12);
	const listed = await modes(['runs', 'list'], 'Listing release operations');
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
