import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, required } from '@root/actions/runtime/protocol.ts';
import { call, mask, serviceOrigin } from '@root/actions/runtime/session.ts';
import { Effect } from 'effect';
import { z } from 'zod';
import type { LedgerEntry, LedgerPackage } from '@/contract/ledger.ts';
import { claimStep, nextStep, reportStep } from '@/contract/ledger.ts';

export interface Command {
	code: number;
	stdout: string;
	output: string;
}
export interface Runner {
	executionId: string;
	credentials: Record<string, string>;
	provenance: boolean;
	call(path: `/api/workflow/${string}`, body: unknown): Effect.Effect<unknown, Invalid>;
	run(command: string[], options: { cwd: string; env?: Record<string, string> }): Effect.Effect<Command, ActionFailure>;
	sleep(milliseconds: number): Effect.Effect<void>;
	exists(path: string): boolean;
	now(): number;
	log(line: string): void;
}
interface Artifact {
	digest: string;
	files: string[];
}

const longestWait = 30 * 60_000;
const verificationPolls = 20;
const packageAttempts = 8;

function fail(message: string): Effect.Effect<never, ActionFailure> {
	return Effect.fail(new ActionFailure({ message }));
}

function sha256(path: string): Effect.Effect<string, ActionFailure> {
	return Effect.fromResult(attempt(() => createHash('sha256').update(readFileSync(path)).digest('hex')));
}

function scratch(name: string): Effect.Effect<string, ActionFailure> {
	return Effect.fromResult(
		attempt(() =>
			mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `beepboop-${name.replace(/[^\w.-]+/g, '-')}-`))
		),
	);
}

const cargoMetadata = z.object({ target_directory: z.string() });
const secretValues = z.record(z.string(), z.string());
const tarball = z.object({ filename: z.string(), integrity: z.string() });
const packed = z.tuple([tarball]).rest(tarball);

function checked(runner: Runner, command: string[], cwd: string): Effect.Effect<string, ActionFailure> {
	return runner.run(command, { cwd }).pipe(Effect.flatMap(result =>
		result.code === 0
			? Effect.succeed(result.stdout)
			: fail(`${command.slice(0, 2).join(' ')} exited ${result.code}\n${result.output.trim()}`)
	));
}

function build(
	runner: Runner,
	pkg: LedgerPackage,
	toolchain: Effect.Effect<void, ActionFailure>,
): Effect.Effect<Artifact, ActionFailure> {
	return Effect.gen(function*() {
		const dir = dirname(pkg.manifest);
		if (pkg.manager === 'cargo') {
			yield* toolchain;
			const metadata = yield* checked(runner, [
				'cargo',
				'metadata',
				'--format-version',
				'1',
				'--no-deps',
				'--manifest-path',
				pkg.manifest,
			], '.');
			const target = yield* Effect.fromResult(attempt(() => cargoMetadata.parse(JSON.parse(metadata))));
			yield* checked(runner, ['cargo', 'package', '--manifest-path', pkg.manifest, '--locked'], '.');
			const file = join(target.target_directory, 'package', `${pkg.name}-${pkg.version}.crate`);
			return { digest: yield* sha256(file), files: [file] };
		}
		if (pkg.manager === 'pypi') {
			const out = yield* scratch(pkg.name);
			yield* checked(runner, ['uv', 'build', '--project', dir, '--out-dir', out], '.');
			const files = yield* Effect.fromResult(attempt(() => readdirSync(out).sort().map(file => join(out, file))));
			const sdist = files.find(file => file.endsWith('.tar.gz')) ?? files[0];
			if (!sdist) return yield* fail(`uv build produced no distribution for ${pkg.name}`);
			return { digest: yield* sha256(sdist), files };
		}
		const out = yield* scratch(pkg.name);
		const output = yield* checked(runner, ['npm', 'pack', '--json', '--pack-destination', out], dir);
		const start = output.startsWith('[') ? 0 : output.lastIndexOf('\n[') + 1;
		const [first] = yield* Effect.fromResult(attempt(() => packed.parse(JSON.parse(output.slice(start)))));
		return { digest: first.integrity, files: [join(out, first.filename)] };
	});
}

function publishCommand(
	pkg: LedgerPackage,
	artifact: Artifact,
	provenance: boolean,
): { command: string[]; cwd: string } {
	if (pkg.manager === 'cargo') {
		return { command: ['cargo', 'publish', '--manifest-path', pkg.manifest, '--locked', '--no-verify'], cwd: '.' };
	}
	if (pkg.manager === 'pypi') {
		return { command: ['uv', 'publish', '--check-url', 'https://pypi.org/simple/', ...artifact.files], cwd: '.' };
	}
	return {
		command: [
			'npm',
			'publish',
			...artifact.files,
			'--access',
			'public',
			...(pkg.channel ? ['--tag', pkg.channel] : []),
			...(provenance ? ['--provenance'] : []),
		],
		cwd: dirname(pkg.manifest),
	};
}

const retryAfter =
	/try again after ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT)/i;
const retryHeader = /retry-after:\s*(\d+|[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT)/i;

type Report =
	| { outcome: 'published' }
	| { outcome: 'failed'; message: string }
	| { outcome: 'rate-limited'; retryAfter?: string };

function classify(result: Command): Report {
	if (result.code === 0) return { outcome: 'published' };
	if (/\b429\b|too many requests/i.test(result.output)) {
		const after = retryAfter.exec(result.output)?.[1] ?? retryHeader.exec(result.output)?.[1];
		return { outcome: 'rate-limited', ...(after ? { retryAfter: after } : {}) };
	}
	const lines = result.output.trim().split('\n');
	return { outcome: 'failed', message: lines.slice(-20).join('\n') || `exited ${result.code}` };
}

export function publishPackages(runner: Runner): Effect.Effect<LedgerEntry[], Invalid> {
	const step = <S extends z.ZodType>(path: `/api/workflow/publish/${string}`, schema: S, body: object) =>
		runner.call(path, { executionId: runner.executionId, ...body }).pipe(
			Effect.flatMap(value =>
				Effect.fromResult(attempt((): z.output<S> => schema.parse(value))).pipe(
					Effect.mapError(() => new ActionFailure({ message: `Beepboop answered ${path} with an unknown step` })),
				)
			),
		);
	const next = () => step('/api/workflow/publish/next', nextStep, {});
	const claim = (pkg: LedgerPackage, digest: string) =>
		step('/api/workflow/publish/claim', claimStep, { purl: pkg.purl, digest });
	const report = (pkg: LedgerPackage, outcome: Report) =>
		step('/api/workflow/publish/report', reportStep, { purl: pkg.purl, ...outcome });
	const show = (entry: LedgerEntry) => `${entry.state}${entry.error ? ` (${entry.error})` : ''}`;
	let secrets: Record<string, string> | undefined;
	const environment = Effect.gen(function*() {
		if (secrets) return secrets;
		const aliases = [...new Set(Object.values(runner.credentials))];
		const granted = aliases.length
			? yield* runner.call('/api/workflow/credentials', { executionId: runner.executionId, aliases })
			: {};
		const values = yield* Effect.fromResult(attempt(() => secretValues.parse(granted)));
		for (const value of Object.values(values)) yield* mask(value);
		const env: Record<string, string> = {};
		for (const [name, alias] of Object.entries(runner.credentials)) {
			const value = values[alias];
			if (value !== undefined) env[name] = value;
		}
		const npm = env.NODE_AUTH_TOKEN ?? env.NPM_TOKEN;
		if (npm) env['npm_config_//registry.npmjs.org/:_authToken'] = npm;
		secrets = env;
		return env;
	});
	const pause = (until: number, reason: string) =>
		Effect.gen(function*() {
			const wait = until - runner.now();
			if (wait > longestWait) return false;
			runner.log(`${reason}; waiting ${Math.ceil(Math.max(0, wait) / 1000)}s`);
			if (wait > 0) yield* runner.sleep(wait);
			return true;
		});
	let installed = false;
	const toolchain = Effect.gen(function*() {
		if (installed || !['rust-toolchain.toml', 'rust-toolchain'].some(file => runner.exists(file))) return;
		yield* checked(runner, ['rustup', 'toolchain', 'install'], '.');
		installed = true;
	});
	const one = (pkg: LedgerPackage) =>
		Effect.gen(function*() {
			runner.log(`Building ${pkg.name} ${pkg.version}`);
			const built = yield* Effect.result(build(runner, pkg, toolchain));
			if (built._tag === 'Failure') {
				const reported = yield* report(pkg, { outcome: 'failed', message: built.failure.message });
				if (reported.kind === 'settled') runner.log(`${pkg.name} ${pkg.version}: ${show(reported.entry)}`);
				return;
			}
			const artifact = built.success;
			for (;;) {
				const claimed = yield* claim(pkg, artifact.digest);
				if (claimed.kind === 'publish') break;
				if (claimed.kind === 'settled') {
					runner.log(`${pkg.name} ${pkg.version}: ${show(claimed.entry)}`);
					return;
				}
				if (!(yield* pause(claimed.until, claimed.reason))) return;
			}
			const { command, cwd } = publishCommand(pkg, artifact, runner.provenance);
			runner.log(`Publishing ${pkg.name} ${pkg.version}`);
			const result = yield* runner.run(command, { cwd, env: yield* environment });
			let outcome: Report = classify(result);
			for (let poll = 1;; poll++) {
				const reported = yield* report(pkg, outcome);
				if (reported.kind === 'settled') {
					runner.log(`${pkg.name} ${pkg.version}: ${show(reported.entry)}`);
					return;
				}
				if (poll >= verificationPolls) {
					outcome = { outcome: 'failed', message: `The registry did not list ${pkg.name} ${pkg.version} in time` };
				} else yield* pause(reported.until, reported.reason);
			}
		});
	return Effect.gen(function*() {
		const tries = new Map<string, number>();
		for (;;) {
			const handed = yield* next();
			if (handed.kind === 'done') {
				for (const entry of handed.entries) runner.log(`${entry.purl}: ${show(entry)}`);
				return handed.entries;
			}
			if (handed.kind === 'wait') {
				if (yield* pause(handed.until, handed.reason)) continue;
				return yield* fail(`${handed.reason}; the next attempt is due after this run`);
			}
			const count = (tries.get(handed.package.purl) ?? 0) + 1;
			if (count > packageAttempts) return yield* fail(`${handed.package.purl} did not settle in this run`);
			tries.set(handed.package.purl, count);
			yield* one(handed.package);
		}
	});
}

export function requireAll(entries: LedgerEntry[]): Effect.Effect<void, ActionFailure> {
	const missing = entries.filter(entry => entry.required && !['published', 'reused'].includes(entry.state));
	if (!missing.length) return Effect.void;
	return fail(
		`${missing.length} required publication${missing.length === 1 ? '' : 's'} did not publish: ${
			missing.map(entry => entry.purl).join(', ')
		}`,
	);
}

const event = z.object({ repository: z.object({ private: z.boolean() }) });
export function publicRepository(path: string | undefined): boolean {
	if (!path) return false;
	const parsed = attempt(() => event.parse(JSON.parse(readFileSync(path, 'utf8'))));
	return parsed._tag === 'Success' && !parsed.success.repository.private;
}

const credentials = z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().min(1));

export function command(argv: string[], options: { cwd: string; env?: Record<string, string> }) {
	return Effect.tryPromise({
		try: async (): Promise<Command> => {
			const child = Bun.spawn(argv, {
				cwd: options.cwd,
				env: { ...process.env, ...options.env },
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const chunks: string[] = [], out: string[] = [];
			const drain = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream, own?: string[]) => {
				const decoder = new TextDecoder();
				for await (const chunk of stream) {
					sink.write(chunk);
					const text = decoder.decode(chunk, { stream: true });
					chunks.push(text);
					own?.push(text);
				}
			};
			await Promise.all([drain(child.stdout, process.stdout, out), drain(child.stderr, process.stderr)]);
			return { code: await child.exited, stdout: out.join(''), output: chunks.join('') };
		},
		catch: error => new ActionFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
}

export const main: Effect.Effect<void, Invalid> = Effect.gen(function*() {
	const environment = process.env;
	const origin = yield* serviceOrigin;
	const executionId = yield* Effect.fromResult(
		required({ EXECUTION_ID: environment.EXECUTION_ID || environment.BEEPBOOP_EXECUTION_ID }, 'EXECUTION_ID'),
	);
	const mapping = yield* Effect.fromResult(
		attempt(() => credentials.parse(JSON.parse(environment.CREDENTIALS || '{}'))),
	);
	const entries = yield* publishPackages({
		executionId,
		credentials: mapping,
		provenance: publicRepository(environment.GITHUB_EVENT_PATH),
		call: (path, body) => call(origin, path, body),
		run: command,
		sleep: milliseconds => Effect.sleep(milliseconds),
		exists: path => existsSync(path),
		now: () => Date.now(),
		log: line => console.log(line),
	});
	yield* requireAll(entries);
});

if (import.meta.main) await Effect.runPromise(main);
