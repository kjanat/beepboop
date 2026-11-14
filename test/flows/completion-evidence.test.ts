import { expect, spyOn, test } from 'bun:test';
import { TestD1 } from '@root/test/support/d1';
import { Effect } from 'effect';
import { Store } from '@/automation/store';
import { compare, precedenceKey } from '@/contract/semver';
import { ProjectionBackfill } from '@/persistence/d1/backfill';
import type { Projection } from '@/persistence/d1/projection';
import { ProjectionStore } from '@/persistence/d1/projection';

const candidate = { repositoryId: 1, stream: 'main', state: 'failed' as const, version: '1.0.0', updatedAt: 1 };
function projection(id: string, version: string, at: number, group?: string): Projection {
	return {
		entity: 'release',
		id,
		repositoryId: 1,
		revision: 1,
		updatedAt: at,
		document: JSON.stringify({
			id,
			source: 'octo/widget',
			event: 'release',
			occurredAt: at,
			release: {
				id,
				repository: { id: 1, name: 'octo/widget' },
				stream: 'main',
				commit: 'source',
				version,
				group,
				publications: [],
				artifacts: Array.from({ length: 30 }, (_, n) => ({
					id: n,
					runId: 1,
					name: `widget-platform-${n}`,
					digest: `sha256:${'a'.repeat(64)}`,
					expiresAt: '2026-12-14T00:00:00Z',
				})),
			},
		}),
	};
}

test('binary completion keys preserve arbitrary precision SemVer precedence and ignore build metadata', () => {
	const versions = [
		'0.0.0',
		'1.0.0-0',
		'1.0.0-1',
		'1.0.0-2',
		'1.0.0-10',
		'1.0.0-alpha',
		'1.0.0-alpha.1',
		'1.0.0-alpha.2',
		'1.0.0-alpha.10',
		'1.0.0-alpha.beta',
		'1.0.0-alpha-beta',
		'1.0.0-beta',
		'1.0.0-rc.1',
		'1.0.0',
		'1.0.0+build.1',
		'1.0.1',
		'1.2.0',
		'1.10.0',
		'9.0.0',
		'10.0.0',
		'99999999999999999999999999999.0.0',
		'100000000000000000000000000000.0.0',
	];
	for (const a of versions) {
		for (const b of versions) {
			const x = precedenceKey(a)!, y = precedenceKey(b)!;
			expect(x === y ? 0 : x < y ? -1 : 1).toBe(compare(a, b));
		}
	}
	expect(precedenceKey('v1.0.0')).toBe(precedenceKey('1.0.0'));
	for (const invalid of ['', '01.0.0', '1.0.0-01', 'foo', '1.2']) expect(precedenceKey(invalid)).toBeUndefined();
});

for (const legacy of [false, true]) {
	test(`completion evidence returns a bounded indexed proof across 1000 ${legacy ? 'legacy' : 'projected'} releases`, async () => {
		const db = new TestD1();
		try {
			const rows = Array.from({ length: 1000 }, (_, i) => projection(`release-${i}`, `2.${i}.0`, i + 10));
			if (legacy) {
				const insert = db.prepare(
					'INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,?,?,?,?)',
				);
				await db.batch(
					rows.map(row => insert.bind(row.id, row.repositoryId, row.revision, row.document, row.updatedAt)),
				);
			} else await Effect.runPromise(new ProjectionStore(db).apply(rows));
			const store = new Store(db);
			if (legacy) await Effect.runPromise(new ProjectionBackfill(db).drain());
			db.reset();
			const proof = await Effect.runPromise(store.completionEvidence([candidate]));
			expect(proof).toEqual([{ repositoryId: 1, stream: 'main', version: '2.999.0', completedAt: 1009 }]);
			expect(db.queries.length).toBeLessThan(30);
			db.reset();
			expect(await Effect.runPromise(store.completionEvidence(Array.from({ length: 200 }, () => candidate)))).toEqual(
				proof,
			);
			expect(db.queries).toHaveLength(3);
			const query = db.queries.at(-1)!;
			const returned = db.sqlite.query(query.sql).all(...query.values);
			expect(returned).toHaveLength(1);
			expect(JSON.stringify(returned).length).toBeLessThan(256);
			const plan = JSON.stringify(db.sqlite.query(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values));
			expect(plan).toContain('release_completion_frontier_lookup');
			expect(query.sql).not.toContain('document');
			db.reset();
			expect(await Effect.runPromise(store.completionEvidence([{ ...candidate, state: 'succeeded' }]))).toEqual([]);
			expect(db.queries).toHaveLength(0);
		} finally {
			db.sqlite.close();
		}
	});
}

test('completion proof respects version, group, time, repository and corrupt history boundaries', async () => {
	const db = new TestD1();
	try {
		const projections = new ProjectionStore(db), store = new Store(db);
		await Effect.runPromise(projections.apply([
			projection('old-high', '99.0.0', 1),
			projection('equal-build', '1.0.0+build', 50),
			projection('pre', '2.0.0-rc.1', 60),
			projection('grouped', '9.0.0', 100, 'other'),
			{ ...projection('bad', '50.0.0', 200), document: '{invalid' },
		]));
		expect(await Effect.runPromise(store.completionEvidence([candidate]))).toEqual([
			{ repositoryId: 1, stream: 'main', version: '2.0.0-rc.1', completedAt: 60 },
		]);
		for (const changed of [{ version: '2.0.0' }, { updatedAt: 60 }, { repositoryId: 2 }, { stream: 'other' }]) {
			expect(await Effect.runPromise(store.completionEvidence([{ ...candidate, ...changed }]))).toEqual([]);
		}
		expect(await Effect.runPromise(store.completionEvidence([{ ...candidate, version: 'invalid' }]))).toHaveLength(1);
		const old = projection('legacy-time', '3.0.0', 20);
		const event = JSON.parse(old.document);
		delete event.occurredAt;
		old.document = JSON.stringify(event);
		await Effect.runPromise(projections.apply([old]));
		await Effect.runPromise(projections.apply([{ ...old, revision: 2, updatedAt: 1000 }]));
		expect((await Effect.runPromise(store.completionEvidence([{ ...candidate, version: '2.0.0' }])))[0]?.completedAt)
			.toBe(20);
		await Effect.runPromise(projections.apply([{ ...old, revision: 1, updatedAt: 2000 }]));
		expect((await Effect.runPromise(store.completionEvidence([{ ...candidate, version: '2.0.0' }])))[0]?.completedAt)
			.toBe(20);
	} finally {
		db.sqlite.close();
	}
});

function frontier(db: TestD1) {
	return db.sqlite.query<{ id: string; completion_sort: string; completion_at: number }, []>(
		'SELECT id,completion_sort,completion_at FROM release_completion_frontier ORDER BY completion_sort',
	).all();
}

test('frontier proofs remain equivalent for out-of-order and downgrade releases, ties, moves and removals', async () => {
	const db = new TestD1();
	try {
		const projected = new ProjectionStore(db), store = new Store(db);
		const rows = [
			projection('high-old', '9.0.0', 10),
			projection('low-new', '2.0.0', 90),
			projection('middle', '5.0.0', 50),
			projection('dominated', '3.0.0', 20),
			projection('tie', '5.0.0+build', 50),
			projection('elsewhere', '20.0.0', 200, 'other'),
		];
		await Effect.runPromise(projected.apply(rows));
		const assertEquivalent = async () => {
			const reference = db.sqlite.query<{ version: string; at: number }, [string]>(
				'SELECT completion_release_version AS version,completion_at AS at FROM releases WHERE completion_stream=? AND completion_group IS NULL AND completion_sort IS NOT NULL',
			).all('main');
			for (const version of ['1.0.0', '2.0.0', '3.0.0', '5.0.0', '9.0.0', '99.0.0']) {
				for (const updatedAt of [0, 10, 20, 50, 90, 200]) {
					const expected = reference.some(row =>
						typeof row.version === 'string' && typeof row.at === 'number' && compare(row.version, version) > 0
						&& row.at > updatedAt
					);
					const actual = await Effect.runPromise(store.completionEvidence([{ ...candidate, version, updatedAt }]));
					expect(actual.length > 0).toBe(expected);
				}
			}
		};
		await assertEquivalent();
		expect(frontier(db)).toHaveLength(4);
		await Effect.runPromise(projected.apply([{ ...projection('high-old', '9.0.0', 100), revision: 2 }]));
		await assertEquivalent();
		expect(frontier(db)).toHaveLength(2);
		await Effect.runPromise(projected.apply([{ ...projection('high-old', '9.0.0', 10), revision: 3 }]));
		await assertEquivalent();
		expect(frontier(db)).toHaveLength(4);
		const beforeRollback = frontier(db);
		expect(() =>
			db.sqlite.transaction(() => {
				db.sqlite.run('DELETE FROM releases WHERE id=?', ['high-old']);
				throw new Error('Interrupted release mutation');
			})()
		).toThrow('Interrupted release mutation');
		expect(frontier(db)).toEqual(beforeRollback);
		await db.prepare('DELETE FROM releases WHERE id=?').bind('tie').run();
		await assertEquivalent();
		expect(frontier(db).some(row => row.id === 'middle')).toBe(true);
		await Effect.runPromise(projected.apply([{ ...projection('middle', '6.0.0', 5, 'other'), revision: 2 }]));
		await assertEquivalent();
		expect(frontier(db).some(row => row.id === 'dominated')).toBe(true);
		await Effect.runPromise(
			projected.apply([{ ...projection('low-new', '2.0.0', 90), revision: 2, document: '{bad' }]),
		);
		await assertEquivalent();
		await db.prepare('DELETE FROM releases WHERE id=?').bind('high-old').run();
		await assertEquivalent();
	} finally {
		db.sqlite.close();
	}
});

test('absent-proof work stays bounded per candidate across a large nondominated frontier', async () => {
	const db = new TestD1();
	try {
		await Effect.runPromise(
			new ProjectionStore(db).apply(
				Array.from({ length: 1000 }, (_, i) => projection(`point-${i}`, `2.${i}.0`, 10000 - i)),
			),
		);
		expect(frontier(db)).toHaveLength(1000);
		const store = new Store(db);
		db.reset();
		expect(
			await Effect.runPromise(
				store.completionEvidence(
					Array.from({ length: 200 }, (_, i) => ({ ...candidate, version: `1.${i}.0`, updatedAt: 11000 })),
				),
			),
		).toEqual([]);
		const query = db.queries.at(-1);
		if (!query) throw new Error('Missing proof query');
		let visited = 0;
		db.sqlite.function('completion_visit', (_id: unknown) => {
			visited++;
			return 1;
		});
		const counted = query.sql.replace(
			'WHERE proof.repository_id=',
			'WHERE completion_visit(proof.id) AND proof.repository_id=',
		);
		expect(db.sqlite.query(counted).all(...query.values)).toEqual([]);
		expect(visited).toBe(200);
		const plan = JSON.stringify(db.sqlite.query(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values));
		expect(plan).toContain('release_completion_frontier_lookup');
	} finally {
		db.sqlite.close();
	}
});

test('nondominated appends and unchanged reindex avoid residual frontier scans and rebuilds', async () => {
	const db = new TestD1();
	try {
		let visited = 0;
		db.sqlite.function('completion_visit', (_id: unknown) => {
			visited++;
			return 1;
		});
		const triggers = db.sqlite.query<{ name: string; sql: string }, []>(
			"SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'release_completion_frontier_%'",
		).all();
		for (const trigger of triggers) {
			if (typeof trigger.name !== 'string' || typeof trigger.sql !== 'string') throw new Error('Invalid trigger row');
			db.sqlite.run(`DROP TRIGGER ${trigger.name}`);
			db.sqlite.run(
				trigger.sql.replaceAll(
					'WHERE repository_id=NEW.repository_id',
					'WHERE completion_visit(id) AND repository_id=NEW.repository_id',
				).replaceAll(
					'FROM releases WHERE repository_id=OLD.repository_id',
					'FROM releases WHERE completion_visit(id) AND repository_id=OLD.repository_id',
				),
			);
		}
		const projected = new ProjectionStore(db);
		const rows = Array.from({ length: 1000 }, (_, i) => projection(`point-${i}`, `2.${i}.0`, 10000 - i));
		await Effect.runPromise(projected.apply(rows));
		expect(frontier(db)).toHaveLength(1000);
		expect(visited).toBeLessThanOrEqual(2000);
		visited = 0;
		await Effect.runPromise(projected.apply(rows.map(row => ({ ...row, revision: 2, updatedAt: 20000 }))));
		expect(visited).toBe(0);
		expect(frontier(db)).toHaveLength(1000);
	} finally {
		db.sqlite.close();
	}
});

test('legacy metadata normalization retries replaced rows and quarantines malformed release evidence', async () => {
	const db = new TestD1();
	try {
		const old = projection('legacy', '2.0.0', 10), replacement = projection('legacy', '3.0.0', 30);
		await db.prepare('INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,?,?,?,?)').bind(
			old.id,
			1,
			1,
			old.document,
			old.updatedAt,
		).run();
		await db.prepare('INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,?,?,?,?)').bind(
			'bad',
			1,
			1,
			'{bad',
			100,
		).run();
		const execute = db.execute.bind(db);
		let replaced = false;
		spyOn(db, 'execute').mockImplementation((query, values) => {
			if (!replaced && query.startsWith('UPDATE releases SET completion_format=1')) {
				replaced = true;
				db.sqlite.run('UPDATE releases SET document=?,updated_at=?,revision=2 WHERE id=?', [
					replacement.document,
					replacement.updatedAt,
					old.id,
				]);
			}
			return execute(query, values);
		});
		await Effect.runPromise(new ProjectionBackfill(db).drain());
		expect(await Effect.runPromise(new Store(db).completionEvidence([candidate]))).toEqual([{
			repositoryId: 1,
			stream: 'main',
			version: '3.0.0',
			completedAt: 30,
		}]);
		expect(replaced).toBe(true);
		expect(db.sqlite.query('SELECT id FROM releases WHERE completion_format IS NULL').all()).toEqual([]);
		expect(frontier(db).map(row => row.id)).toEqual(['legacy']);
	} finally {
		db.sqlite.close();
	}
});
