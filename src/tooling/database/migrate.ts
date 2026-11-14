import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Schema } from 'effect';
import { parse } from 'smol-toml';
import { decodeSync, mutableArray, mutableStruct, safeDecode } from '@/schema';

const root = resolve(import.meta.dir, '../../..');
const configuration = mutableStruct({
	name: Schema.String,
	account_id: Schema.String,
	compatibility_date: Schema.String,
	d1_databases: mutableArray(mutableStruct({
		binding: Schema.String,
		database_name: Schema.String,
		database_id: Schema.String,
	})),
});

const rowCount = Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0));
const backfillMessage = Schema.Union([
	mutableStruct({ counts: mutableStruct({ executions: rowCount, releases: rowCount }) }),
	mutableStruct({ failure: Schema.Literals(['proxy', 'backfill', 'cleanup']) }),
]);

interface Migration {
	mode: 'local' | 'remote';
	persistTo?: string;
}

const messages = {
	arguments: 'Choose exactly one of --local or --remote; --persist-to requires --local.',
	configuration: 'Database migration configuration could not be prepared.',
	schema: 'D1 SQL migrations failed; startup or deployment stopped.',
	proxy: 'Database backfill connection failed; startup or deployment stopped.',
	backfill: 'Database projection backfill failed; startup or deployment stopped.',
	cleanup: 'Database migration resource cleanup failed; startup or deployment stopped.',
};
type Stage = keyof typeof messages;
class MigrationFailure extends Error {
	constructor(stage: Stage) {
		super(messages[stage]);
	}
}

export async function migrateDatabase({ mode, persistTo }: Migration) {
	if (mode === 'remote' && persistTo !== undefined) throw new MigrationFailure('arguments');
	let stage: Stage = 'configuration';
	let failure: MigrationFailure | undefined;
	let result: { executions: number; releases: number } | undefined;
	let directory: string | undefined;
	try {
		const source = decodeSync(configuration, parse(await Bun.file(join(root, 'wrangler.toml')).text()));
		const database = source.d1_databases.find(binding => binding.binding === 'DB');
		if (!database) throw new Error('Missing DB configuration');
		const persistence = persistTo === undefined ? join(root, '.wrangler/state') : resolve(persistTo);
		await mkdir(join(root, '.wrangler'), { recursive: true });
		directory = await mkdtemp(join(root, '.wrangler/database-'));
		const configPath = join(directory, 'wrangler.json');
		const envPath = join(directory, 'empty.env');
		await writeFile(
			configPath,
			JSON.stringify({
				name: source.name,
				account_id: source.account_id,
				compatibility_date: source.compatibility_date,
				d1_databases: [{
					...database,
					migrations_dir: join(root, 'migrations'),
					...(mode === 'remote' ? { remote: true } : {}),
				}],
			}),
			{ mode: 0o600 },
		);
		await writeFile(envPath, '', { mode: 0o600 });
		stage = 'schema';
		const child = Bun.spawn([
			'bunx',
			'--no-install',
			'wrangler',
			'd1',
			'migrations',
			'apply',
			database.database_name,
			`--${mode}`,
			'--config',
			configPath,
			'--env-file',
			envPath,
			...(mode === 'local' ? ['--persist-to', persistence] : []),
		], { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
		// Wrangler diagnostics may contain database values; consume without retaining or displaying them.
		const [, , code] = await Promise.all([
			child.stdout.pipeTo(new WritableStream({ write() {} })),
			child.stderr.pipeTo(new WritableStream({ write() {} })),
			child.exited,
		]);
		if (code !== 0) throw new Error('D1 schema migration failed');
		stage = 'backfill';
		const built = await Bun.build({
			entrypoints: [join(import.meta.dir, 'backfill.ts')],
			target: 'node',
			format: 'esm',
			packages: 'external',
			tsconfig: join(root, 'tsconfig.json'),
		});
		const bundle = built.outputs[0];
		if (!built.success || built.outputs.length !== 1 || !bundle) throw new Error('Backfill bundle failed');
		const worker = join(directory, 'backfill.mjs');
		await writeFile(worker, await bundle.text(), { mode: 0o600 });
		const backfill = Bun.spawn(['node', worker, configPath, mode, join(persistence, 'v3')], {
			cwd: root,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			serialization: 'json',
			ipc(message) {
				const parsed = safeDecode(backfillMessage, message);
				if (!parsed.success) return;
				if ('failure' in parsed.data) stage = parsed.data.failure;
				else result = parsed.data.counts;
			},
		});
		const [, , exit] = await Promise.all([
			backfill.stdout.pipeTo(new WritableStream({ write() {} })),
			backfill.stderr.pipeTo(new WritableStream({ write() {} })),
			backfill.exited,
		]);
		if (exit !== 0 || !result) throw new Error('Backfill process failed');
	} catch {
		failure = new MigrationFailure(stage);
	} finally {
		try {
			if (directory) await rm(directory, { recursive: true, force: true });
		} catch {
			failure ??= new MigrationFailure('cleanup');
		}
	}
	if (failure) throw failure;
	if (!result) throw new MigrationFailure('backfill');
	return result;
}

if (import.meta.main) {
	try {
		const { values } = parseArgs({
			args: Bun.argv.slice(2),
			options: { local: { type: 'boolean' }, remote: { type: 'boolean' }, 'persist-to': { type: 'string' } },
			strict: true,
			allowPositionals: false,
		});
		if (Boolean(values.local) === Boolean(values.remote)) throw new MigrationFailure('arguments');
		const counts = await migrateDatabase({
			mode: values.remote ? 'remote' : 'local',
			persistTo: values['persist-to'],
		});
		console.log(
			`Database migration complete: ${counts.executions} executions and ${counts.releases} releases backfilled.`,
		);
	} catch (error) {
		console.error(error instanceof MigrationFailure ? error.message : messages.arguments);
		process.exitCode = 1;
	}
}
