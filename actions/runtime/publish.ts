import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, attemptAsync, fail, required } from '@root/actions/runtime/protocol.ts';
import { call, mask, serviceOrigin } from '@root/actions/runtime/session.ts';
import { Effect } from 'effect';
import { z } from 'zod';
import { githubSecretNamePattern } from '@/contract/ids.ts';
import type { LedgerEntry, LedgerPackage } from '@/contract/ledger.ts';
import { claimStep, nextStep, publishWaitMinutes, settledStep } from '@/contract/ledger.ts';
import { filled, lacking, licenseFile, readmeFile } from '@/contract/package-metadata.ts';
import { textSchema } from '@/model.ts';
import { sha256Hex } from '@/sha256.ts';

export interface Command {
	code: number;
	stdout: string;
	output: string;
}
export interface Runner {
	executionId: string;
	credentials: Record<string, string>;
	provenance: boolean;
	tarballs?: string;
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
	missing: string[];
}

const longestWait = publishWaitMinutes * 60_000;
const packageAttempts = 8;

function sha256(path: string): Effect.Effect<string, ActionFailure> {
	return Effect.fromResult(attempt(() => sha256Hex(readFileSync(path))));
}

function scratch(name: string): Effect.Effect<string, ActionFailure> {
	return Effect.fromResult(
		attempt(() =>
			mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `beepboop-${name.replace(/[^\w.-]+/g, '-')}-`))
		),
	);
}

const cargoMetadata = z.object({
	target_directory: z.string(),
	packages: z.array(z.object({
		name: z.string(),
		description: z.string().nullish(),
		license: z.string().nullish(),
		license_file: z.string().nullish(),
		repository: z.string().nullish(),
	})),
});
const npmManifest = z.object({
	name: z.unknown(),
	version: z.unknown(),
	description: z.unknown(),
	license: z.unknown(),
	repository: z.union([z.string(), z.object({ url: z.unknown() })]).optional().catch(undefined),
});
const secretValues = z.record(z.string(), z.string());
const tarball = z.object({
	filename: z.string(),
	integrity: z.string(),
	files: z.array(z.object({ path: z.string() })),
});
const packed = z.tuple([tarball]).rest(tarball);

function checked(runner: Runner, command: string[], cwd: string): Effect.Effect<string, ActionFailure> {
	return runner.run(command, { cwd }).pipe(Effect.flatMap(result =>
		result.code === 0
			? Effect.succeed(result.stdout)
			: fail(`${command.slice(0, 2).join(' ')} exited ${result.code}\n${result.output.trim()}`)
	));
}

export function pythonMissing(metadata: string, licensed: boolean): string[] {
	const [head = '', ...body] = metadata.replace(/\r\n/g, '\n').split('\n\n');
	const headers = head.split('\n').flatMap(line => {
		const match = /^([\w-]+):\s*(.*)$/.exec(line);
		return match?.[1] && filled(match[2]) ? [match[1].toLowerCase()] : [];
	});
	const has = (...keys: string[]) => keys.some(key => headers.includes(key));
	return lacking({
		README: filled(body.join('\n\n')) || has('description'),
		license: has('license', 'license-expression', 'license-file'),
		'a license file': licensed,
		urls: has('project-url', 'home-page', 'download-url'),
	});
}

export function distributionLicensed(file: string, entries: readonly string[]): boolean {
	if (!file.endsWith('.tar.gz')) {
		return entries.some(entry => /\.dist-info\/(?:licenses\/[^/]|(?:licen[cs]e|copying)[^/]*$)/i.test(entry));
	}
	return entries.some(entry => {
		const inner = entry.slice(entry.indexOf('/') + 1);
		return licenseFile.test(inner) || /^LICENSES\/[^/]/.test(inner);
	});
}

function npmMissing(files: readonly string[], manifest: z.output<typeof npmManifest>): string[] {
	const repository = manifest.repository;
	return lacking({
		README: files.some(path => readmeFile.test(path)),
		description: filled(manifest.description),
		license: filled(manifest.license),
		'a license file': files.some(path => licenseFile.test(path)),
		repository: typeof repository === 'string' ? filled(repository) : filled(repository?.url),
	});
}

function packedManifest(runner: Runner, file: string): Effect.Effect<z.output<typeof npmManifest>, ActionFailure> {
	return checked(runner, ['tar', '-xzOf', file, 'package/package.json'], '.').pipe(
		Effect.flatMap(packaged => Effect.fromResult(attempt(() => npmManifest.parse(JSON.parse(packaged))))),
	);
}

export function tarballIndex(runner: Runner): Effect.Effect<Map<string, string>, ActionFailure> {
	return Effect.gen(function*() {
		const index = new Map<string, string>();
		if (!runner.tarballs) return index;
		const directory = resolve(runner.tarballs);
		const names = yield* Effect.fromResult(
			attempt(() => readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()),
		);
		for (const name of names) {
			const file = join(directory, name);
			const manifest = yield* packedManifest(runner, file);
			const key = `${String(manifest.name)}@${String(manifest.version)}`;
			if (index.has(key)) return yield* fail(`${runner.tarballs} holds two tarballs for ${key}`);
			index.set(key, file);
		}
		return index;
	});
}

function prebuilt(runner: Runner, file: string): Effect.Effect<Artifact, ActionFailure> {
	return Effect.gen(function*() {
		const listing = yield* checked(runner, ['tar', '-tzf', file], '.');
		const files = listing.split('\n').map(line => line.trim().replace(/^package\//, '')).filter(Boolean);
		const manifest = yield* packedManifest(runner, file);
		const bytes = yield* Effect.fromResult(attempt(() => readFileSync(file)));
		return {
			digest: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
			files: [file],
			missing: npmMissing(files, manifest),
		};
	});
}

function build(
	runner: Runner,
	pkg: LedgerPackage,
	toolchain: Effect.Effect<void, ActionFailure>,
	tarballs: Effect.Effect<Map<string, string>, ActionFailure>,
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
			const listed = yield* checked(runner, ['cargo', 'package', '--list', '--manifest-path', pkg.manifest], '.');
			const own = target.packages.find(entry => entry.name === pkg.name);
			const lines = listed.split('\n').map(line => line.trim());
			const missing = lacking({
				README: lines.some(line => readmeFile.test(line)),
				description: filled(own?.description),
				license: filled(own?.license) || filled(own?.license_file),
				'a license file': lines.some(line =>
					licenseFile.test(line) || (own?.license_file && [own.license_file, basename(own.license_file)].includes(line))
				),
				repository: filled(own?.repository),
			});
			yield* checked(runner, ['cargo', 'package', '--manifest-path', pkg.manifest, '--locked'], '.');
			const file = join(target.target_directory, 'package', `${pkg.name}-${pkg.version}.crate`);
			return { digest: yield* sha256(file), files: [file], missing };
		}
		if (pkg.manager === 'pypi') {
			const out = yield* scratch(pkg.name);
			yield* checked(runner, ['uv', 'build', '--project', dir, '--out-dir', out], '.');
			const files = yield* Effect.fromResult(attempt(() => readdirSync(out).sort().map(file => join(out, file))));
			const sdist = files.find(file => file.endsWith('.tar.gz')) ?? files[0];
			if (!sdist) return yield* fail(`uv build produced no distribution for ${pkg.name}`);
			const metadata = yield* checked(
				runner,
				sdist.endsWith('.tar.gz')
					? ['tar', '-xzOf', sdist, `${basename(sdist, '.tar.gz')}/PKG-INFO`]
					: ['unzip', '-p', sdist, '*.dist-info/METADATA'],
				'.',
			);
			const listings = yield* Effect.forEach(
				files,
				file =>
					checked(runner, file.endsWith('.tar.gz') ? ['tar', '-tzf', file] : ['unzip', '-Z1', file], '.').pipe(
						Effect.map(listing => distributionLicensed(file, listing.split('\n').map(line => line.trim()))),
					),
			);
			return { digest: yield* sha256(sdist), files, missing: pythonMissing(metadata, listings.includes(true)) };
		}
		const tarball = (yield* tarballs).get(`${pkg.name}@${pkg.version}`);
		if (tarball) return yield* prebuilt(runner, tarball);
		if (pkg.generated) {
			return yield* fail(
				runner.tarballs
					? `${runner.tarballs} holds no tarball for ${pkg.name} ${pkg.version}`
					: `${pkg.name} is generated; pass its tarball through the npm-tarballs input`,
			);
		}
		const out = yield* scratch(pkg.name);
		const output = yield* checked(runner, ['npm', 'pack', '--json', '--pack-destination', out], dir);
		const start = output.startsWith('[') ? 0 : output.lastIndexOf('\n[') + 1;
		const [first] = yield* Effect.fromResult(attempt(() => packed.parse(JSON.parse(output.slice(start)))));
		const file = join(out, first.filename);
		const manifest = yield* packedManifest(runner, file);
		const missing = npmMissing(first.files.map(entry => entry.path), manifest);
		return { digest: first.integrity, files: [file], missing };
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

const httpDate = String.raw`, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT`;
const retryAfter = new RegExp(`try again after ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)${httpDate})`, 'i');
const retryHeader = new RegExp(String.raw`retry-after:\s*(\d+|[A-Z][a-z]{2}${httpDate})`, 'i');

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
		step('/api/workflow/publish/report', settledStep, {
			purl: pkg.purl,
			...outcome,
			...(outcome.outcome === 'published' ? { moveOn: true } : {}),
		});
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
	const deadline = runner.now() + longestWait;
	const sleep = (until: number, reason: string) =>
		Effect.gen(function*() {
			const wait = until - runner.now();
			runner.log(`${reason}; waiting ${Math.ceil(Math.max(0, wait) / 1000)}s`);
			if (wait > 0) yield* runner.sleep(wait);
		});
	const pause = (until: number, reason: string) =>
		until > deadline ? Effect.succeed(false) : sleep(until, reason).pipe(Effect.as(true));
	let index: Map<string, string> | undefined;
	const tarballs = Effect.gen(function*() {
		index ??= yield* tarballIndex(runner);
		return index;
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
			const built = yield* Effect.result(build(runner, pkg, toolchain, tarballs));
			if (built._tag === 'Failure') {
				const reported = yield* report(pkg, { outcome: 'failed', message: built.failure.message });
				if (reported.kind === 'settled') runner.log(`${pkg.name} ${pkg.version}: ${show(reported.entry)}`);
				return;
			}
			const artifact = built.success;
			if (artifact.missing.length) {
				const reported = yield* report(pkg, {
					outcome: 'failed',
					message: `The ${pkg.name} ${pkg.version} package lacks ${artifact.missing.join(', ')}`,
				});
				if (reported.kind === 'settled') runner.log(`${pkg.name} ${pkg.version}: ${show(reported.entry)}`);
				return;
			}
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
			const reported = yield* report(pkg, classify(result));
			runner.log(`${pkg.name} ${pkg.version}: ${show(reported.entry)}`);
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
	const missing = entries.filter(entry => entry.required && !['uploaded', 'published', 'reused'].includes(entry.state));
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

const credentials = z.record(z.string().regex(githubSecretNamePattern), textSchema);

export function command(argv: string[], options: { cwd: string; env?: Record<string, string> }) {
	return attemptAsync(async (): Promise<Command> => {
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
		...(environment.NPM_TARBALLS ? { tarballs: environment.NPM_TARBALLS } : {}),
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
