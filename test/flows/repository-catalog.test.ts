import { expect, test } from 'bun:test';
import { discoveredWidget } from '@root/test/support/client.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect, Logger, Schema } from 'effect';
import { Automation } from '@/automation/service';
import { RepositoryStore } from '@/discovery/adapters/d1/repositories.ts';
import type { CatalogSources } from '@/discovery/repositories/catalog.ts';
import { RepositoryCatalog } from '@/discovery/repositories/catalog.ts';
import type { RepositoryRecord, Snapshot } from '@/domain/inventory.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

let world: World;
eachWorld(created => {
	world = created;
});

const snapshots: Record<string, Snapshot> = {
	'octo/widget': {
		repository: { id: 11, name: 'octo/widget', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files: {},
		paths: [],
	},
	'other/widget': {
		repository: { id: 12, name: 'other/widget', defaultBranch: 'main' },
		sha: 'b'.repeat(40),
		files: {},
		paths: [],
	},
};

interface Calls {
	woken: number[];
	refreshed: { name: string; repository: RepositoryRecord }[];
	inferred: number;
}

function catalog(overrides: Partial<CatalogSources> = {}) {
	const calls: Calls = { woken: [], refreshed: [], inferred: 0 };
	const sources: CatalogSources = {
		store: new RepositoryStore(world.db),
		installation: () => Effect.succeed('active'),
		identify: name => Effect.succeed(snapshots[name]?.repository.id ?? 0),
		snapshot: name => {
			const snapshot = snapshots[name.toLowerCase()];
			return snapshot ? Effect.succeed(snapshot) : Effect.fail(precondition(`No snapshot for ${name}`));
		},
		preset: () => Effect.fail(precondition('No presets')),
		inferConfiguration: () =>
			Effect.sync(() => {
				calls.inferred++;
			}).pipe(Effect.andThen(Effect.fail(precondition('Inference failed')))),
		setupPullOpen: () => Effect.succeed(false),
		resolvePublished: inventory => Effect.succeed(inventory),
		wake: id => Effect.sync(() => void calls.woken.push(id)),
		refreshed: (name, repository) => Effect.sync(() => void calls.refreshed.push({ name, repository })),
		...overrides,
	};
	return { catalog: new RepositoryCatalog(sources), calls };
}

function run<A>(effect: Effect.Effect<A, DomainError>): Promise<A> {
	return Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([]))));
}

function failure<A>(effect: Effect.Effect<A, DomainError>): Promise<DomainError> {
	return Effect.runPromise(Effect.flip(effect).pipe(Effect.provide(Logger.layer([]))));
}

test('refresh saves an unconfigured repository after a failed inference and hands it on', async () => {
	const { catalog: closed, calls } = catalog();
	const saved = await run(closed.refresh('OCTO/widget', 11));
	expect(calls.inferred).toBe(1);
	expect(saved.diagnostics.map(entry => entry.message)).toEqual([
		'Not configured yet. Configure releases opens a setup pull request.',
	]);
	expect(calls.refreshed.map(entry => [entry.name, entry.repository.name])).toEqual([['OCTO/widget', 'octo/widget']]);
	expect((await run(closed.get(11)))?.sha).toBe('a'.repeat(40));

	const { catalog: open } = catalog({ setupPullOpen: () => Effect.succeed(true) });
	const pending = await run(open.refresh('octo/widget', 11));
	expect(pending.diagnostics.map(entry => entry.message)).toEqual([
		'The setup pull request is open. Merge it to enable releases.',
	]);
});

test('setAccess wakes the coordinator only when the stored access changes', async () => {
	const { catalog: repositories, calls } = catalog();
	await run(repositories.refresh('octo/widget', 11));
	await run(repositories.setAccess(11, { kind: 'active' }));
	expect(calls.woken).toEqual([]);
	await run(repositories.setAccess(11, { kind: 'suspended', since: 5 }));
	await run(repositories.setAccess(11, { kind: 'suspended', since: 9 }));
	expect(calls.woken).toEqual([11]);
	expect((await run(repositories.get(11)))?.access).toEqual({ kind: 'suspended', since: 5 });
});

test('resolve asks for the owner when two enrolled repositories share a name', async () => {
	const { catalog: repositories } = catalog();
	await run(repositories.refresh('octo/widget', 11));
	await run(repositories.refresh('other/widget', 12));
	expect((await failure(repositories.resolve('widget'))).message).toMatch(
		/^Repository widget matches (?:octo\/widget, other\/widget|other\/widget, octo\/widget); name the owner$/,
	);
	expect((await run(repositories.resolve('Other/Widget'))).id).toBe(12);
	const missing = await failure(repositories.resolve('gadget'));
	expect([missing.problem.code, missing.message]).toEqual([
		'not-found',
		'Repository gadget is not enrolled; run beepboop repositories discover gadget',
	]);
});

test('a failed setup step after a refresh is audited and the refresh still saves', async () => {
	const repository = await discoveredWidget(world, await world.cliSession());
	await world.db.prepare('INSERT INTO onboarding(repository_id,document) VALUES(?,?)').bind(repository.id, '{').run();
	const refreshed = await world.run(
		Automation.use(service => service.catalog.refresh(repository.name, repository.id)),
	);
	expect(refreshed.name).toBe(repository.name);
	const audited = await world.db.prepare("SELECT target FROM audit WHERE action='repository.setup.failed'").all();
	const targets = decodeSync(mutableArray(mutableStruct({ target: Schema.String })), audited.results);
	expect(targets.map(row => row.target.split(':')[0])).toEqual([repository.name]);
});

test('discover keeps an enrolled repository and suspends it when the App loses access', async () => {
	const { catalog: active } = catalog();
	await run(active.discover('octo/widget', undefined));
	const { catalog: suspended, calls } = catalog({ installation: () => Effect.succeed('suspended') });
	const kept = await run(suspended.discover('octo/widget', 11));
	expect(kept.access.kind).toBe('suspended');
	expect(calls.woken).toEqual([11]);
	expect((await failure(suspended.discover('octo/gadget', undefined))).message).toBe(
		'GitHub App access to octo/gadget is suspended',
	);
});
