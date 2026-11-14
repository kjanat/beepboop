import { expect, spyOn, test } from 'bun:test';
import { TestD1 } from '@root/test/support/d1';
import { Effect } from 'effect';
import { Store } from '@/automation/store';
import { decodeExecutionV1 } from '@/persistence/codecs/v1';
import { ProjectionBackfill } from '@/persistence/d1/backfill';
import { ProjectionStore } from '@/persistence/d1/projection';

function execution(id: string, verifying = false) {
	return {
		id,
		repositoryId: 1,
		repository: 'octo/widget',
		stream: 'main',
		version: '1.0.0',
		configurationSha: 'config',
		sourceSha: 'source',
		eventId: id,
		configuration: {
			extends: [],
			managers: ['npm'],
			subscriptions: [],
			streams: {
				main: {
					required: ['pkg:npm/widget'],
					versioning: 'workspace',
					concurrency: 'queue',
					prepare: { version: 'manual' },
					promote: { approval: 'required' },
					workflows: {},
					credentials: [],
					channels: { stable: 'latest', prerelease: 'next' },
				},
			},
		},
		operation: verifying ? 'publish' : 'promote',
		presetShas: {},
		dependencies: [],
		attempts: 0,
		artifacts: [],
		createdAt: verifying ? 1 : 100,
		updatedAt: 1,
		state: 'blocked',
		...(verifying
			? { runId: 1, workflow: { file: 'publish.yml', ref: 'main', inputs: {}, publications: ['pkg:npm/widget'] } }
			: {}),
		publications: verifying
			? [{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.0.0', required: true, outcome: 'pending' }]
			: [],
	};
}
function release(version = '2.0.0', at = 20) {
	return JSON.stringify({
		id: 'release',
		source: 'octo/widget',
		event: 'release',
		occurredAt: at,
		release: {
			id: 'release',
			repository: { id: 1, name: 'octo/widget' },
			stream: 'main',
			commit: 'source',
			version,
			publications: [],
			artifacts: [],
		},
	});
}
const candidate = { repositoryId: 1, stream: 'main', state: 'failed' as const, version: '1.0.0', updatedAt: 1 };
async function legacyExecutions(db: TestD1, count: number) {
	const insert = db.prepare(
		'INSERT INTO executions(id,repository_id,state,document,updated_at,revision) VALUES(?,1,?,?,1,1)',
	);
	await db.batch(Array.from({ length: count }, (_, i) => {
		const base = execution(`old-${i}`, i === count - 1);
		const row = i === count - 1
			? base
			: {
				...base,
				operation: 'publish',
				attempts: 1,
				runId: 1,
				workflow: { file: 'publish.yml', ref: 'main', inputs: {}, publications: ['pkg:npm/missing'] },
			};
		return insert.bind(row.id, row.state, JSON.stringify(row));
	}));
}

test('cold requests repair one bounded tail and refuse partial execution or completion history', async () => {
	const db = new TestD1();
	try {
		await legacyExecutions(db, 1200);
		db.reset();
		await expect(Effect.runPromise(new Store(db).executions())).rejects.toThrow('maintenance is pending');
		expect(db.queries.length).toBeLessThanOrEqual(5);
		expect(db.sqlite.query('SELECT COUNT(*) AS count FROM executions WHERE state_version=1').get()).toEqual({
			count: 10,
		});
		await db.batch(
			Array.from(
				{ length: 1200 },
				(_, i) =>
					db.prepare('INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,1,1,?,20)').bind(
						`r-${i}`,
						release(),
					),
			),
		);
		db.reset();
		await expect(Effect.runPromise(new Store(db).completionEvidence([candidate]))).rejects.toThrow(
			'maintenance is pending',
		);
		expect(db.queries.length).toBeLessThanOrEqual(5);
		expect(db.sqlite.query('SELECT COUNT(*) AS count FROM releases WHERE completion_format=1').get()).toEqual({
			count: 10,
		});
		await Effect.runPromise(new ProjectionBackfill(db).drain());
		db.reset();
		const listed = await Effect.runPromise(new Store(db).executions());
		expect(listed[0]?.state).toBe('verifying');
		expect(listed[0]?.id).toBe('old-1199');
		expect(await Effect.runPromise(new Store(db).filteredExecutions({ states: 'verifying' }))).toHaveLength(1);
		expect(db.queries.some(query => query.writes)).toBe(false);
	} finally {
		db.sqlite.close();
	}
});

test('old writer inserts and higher-revision updates invalidate metadata and stale frontier proofs', async () => {
	const db = new TestD1();
	try {
		const projected = new ProjectionStore(db), store = new Store(db);
		const row = execution('run');
		expect(decodeExecutionV1(row).state).toBe('awaiting-approval');
		await Effect.runPromise(
			projected.apply([
				{
					entity: 'execution',
					id: row.id,
					repositoryId: 1,
					revision: 1,
					document: JSON.stringify(row),
					state: row.state,
					updatedAt: 1,
				},
				{ entity: 'release', id: 'release', repositoryId: 1, revision: 1, document: release(), updatedAt: 20 },
			]),
		);
		expect(await Effect.runPromise(store.filteredExecutions({ states: 'awaiting-approval' }))).toHaveLength(1);
		await db.prepare('UPDATE executions SET revision=2,state=?,document=? WHERE id=?').bind(
			'blocked',
			JSON.stringify({ ...row, attempts: 1 }),
			row.id,
		).run();
		expect(db.sqlite.query('SELECT state_version FROM executions WHERE id=?').get(row.id)).toEqual({
			state_version: null,
		});
		expect(await Effect.runPromise(store.filteredExecutions({ states: 'blocked' }))).toHaveLength(1);
		await db.prepare('UPDATE releases SET revision=2,document=?,updated_at=40 WHERE id=?').bind(
			release('0.5.0', 40),
			'release',
		).run();
		expect(db.sqlite.query('SELECT completion_format FROM releases WHERE id=?').get('release')).toEqual({
			completion_format: null,
		});
		expect(db.sqlite.query('SELECT id FROM release_completion_frontier').all()).toEqual([]);
		expect(await Effect.runPromise(store.completionEvidence([candidate]))).toEqual([]);
		await db.prepare('INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,1,1,?,20)').bind(
			'tail',
			release('3.0.0'),
		).run();
		expect(await Effect.runPromise(store.completionEvidence([candidate]))).toEqual([{
			repositoryId: 1,
			stream: 'main',
			version: '3.0.0',
			completedAt: 20,
		}]);
		await db.prepare('UPDATE releases SET repository_id=2,revision=3 WHERE id=?').bind('tail').run();
		expect(db.sqlite.query('SELECT id FROM release_completion_frontier WHERE id=?').all('tail')).toEqual([]);
	} finally {
		db.sqlite.close();
	}
});

test('maintenance fails after eight consecutive CAS failures rather than looping indefinitely', async () => {
	const db = new TestD1();
	try {
		await legacyExecutions(db, 1);
		const execute = db.execute.bind(db);
		let attempts = 0;
		spyOn(db, 'execute').mockImplementation((query, values) => {
			if (query.startsWith('UPDATE executions')) {
				attempts++;
				return { rows: [], changes: 0, lastRowId: 0 };
			}
			return execute(query, values);
		});
		await expect(Effect.runPromise(new ProjectionBackfill(db).drain())).rejects.toThrow('could not make progress');
		expect(attempts).toBe(8);
	} finally {
		db.sqlite.close();
	}
});

test('scoped tail repair uses pending repository indexes without repairing unrelated history', async () => {
	const db = new TestD1();
	try {
		await legacyExecutions(db, 1000);
		db.reset();
		expect(await Effect.runPromise(new Store(db).executions(2))).toEqual([]);
		expect(db.queries.some(query => query.writes)).toBe(false);
		const query = db.queries.find(query => query.sql.includes('document_bytes'));
		if (!query) throw new Error('Missing bounded backfill query');
		const plan = JSON.stringify(db.sqlite.query(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.values));
		expect(plan).toContain('executions_state_pending_repository');
	} finally {
		db.sqlite.close();
	}
});

test('old writers preserve earliest fallback completion time for ready and still-pending legacy events', async () => {
	const db = new TestD1();
	try {
		const withoutTime = JSON.parse(release());
		delete withoutTime.occurredAt;
		const document = JSON.stringify(withoutTime);
		await Effect.runPromise(
			new ProjectionStore(db).apply([{
				entity: 'release',
				id: 'release',
				repositoryId: 1,
				revision: 1,
				document,
				updatedAt: 20,
			}]),
		);
		await db.prepare('UPDATE releases SET revision=2,updated_at=1000 WHERE id=?').bind('release').run();
		expect(await Effect.runPromise(new Store(db).completionEvidence([candidate]))).toEqual([{
			repositoryId: 1,
			stream: 'main',
			version: '2.0.0',
			completedAt: 20,
		}]);
		await db.prepare('DELETE FROM releases').run();
		await db.prepare('INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,1,1,?,40)').bind(
			'pending',
			document,
		).run();
		await db.prepare('UPDATE releases SET revision=2,updated_at=1000 WHERE id=?').bind('pending').run();
		await Effect.runPromise(new ProjectionBackfill(db).drain());
		expect(await Effect.runPromise(new Store(db).completionEvidence([candidate]))).toEqual([{
			repositoryId: 1,
			stream: 'main',
			version: '2.0.0',
			completedAt: 40,
		}]);
	} finally {
		db.sqlite.close();
	}
});
