import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrationFiles, migrationsDirectory, TestD1 } from '@root/test/support/d1.ts';
import { Effect } from 'effect';
import { ProjectionBackfill } from '@/automation/projection-backfill.ts';
import { migrateDatabase } from '@/tooling/database/migrate.ts';

const root = resolve(import.meta.dir, '../..');
const generatedConfigurations = /^database-[A-Za-z0-9]{6}$/;

const legacyEvent = {
	id: 'legacy-release',
	source: 'synthetic',
	event: 'release',
	occurredAt: 10,
	release: {
		id: 'release',
		repository: { id: 1, name: 'o/r' },
		stream: 'main',
		commit: 'a'.repeat(40),
		version: '2.0.0',
		publications: [],
		artifacts: [],
	},
};
const legacyRows = [
	"INSERT INTO executions(id,repository_id,state,document,updated_at,revision) VALUES('legacy-execution',1,'ready','{}',10,1);",
	`INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES('legacy-release',1,1,'${
		JSON.stringify(legacyEvent).replaceAll("'", "''")
	}',10);`,
];

const temporaryConfigurations = async () =>
	(await readdir(join(root, '.wrangler'))).filter(name => generatedConfigurations.test(name)).sort();

let before: string[] = [];
beforeAll(async () => {
	await mkdir(join(root, '.wrangler'), { recursive: true });
	before = await temporaryConfigurations();
});
afterAll(async () => {
	expect(await temporaryConfigurations()).toEqual(before);
});

async function scratch<T>(work: (directory: string) => Promise<T>): Promise<T> {
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-database-test-'));
	try {
		return await work(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test.concurrent('local migration applies the schema through wrangler and backfills legacy rows through the node worker', async () => {
	await scratch(async directory => {
		const migrations = join(directory, 'migrations');
		await mkdir(migrations);
		const schema = await Promise.all(migrationFiles().map(file => readFile(join(migrationsDirectory, file), 'utf8')));
		await writeFile(join(migrations, '0001_schema_and_legacy_rows.sql'), [...schema, ...legacyRows].join('\n'));
		const state = join(directory, 'state');
		expect(await migrateDatabase({ mode: 'local', persistTo: state, migrations })).toEqual({
			executions: 1,
			releases: 1,
		});
		const storage = join(state, 'v3/d1/miniflare-D1DatabaseObject');
		const files = (await readdir(storage)).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
		expect(files).toHaveLength(1);
		const sqlite = new Database(join(storage, files[0] ?? ''), { readonly: true, strict: true });
		try {
			expect(sqlite.query('SELECT state_version,state_revision FROM executions WHERE id=?').get('legacy-execution'))
				.toEqual({ state_version: 1, state_revision: 1 });
			expect(
				sqlite.query(
					'SELECT completion_format,completion_revision,completion_stream,completion_release_version FROM releases WHERE id=?',
				).get('legacy-release'),
			)
				.toEqual({
					completion_format: 1,
					completion_revision: 1,
					completion_stream: 'main',
					completion_release_version: '2.0.0',
				});
		} finally {
			sqlite.close();
		}
	});
});

test('backfill resumes idempotently', async () => {
	const db = new TestD1();
	try {
		for (const row of legacyRows) db.sqlite.run(row);
		expect(await Effect.runPromise(new ProjectionBackfill(db).drain())).toEqual({ executions: 1, releases: 1 });
		expect(await Effect.runPromise(new ProjectionBackfill(db).drain())).toEqual({ executions: 0, releases: 0 });
	} finally {
		db.sqlite.close();
	}
});

test.concurrent('the entrypoint reports a failed schema migration and rejects ambiguous arguments', async () => {
	await scratch(async directory => {
		const run = async (args: string[]) => {
			const child = Bun.spawn(['bun', 'src/tooling/database/migrate.ts', ...args], {
				cwd: root,
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			return { stdout, stderr, code };
		};
		const invalidState = join(directory, 'not-a-directory');
		await writeFile(invalidState, 'synthetic', { mode: 0o600 });
		const [failed, invalid] = await Promise.all([
			run(['--local', '--persist-to', invalidState]),
			run(['--remote', '--persist-to', directory]),
		]);
		expect(failed.code).toBe(1);
		expect(failed.stderr).toContain('D1 SQL migrations failed; startup or deployment stopped.');
		expect(failed.stdout).not.toContain('Database migration complete');
		expect(invalid.code).toBe(1);
		expect(invalid.stderr).toContain('Choose exactly one');
	});
});

test.concurrent('Node backfill bridge reports cleanup failures without exposing database diagnostics', async () => {
	await mkdir(join(root, '.wrangler'), { recursive: true });
	const directory = await mkdtemp(join(root, '.wrangler/database-worker-test-'));
	try {
		const built = await Bun.build({
			entrypoints: [join(root, 'src/tooling/database/backfill.ts')],
			target: 'node',
			format: 'esm',
			packages: 'external',
			tsconfig: join(root, 'tsconfig.json'),
			plugins: [{
				name: 'database-cleanup-fixture',
				setup(build) {
					build.onResolve({ filter: /^wrangler$/ }, () => ({ path: 'wrangler', namespace: 'fixture' }));
					build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
						loader: 'js',
						contents: `export async function getPlatformProxy() {
							return { env: { DB: { prepare() { return { bind() { return this; }, async all() { return { results: [] }; } }; } } },
								async dispose() { throw new Error('synthetic-private-database-value'); } };
						}`,
					}));
				},
			}],
		});
		const bundle = built.outputs[0];
		if (!built.success || !bundle) throw new Error('Backfill fixture build failed');
		const worker = join(directory, 'backfill.mjs');
		await writeFile(worker, await bundle.text(), { mode: 0o600 });
		const messages: unknown[] = [];
		const child = Bun.spawn(['node', worker, join(directory, 'unused.json'), 'local', directory], {
			cwd: root,
			stdout: 'pipe',
			stderr: 'pipe',
			serialization: 'json',
			ipc(message) {
				messages.push(message);
			},
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(code).toBe(1);
		expect(messages).toEqual([{ failure: 'cleanup' }]);
		expect(stdout).toBe('');
		expect(stderr).not.toContain('synthetic-private-database-value');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
