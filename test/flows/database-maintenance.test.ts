import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Schema } from 'effect';
import { parse } from 'smol-toml';
import { getPlatformProxy } from 'wrangler';
import { decodeSync, mutableArray, mutableStruct } from '@/schema';

const root = resolve(import.meta.dir, '../..');
const configuration = mutableStruct({
	name: Schema.String,
	compatibility_date: Schema.String,
	d1_databases: mutableArray(mutableStruct({
		binding: Schema.String,
		database_name: Schema.String,
		database_id: Schema.String,
	})),
});

test('local database entrypoint migrates, backfills legacy rows, resumes idempotently and gates failures', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'beepboop-database-test-'));
	const state = join(directory, 'state');
	const source = decodeSync(configuration, parse(await Bun.file(join(root, 'wrangler.toml')).text()));
	const binding = source.d1_databases.find(database => database.binding === 'DB');
	if (!binding) throw new Error('Missing DB fixture binding');
	const configPath = join(directory, 'wrangler.json');
	await writeFile(
		configPath,
		JSON.stringify({
			name: source.name,
			compatibility_date: source.compatibility_date,
			d1_databases: [binding],
		}),
		{ mode: 0o600 },
	);
	const temporaryConfigurations = async () =>
		(await readdir(join(root, '.wrangler'))).filter(name => name.startsWith('database-')).sort();
	const run = async (args: string[]) => {
		const child = Bun.spawn(['bun', 'run', 'db:local', '--', ...args], {
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
	const database = async (work: (db: D1Database) => Promise<void>) => {
		const proxy = await getPlatformProxy<{ DB: D1Database }>({
			configPath,
			envFiles: [],
			remoteBindings: false,
			persist: { path: join(state, 'v3') },
		});
		try {
			await work(proxy.env.DB);
		} finally {
			await proxy.dispose();
		}
	};
	try {
		const cold = await run(['--persist-to', state]);
		expect(cold.code).toBe(0);
		expect(cold.stdout).toContain('0 executions and 0 releases backfilled');
		const configurations = await temporaryConfigurations();
		await database(async db => {
			await db.prepare(
				'INSERT INTO executions(id,repository_id,state,document,updated_at,revision) VALUES(?,?,?,?,?,?)',
			)
				.bind('legacy-execution', 1, 'ready', '{}', 10, 1).run();
			const event = {
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
			await db.prepare('INSERT INTO releases(id,repository_id,revision,document,updated_at) VALUES(?,?,?,?,?)')
				.bind('legacy-release', 1, 1, JSON.stringify(event), 10).run();
		});
		const seeded = await run(['--persist-to', state]);
		expect(seeded.code).toBe(0);
		expect(seeded.stdout).toContain('1 executions and 1 releases backfilled');
		await database(async db => {
			expect(
				await db.prepare('SELECT state_version,state_revision FROM executions WHERE id=?').bind('legacy-execution')
					.first(),
			)
				.toEqual({ state_version: 1, state_revision: 1 });
			expect(
				await db.prepare(
					'SELECT completion_format,completion_revision,completion_stream,completion_release_version FROM releases WHERE id=?',
				).bind('legacy-release').first(),
			)
				.toEqual({
					completion_format: 1,
					completion_revision: 1,
					completion_stream: 'main',
					completion_release_version: '2.0.0',
				});
		});
		const repeated = await run(['--persist-to', state]);
		expect(repeated.code).toBe(0);
		expect(repeated.stdout).toContain('0 executions and 0 releases backfilled');
		const invalidState = join(directory, 'not-a-directory');
		await writeFile(invalidState, 'synthetic', { mode: 0o600 });
		const failed = await run(['--persist-to', invalidState]);
		expect(failed.code).toBe(1);
		expect(failed.stderr).toContain('D1 SQL migrations failed; startup or deployment stopped.');
		expect(failed.stdout).not.toContain('Database migration complete');
		const invalid = await run(['--remote', '--persist-to', state]);
		expect(invalid.code).toBe(1);
		expect(invalid.stderr).toContain('Choose exactly one');
		expect(await temporaryConfigurations()).toEqual(configurations);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);

test('Node backfill bridge reports cleanup failures without exposing database diagnostics', async () => {
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
