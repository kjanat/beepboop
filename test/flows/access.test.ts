import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { experimental_AstroContainer } from 'astro/container';
import { z } from 'zod';
import { Store } from '@/automation/store';
import { errorEnvelope } from '@/contract/errors';
import { readiness } from '@/domain/repository';
import { loaders } from '@/server/loaders';
import { migrationFiles, migrationsDirectory, TestD1 } from '../support/d1.ts';
import { ownerId, type Repository } from '../support/github.ts';
import { bearer, field, type Reply, reply } from '../support/http.ts';
import { widget } from '../support/repositories.ts';
import { adminSubject, origin, World } from '../support/world.ts';

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

function refusal(response: Reply): { status: number; error: string } {
	return { status: response.status, error: errorEnvelope.parse(response.body).error };
}

async function badge(): Promise<string> {
	const data = await loaders.repositories({ env: world.env, actor: adminSubject });
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
	const record = await new Store(world.db).repository(repository.id);
	if (!record) throw new Error('Repository is not enrolled');
	return record;
}

test('a suspended repository refuses releases, survives refresh, and returns on unsuspend', async () => {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const api = bearer(world, await world.cliSession());
	await api('/api/repositories/discover', { repository: 'octo/widget' });
	const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
	expect((await api('/api/releases/plan', request)).status).toBe(200);
	expect(await badge()).toBe('ok Configured +prepare');

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

	world.advance(60_000);
	expect((await world.push(repository)).status).toBe(202);
	await world.wait(1_000);
	expect((await api('/api/repositories/discover', { repository: 'octo/widget' })).status).toBe(200);
	const refreshed = await stored(repository);
	expect(refreshed.updatedAt).toBeGreaterThan(suspendedAt);
	expect(readiness(refreshed)).toEqual({ kind: 'suspended', since: suspendedAt });
	expect(refreshed.diagnostics).toEqual([]);
	expect((await world.coordinator(repository).exportJournal()).find(entry => entry.key === 'access')?.value)
		.toEqual({ suspended: true });
	expect(field((await api('/api/repositories')).body, '0')).toMatchObject({ suspended: true });
	expect(refusal(await api('/api/releases/plan', request))).toEqual(refused);
	expect(world.github.dispatches).toEqual([]);
	expect(await badge()).toBe('warn App access unavailable');

	const document = z.object({ document: z.string() }).parse(
		await world.db.prepare('SELECT document FROM repositories WHERE id=?').bind(repository.id).first(),
	).document;
	const deployed = new TestD1(migrationFiles().filter(file => file < '0012'));
	await deployed.prepare(
		'INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
	).bind(repository.id, repository.name, document, refreshed.updatedAt, refreshed.updatedAt).run();
	deployed.sqlite.run(readFileSync(join(migrationsDirectory, '0012_repository_access.sql'), 'utf8'));
	const migrated = await new Store(deployed).repository(repository.id);
	expect(migrated && readiness(migrated)).toEqual({ kind: 'suspended', since: refreshed.updatedAt });

	expect((await installation('unsuspend')).status).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(field((await api('/api/repositories')).body, '0')).not.toHaveProperty('suspended');
	expect((await api('/api/releases/plan', request)).status).toBe(200);
	expect(await badge()).toBe('ok Configured +prepare');

	expect(
		(await world.webhook('installation_repositories', {
			action: 'removed',
			installation: { id: 77, account: { id: ownerId } },
			repositories_removed: [{ id: repository.id }],
		})).status,
	).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('suspended');
	expect(
		(await world.webhook('installation_repositories', {
			action: 'added',
			installation: { id: 77, account: { id: ownerId } },
			repositories_added: [{ id: repository.id }],
		})).status,
	).toBe(202);
	expect(readiness(await stored(repository)).kind).toBe('ready');
	expect(world.network.unrouted).toEqual([]);
});
