import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer } from 'astro/container';
import { Effect } from 'effect';
import { z } from 'zod';
import { AutomationService } from '@/automation/service';
import { Store } from '@/automation/store';
import { errorEnvelope } from '@/contract/errors';
import { readiness } from '@/domain/repository';
import { loaders } from '@/server/loaders';
import { migrationFiles, migrationsDirectory, TestD1 } from '@root/test/support/d1.ts';
import { ownerId, type Repository } from '@root/test/support/github.ts';
import { bearer, field, type Reply, reply, text } from '@root/test/support/http.ts';
import { widget } from '@root/test/support/repositories.ts';
import { adminSubject, origin, World } from '@root/test/support/world.ts';

type Component = Parameters<experimental_AstroContainer['renderToString']>[0];
const componentModule = z.object({ default: z.custom<Component>(value => typeof value === 'function') });
const repositoriesComponent = join(import.meta.dir, '../../src/components/Repositories.astro');

let world: World;
beforeEach(async () => {
	world = await World.create();
});
afterEach(() => world.dispose());

function installation(action: string, extra: Record<string, unknown> = {}): Promise<Response> {
	return world.webhook('installation', { action, installation: { id: 77, account: { id: ownerId } }, ...extra });
}

function repositories(action: string, extra: Record<string, unknown>): Promise<Response> {
	return world.webhook('installation_repositories', {
		action,
		installation: { id: 77, account: { id: ownerId } },
		...extra,
	});
}

async function journalAccess(repository: Repository): Promise<unknown> {
	return (await world.coordinator(repository).exportJournal()).find(entry => entry.key === 'access')?.value;
}

function refusal(response: Reply): { status: number; error: string } {
	return { status: response.status, error: errorEnvelope.parse(response.body).error };
}

async function badge(): Promise<string> {
	const data = await Effect.runPromise(loaders.repositories({ env: world.env, actor: adminSubject }));
	const loaded: unknown = await import(repositoriesComponent);
	const container = await experimental_AstroContainer.create();
	const html = await container.renderToString(componentModule.parse(loaded).default, {
		props: { data },
		request: new Request(`${origin}/repositories`),
	});
	const label = /<span class="badge" data-tone="(\w+)">([^<]+)<\/span>/.exec(html);
	return `${label?.[1]} ${label?.[2]}${html.includes('Prepare a release') ? ' +prepare' : ''}`;
}

async function stored(repository: Repository) {
	const record = await Effect.runPromise(new Store(world.db).repository(repository.id));
	if (!record) throw new Error('Repository is not enrolled');
	return record;
}

test('a suspended repository refuses releases and returns only where GitHub restored access', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	expect((await api('/api/releases/plan', request)).status).toBe(200);
	expect(await badge()).toBe('ok Configured +prepare');

	world.github.suspend();
	expect((await installation('suspend')).status).toBe(202);
	const suspendedAt = Date.now();
	const refused = { status: 422, error: 'GitHub App access to octo/widget is suspended or removed' };
	expect(refusal(await api('/api/releases/plan', request))).toEqual(refused);
	expect(refusal(await api('/api/releases/plan-set', { ...request, plan: { groups: [] } }))).toEqual(refused);
	expect(refusal(await api('/api/releases/prepare', { ...request, sourceSha: 'a'.repeat(40), planId: 'x' })))
		.toEqual(refused);
	const begin = await reply(
		await world.handle(
			new Request(`${origin}/api/workflow/begin`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${await world.runToken({
						repository,
						runId: 9,
						sha: world.github.head(repository),
						file: 'publish.yml',
					})}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ stream: 'main', operation: 'promote' }),
			}),
		),
	);
	expect(refusal(begin)).toEqual({ status: 403, error: 'Repository is not enrolled or has been suspended' });
	expect(readiness(await stored(repository))).toEqual({ kind: 'suspended', since: suspendedAt });
	expect(await badge()).toBe('warn App access unavailable');

	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	expect(readiness(await stored(repository))).toEqual({ kind: 'suspended', since: suspendedAt });
	expect(await journalAccess(repository)).toEqual({ suspended: true });
	expect(field((await api('/api/repositories')).body, '0')).toMatchObject({ suspended: true });
	expect(refusal(await api('/api/releases/plan', request))).toEqual(refused);
	expect(world.github.dispatches).toEqual([]);
	expect(await badge()).toBe('warn App access unavailable');
	const gadget = world.github.create('octo/gadget', { 'README.md': '# gadget\n' });
	expect(refusal(await api('/api/repositories/discover', { repository: 'octo/gadget' }))).toEqual({
		status: 422,
		error: 'GitHub App access to octo/gadget is suspended',
	});

	world.github.unsuspend();
	expect((await installation('unsuspend')).status).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(field((await api('/api/repositories')).body, '0')).not.toHaveProperty('suspended');
	expect((await api('/api/releases/plan', request)).status).toBe(200);
	expect(await badge()).toBe('ok Configured +prepare');

	world.github.uninstall(repository);
	expect((await repositories('removed', { repositories_removed: [{ id: repository.id }] })).status).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('suspended');
	world.github.suspend();
	expect((await installation('suspend')).status).toBe(202);
	world.github.unsuspend();
	expect((await installation('unsuspend')).status).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('suspended');
	expect(await badge()).toBe('warn App access unavailable');
	world.github.uninstall(gadget);
	expect(refusal(await api('/api/repositories/discover', { repository: 'octo/gadget' }))).toEqual({
		status: 404,
		error: 'The GitHub App is not installed on octo/gadget',
	});
	world.github.install(repository);
	expect((await repositories('added', { repositories_added: [{ id: repository.id }] })).status).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('ready');

	const legacy = z.record(z.string(), z.unknown()).parse(JSON.parse(
		z.object({ document: z.string() }).parse(
			await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(repository.id).first(),
		).document,
	));
	const finding = { code: 'unsupported', severity: 'blocking', message: 'App access removed or suspended' };
	world.advance(60_000);
	await world.db.prepare(
		'INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
	).bind(
		repository.id,
		repository.name,
		JSON.stringify({
			...legacy,
			suspended: true,
			diagnostics: [finding.message],
			findings: [finding],
			updatedAt: Date.now(),
		}),
		Date.now(),
		Date.now(),
	).run();
	expect(readiness(await stored(repository))).toEqual({ kind: 'suspended', since: Date.now() });
	expect(await badge()).toBe('warn App access unavailable');
	expect((await installation('unsuspend')).status).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(await badge()).toBe('ok Configured +prepare');
	expect(world.network.unrouted).toEqual([]);
});

test('a lost unsuspend webhook leaves refresh suspended until discover asks GitHub', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	world.github.suspend();
	expect((await installation('suspend')).status).toBe(202);
	const suspendedAt = Date.now();
	world.github.unsuspend();

	world.advance(60_000);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	const refreshed = await stored(repository);
	expect(refreshed.updatedAt).toBeGreaterThan(suspendedAt);
	expect(readiness(refreshed)).toEqual({ kind: 'suspended', since: suspendedAt });
	expect(refreshed.diagnostics).toEqual([]);
	expect(await journalAccess(repository)).toEqual({ suspended: true });

	const document = z.object({ document: z.string() }).parse(
		await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(repository.id).first(),
	).document;
	const deployed = new TestD1(migrationFiles().filter(file => file < '0012'));
	await deployed.prepare(
		'INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
	).bind(repository.id, repository.name, document, refreshed.updatedAt, refreshed.updatedAt).run();
	deployed.sqlite.run(readFileSync(join(migrationsDirectory, '0012_repository_access.sql'), 'utf8'));
	const migrated = await Effect.runPromise(new Store(deployed).repository(repository.id));
	expect(migrated && readiness(migrated)).toEqual({ kind: 'suspended', since: refreshed.updatedAt });

	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(await journalAccess(repository)).toEqual({ suspended: false });
	expect((await api('/api/releases/plan', { repositoryId: repository.id, stream: 'main', version: '1.1.0' })).status)
		.toBe(200);
	expect(world.network.unrouted).toEqual([]);
});

test('discover and the cron refresh rewrite a repository row that no longer decodes', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	const corrupt = () =>
		world.db.prepare('UPDATE repositories SET document=? WHERE id=?').bind('{"broken":true}', repository.id).run();

	await corrupt();
	expect((await api('/api/repositories/resolve', { repository: 'widget' })).status).toBe(500);
	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(text((await api('/api/repositories/resolve', { repository: 'widget' })).body, 'name')).toBe('octo/widget');

	await corrupt();
	await Effect.runPromise(new AutomationService(world.env).scheduled());
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(world.network.unrouted).toEqual([]);
});
