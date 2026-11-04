import { expect, test } from 'bun:test';
import { AuditStore } from '@/persistence/d1/audit';
import { SessionStore } from '@/persistence/d1/sessions';
import { TestD1 } from '../support/d1.ts';

const now = Date.now();
const later = now + 600_000;
const event = JSON.stringify({ id: 'release:1' });

const deployedWrites: { sql: string; values: (string | number)[] }[] = [
	{ sql: 'INSERT INTO sessions(id,document,expires_at) VALUES(?,?,?)', values: ['flow-1', '{}', later] },
	{
		sql:
			'INSERT INTO authenticators(id,subject,document) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM authenticators WHERE subject=?)',
		values: ['key-1', 'admin', '{}', 'admin'],
	},
	{ sql: 'INSERT INTO authenticators(id,subject,document) VALUES(?,?,?)', values: ['key-2', 'admin', '{}'] },
	{ sql: 'INSERT INTO cli_sessions(id,subject,created_at) VALUES(?,?,?)', values: ['cli-1', 'admin', now] },
	{
		sql: 'INSERT OR IGNORE INTO sessions(id,document,expires_at) VALUES(?,?,?)',
		values: ['cli-approval:1', '{}', later],
	},
	{
		sql:
			'INSERT INTO notification_destinations (id, name, kind, credential, subscribe_new, enabled, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, credential=excluded.credential, subscribe_new=excluded.subscribe_new, enabled=excluded.enabled',
		values: ['destination-1', 'Releases', 'http', 'release-hook', 1, 1, now],
	},
	{
		sql:
			'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE id=?',
		values: ['npm', 'widget', 'destination-1'],
	},
	{
		sql:
			'INSERT OR IGNORE INTO notification_subscriptions (destination_id, registry, name) SELECT id, ?, ? FROM notification_destinations WHERE enabled=1 AND subscribe_new=1',
		values: ['npm', 'gadget'],
	},
	{
		sql:
			"INSERT OR IGNORE INTO notification_deliveries (id, event_id, destination_id, document, state, attempts, updated_at) SELECT ? || ':' || d.id, ?, d.id, ?, 'pending', 0, ? FROM notification_destinations d JOIN notification_subscriptions s ON s.destination_id = d.id WHERE d.enabled=1 AND s.registry=? AND s.name=?",
		values: ['package:npm:widget@1.0.0', 'package:npm:widget@1.0.0', '{}', now, 'npm', 'widget'],
	},
	{
		sql: 'INSERT OR IGNORE INTO watched_packages (registry, name, manual, added_at) VALUES (?, ?, ?, ?)',
		values: ['npm', 'widget', 1, now],
	},
	{ sql: 'INSERT OR IGNORE INTO schedules(id,last_tick) VALUES(?,?)', values: ['schedule-1', now] },
	{
		sql:
			'INSERT INTO onboarding(repository_id,document) VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET document=excluded.document',
		values: [42, '{}'],
	},
	{
		sql:
			'INSERT INTO repositories(id,name,document,updated_at,added_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,document=excluded.document,updated_at=excluded.updated_at',
		values: [42, 'octo/widget', '{}', now, now],
	},
	{
		sql:
			'INSERT INTO executions(id,repository_id,state,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,document=excluded.document,updated_at=excluded.updated_at WHERE excluded.updated_at>=executions.updated_at',
		values: ['execution-1', 42, 'ready', '{}', now],
	},
	{
		sql: 'INSERT OR IGNORE INTO release_events(id,document,created_at) VALUES(?,?,?)',
		values: ['release:1', event, now],
	},
	{
		sql:
			"INSERT OR IGNORE INTO subscription_deliveries(id,event_id,repository_id,document,state,updated_at) SELECT ?,?,?,?,'pending',? WHERE EXISTS (SELECT 1 FROM release_events WHERE id=? AND document=?)",
		values: ['delivery-1', 'release:1', 42, '{}', now, 'release:1', event],
	},
	{
		sql: 'INSERT INTO audit(id,actor,action,target,created_at) VALUES(?,?,?,?,?)',
		values: ['audit-1', 'admin', 'release.prepare', 'execution-1', now],
	},
	{
		sql: 'INSERT INTO credentials(alias,version,key_id,ciphertext,iv,active,created_at) VALUES(?,?,?,?,?,1,?)',
		values: ['release-hook', 1, 'v1', 'sealed', 'iv', now],
	},
	{
		sql:
			'INSERT INTO grants(id,alias,repository_id,document) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,repository_id=excluded.repository_id,document=excluded.document',
		values: ['grant-1', 'release-hook', 42, '{}'],
	},
	{
		sql:
			'INSERT INTO secret_deliveries(grant_id,version,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(grant_id,version) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at',
		values: ['grant-1', 1, 'delivered', now],
	},
	{
		sql: 'INSERT OR IGNORE INTO winget_submissions(id,package,version,document,updated_at) VALUES(?,?,?,?,?)',
		values: ['submission-1', 'Octo.Widget', '1.0.0', '{}', now],
	},
	{ sql: 'INSERT OR IGNORE INTO winget_watches(repository_id,since) VALUES(?,?)', values: [42, now] },
];

test('the deployed Worker keeps writing after every migration, and this version reads its rows', async () => {
	const db = new TestD1();
	for (const write of deployedWrites) {
		const result = await db.prepare(write.sql).bind(...write.values).run();
		expect({ sql: write.sql, changes: result.meta.changes }).toEqual({ sql: write.sql, changes: 1 });
	}

	const sessions = new SessionStore(db);
	expect(await sessions.take('flow-1')).toBe('{}');
	expect(await sessions.take('cli-approval:1')).toBe('{}');
	expect(await new AuditStore(db).recent()).toEqual([
		{ id: 'audit-1', actor: 'admin', action: 'release.prepare', target: 'execution-1', createdAt: now },
	]);
});
