import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import type { Invalid } from '@root/actions/runtime/protocol.ts';
import { ActionFailure, attempt, attemptAsync, fail, required } from '@root/actions/runtime/protocol.ts';
import { call, mask, serviceOrigin } from '@root/actions/runtime/session.ts';
import type { Scope } from 'effect';
import { Clock, Effect, Result, Schema } from 'effect';
import type { LedgerEntry, LedgerPackage } from '@/contract/ledger.ts';
import { claimStep, nextStep, publishWaitMinutes, settledStep } from '@/contract/ledger.ts';
import { filled, lacking, licenseFile, readmeFile } from '@/discovery/analysis/metadata-fields.ts';
import { runMain } from '@/host/main.ts';
import { terminate } from '@/host/process.ts';
import { sha256Hex } from '@/kernel/crypto/sha256.ts';
import { githubSecretNamePattern } from '@/kernel/schema/ids.ts';
import { textSchema } from '@/kernel/schema/result.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { decodeSync, matchesPattern, mutableArray, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';

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
const workspacePackers: readonly { readonly lockfiles: readonly string[]; readonly command: readonly string[] }[] = [
	{ lockfiles: ['bun.lock', 'bun.lockb'], command: ['bun', 'pm', 'pack', '--destination'] },
	{ lockfiles: ['pnpm-lock.yaml'], command: ['pnpm', 'pack', '--pack-destination'] },
];
const packageAttempts = 8;

function sha256(path: string): Effect.Effect<string, ActionFailure> {
	return Effect.fromResult(attempt(() => sha256Hex(readFileSync(path))));
}

function scratch(name: string): Effect.Effect<string, ActionFailure, Scope.Scope> {
	return Effect.acquireRelease(
		Effect.sync(() =>
			attempt(() =>
				mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), `beepboop-${name.replace(/[^\w.-]+/g, '-')}-`))
			)
		).pipe(Effect.flatMap(Effect.fromResult)),
		directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
	);
}

const cargoMetadata = mutableStruct({
	target_directory: Schema.String,
	packages: mutableArray(mutableStruct({
		name: Schema.String,
		description: Schema.optional(Schema.NullOr(Schema.String)),
		license: Schema.optional(Schema.NullOr(Schema.String)),
		license_file: Schema.optional(Schema.NullOr(Schema.String)),
		repository: Schema.optional(Schema.NullOr(Schema.String)),
	})),
});
const npmManifest = mutableStruct({
	name: Schema.Unknown,
	version: Schema.Unknown,
	description: Schema.Unknown,
	license: Schema.Unknown,
	repository: Schema.optional(Schema.Union([Schema.String, mutableStruct({ url: Schema.Unknown })])).pipe(
		Schema.catchDecoding(() => Effect.succeedSome(undefined)),
	),
	main: Schema.optional(Schema.Unknown),
	module: Schema.optional(Schema.Unknown),
	types: Schema.optional(Schema.Unknown),
	typings: Schema.optional(Schema.Unknown),
	bin: Schema.optional(Schema.Unknown),
	exports: Schema.optional(Schema.Unknown),
	dependencies: Schema.optional(Schema.Unknown),
	optionalDependencies: Schema.optional(Schema.Unknown),
	peerDependencies: Schema.optional(Schema.Unknown),
});
const secretValues = mutableRecord(Schema.String, Schema.String);
const tarball = mutableStruct({
	filename: Schema.String,
	integrity: Schema.String,
	files: mutableArray(mutableStruct({ path: Schema.String })),
});
const packed = Schema.mutable(Schema.TupleWithRest(Schema.Tuple([tarball]), [tarball]));

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

type EntryPoint =
	| { readonly kind: 'file'; readonly path: string }
	| { readonly kind: 'pattern'; readonly path: string; readonly parts: readonly string[]; readonly suffix: string };

const mainProbes = ['', '.js', '.json', '.node', '/index.js', '/index.json', '/index.node'];
const declarationProbes = ['', '.d.ts', '.ts', '.tsx', '/index.d.ts', '/index.ts', '/index.tsx'];

function entryPoints(value: unknown): EntryPoint[] {
	if (typeof value === 'string') return [{ kind: 'file', path: posix.normalize(value) }];
	return value !== null && typeof value === 'object' ? Object.values(value).flatMap(entryPoints) : [];
}

type Resolution =
	| { readonly kind: 'target'; readonly entry: EntryPoint }
	| { readonly kind: 'unusable'; readonly value: string }
	| { readonly kind: 'invalid'; readonly value: unknown }
	| { readonly kind: 'malformed'; readonly reason: string }
	| { readonly kind: 'excluded' }
	| { readonly kind: 'unmatched' };

type Chosen = Extract<Resolution, { readonly kind: 'target' | 'unusable' }>;

function validTarget(value: string): boolean {
	const forbidden = value.slice(2).split(/[/\\]/).some(segment =>
		/^(?:\.{1,2}|node_modules)$/i.test(
			segment.replace(/%([0-9a-f]{2})/gi, (_, byte: string) => String.fromCharCode(parseInt(byte, 16))),
		)
	);
	return value.startsWith('./') && !forbidden && new URL(value, 'file:///package/').pathname.startsWith('/package/');
}

function exportTarget(value: string, pattern: boolean): Chosen {
	const { href, pathname, search, hash } = new URL(value, 'file:///package/');
	const path = posix.normalize(pathname.slice('/package/'.length));
	if (/%2f|%5c/i.test(href)) return { kind: 'unusable', value };
	const decoded = Result.getOrUndefined(attempt(() => decodeURIComponent(path)));
	if (pattern && path.includes('*')) {
		return {
			kind: 'target',
			entry: { kind: 'pattern', path: decoded ?? path, parts: path.split('*'), suffix: search + hash },
		};
	}
	return decoded === undefined
		? { kind: 'unusable', value }
		: { kind: 'target', entry: { kind: 'file', path: decoded } };
}

function arrayIndex(key: string): boolean {
	const index = Number(key);
	return String(index) === key && index >= 0 && index < 0xffffffff;
}

interface World {
	readonly active: readonly string[];
	readonly inactive: readonly string[];
}

interface Pending {
	readonly world: World;
	readonly resolution: Exclude<Resolution, Chosen>;
}

interface Resolved {
	readonly chosen: readonly Chosen[];
	readonly pending: readonly Pending[];
}

function conditionNames(value: unknown, into: Set<string>): Set<string> {
	if (Array.isArray(value)) {
		for (const fallback of value) conditionNames(fallback, into);
	} else if (value !== null && typeof value === 'object') {
		for (const [condition, branch] of Object.entries(value)) {
			if (condition !== 'default') into.add(condition);
			conditionNames(branch, into);
		}
	}
	return into;
}

function namedLater(outer: ReadonlySet<string>, later: unknown): ReadonlySet<string> {
	return conditionNames(later, new Set(outer));
}

function project(world: World, keep: ReadonlySet<string>): World {
	return {
		active: world.active.filter(name => keep.has(name)),
		inactive: world.inactive.filter(name => keep.has(name)),
	};
}

function assume(world: World, condition: string, active: boolean): World {
	return active
		? { active: [...world.active, condition].sort(), inactive: world.inactive }
		: { active: world.active, inactive: [...world.inactive, condition].sort() };
}

function distinct<T>(items: readonly T[], key: (item: T) => string): T[] {
	return [...new Map(items.map(item => [key(item), item])).values()];
}

const worldKey = (world: World) => JSON.stringify([world.active, world.inactive]);

function without(world: World, condition: string): World {
	return {
		active: world.active.filter(name => name !== condition),
		inactive: world.inactive.filter(name => name !== condition),
	};
}

function narrower(specific: World, general: World): boolean {
	return specific !== general
		&& general.active.every(name => specific.active.includes(name))
		&& general.inactive.every(name => specific.inactive.includes(name));
}

function simplify(worlds: readonly World[]): World[] {
	const unique = distinct(worlds, worldKey);
	const keys = new Set(unique.map(worldKey));
	const merged = distinct(
		unique.map(world => {
			const condition = [...world.active, ...world.inactive].find(name =>
				keys.has(worldKey(assume(without(world, name), name, !world.active.includes(name))))
			);
			return condition === undefined ? world : without(world, condition);
		}),
		worldKey,
	);
	const kept = merged.filter(world => !merged.some(other => narrower(world, other)));
	return kept.length < unique.length ? simplify(kept) : kept;
}

function simplifyPending(items: readonly Pending[]): Pending[] {
	const groups = new Map<string, { readonly resolution: Pending['resolution']; readonly worlds: World[] }>();
	for (const item of items) {
		const key = JSON.stringify(item.resolution);
		const group = groups.get(key) ?? { resolution: item.resolution, worlds: [] };
		group.worlds.push(item.world);
		groups.set(key, group);
	}
	return [...groups.values()].flatMap(group =>
		simplify(group.worlds).map((world): Pending => ({ world, resolution: group.resolution }))
	);
}

function resolveTargets(value: unknown, world: World, pattern: boolean, outer: ReadonlySet<string>): Resolved {
	const settle = (resolution: Pending['resolution']): Resolved => ({
		chosen: [],
		pending: [{ world: project(world, outer), resolution }],
	});
	if (typeof value === 'string') {
		return validTarget(value)
			? { chosen: [exportTarget(value, pattern)], pending: [] }
			: settle({ kind: 'invalid', value });
	}
	if (value === null || (Array.isArray(value) && value.length === 0)) return settle({ kind: 'excluded' });
	if (Array.isArray(value)) {
		const chosen: Chosen[] = [];
		const thrown: Pending[] = [];
		let pending: Pending[] = [{ world: project(world, namedLater(outer, value)), resolution: { kind: 'unmatched' } }];
		for (const [index, fallback] of value.entries()) {
			const keep = namedLater(outer, value.slice(index + 1));
			const next: Pending[] = [];
			for (const previous of pending) {
				const resolved = resolveTargets(fallback, previous.world, pattern, keep);
				chosen.push(...resolved.chosen);
				for (const outcome of resolved.pending) {
					if (outcome.resolution.kind === 'malformed') {
						thrown.push({ world: project(outcome.world, outer), resolution: outcome.resolution });
						continue;
					}
					const resolution = outcome.resolution.kind === 'unmatched' ? previous.resolution : outcome.resolution;
					next.push({ world: project(outcome.world, keep), resolution });
				}
			}
			pending = simplifyPending(next);
		}
		return { chosen, pending: simplifyPending([...thrown, ...pending]) };
	}
	if (typeof value !== 'object') return settle({ kind: 'invalid', value });
	const numeric = Object.keys(value).find(arrayIndex);
	if (numeric !== undefined) return settle({ kind: 'malformed', reason: `numeric key ${JSON.stringify(numeric)}` });
	const entries = Object.entries(value);
	const chosen: Chosen[] = [];
	const settled: Pending[] = [];
	let unmatched: World[] = [project(world, namedLater(outer, value))];
	for (const [index, [condition, branch]] of entries.entries()) {
		const keep = namedLater(outer, Object.fromEntries(entries.slice(index + 1)));
		const next: World[] = [];
		for (const current of unmatched) {
			const always = condition === 'default' || current.active.includes(condition);
			if (!always && current.inactive.includes(condition)) {
				next.push(project(current, keep));
				continue;
			}
			if (!always) next.push(project(assume(current, condition, false), keep));
			const resolved = resolveTargets(branch, always ? current : assume(current, condition, true), pattern, keep);
			chosen.push(...resolved.chosen);
			for (const outcome of resolved.pending) {
				if (outcome.resolution.kind === 'unmatched') next.push(project(outcome.world, keep));
				else settled.push({ world: project(outcome.world, outer), resolution: outcome.resolution });
			}
		}
		unmatched = simplify(next);
	}
	return {
		chosen,
		pending: simplifyPending(
			[
				...settled,
				...unmatched.map((current): Pending => ({
					world: project(current, outer),
					resolution: { kind: 'unmatched' },
				})),
			],
		),
	};
}

function exportResolutions(value: unknown, pattern: boolean): Resolution[] {
	const resolved = resolveTargets(value, { active: [], inactive: [] }, pattern, new Set());
	return [...resolved.chosen, ...resolved.pending.map(outcome => outcome.resolution)];
}

function packageExports(field: unknown): Resolution[] {
	if (field === undefined) return [];
	if (field === null || typeof field !== 'object' || Array.isArray(field)) return exportResolutions(field, false);
	const subpaths = Object.entries(field);
	const subpath = subpaths.find(([key]) => key.startsWith('.'));
	const condition = subpaths.find(([key]) => !key.startsWith('.'));
	if (subpath && condition) {
		const reason = `subpath key ${JSON.stringify(subpath[0])} beside condition key ${JSON.stringify(condition[0])}`;
		return [{ kind: 'malformed', reason }];
	}
	return subpath
		? subpaths.flatMap(([key, value]) => exportResolutions(value, key.includes('*')))
		: exportResolutions(field, false);
}

// A complete %HH occupies three URL characters and contributes one filename byte.
// This count is additive even when a wildcard splits the escape.
function urlByteLength(text: string): number {
	return text.length - 2 * (text.match(/%/g)?.length ?? 0);
}

// Offsets into a filename spelled entirely as %HH triplets. Immediately after
// a '%' the length above counts one fewer byte than before that triplet.
function tripletOffset(length: number, partial: number): number {
	return 3 * (length + (partial === 1 ? 1 : 0)) + partial;
}

function* wildcardSpellings(raw: string, partial: number, suffix: string) {
	// A leading hex nibble can also appear as literal text at a repeated star.
	const head = raw.slice(0, partial === 0 ? 0 : 3 - partial);
	const body = raw.slice(head.length).replace(/%([\da-f]{2})/gi, (encoded, hex: string) => {
		const char = String.fromCharCode(parseInt(hex, 16));
		return /^[\w./~-]$/.test(char) ? char : encoded;
	});
	const first = head.slice(0, 1);
	const second = head.slice(1);
	for (
		const leading of new Set([head, head.toUpperCase(), first.toUpperCase() + second, first + second.toUpperCase()])
	) {
		const capture = leading + body;
		yield capture;
		// The same capture can complete a forbidden %2F or %5C in the query or fragment.
		if (suffix.includes('*')) {
			for (const index of [0, 1]) {
				const digit = capture.charAt(index);
				if (/^[\da-f]$/i.test(digit)) {
					yield `${capture.slice(0, index)}%${digit.charCodeAt(0).toString(16)}${capture.slice(index + 1)}`;
				}
			}
		}
	}
}

function patternShipped(files: ReadonlySet<string>, entry: Extract<EntryPoint, { kind: 'pattern' }>): boolean {
	const [prefix = ''] = entry.parts;
	const [literalPrefix = ''] = prefix.split('%', 1);
	const fixedLength = entry.parts.reduce((sum, part) => sum + urlByteLength(part), 0);
	const prefixLength = urlByteLength(prefix);
	const partial = /%[\da-f]?$/i.exec(prefix)?.[0].length ?? 0;
	const start = tripletOffset(prefixLength, partial);
	return [...files].some(file => {
		if (!file.startsWith(literalPrefix)) return false;
		const bytes = Buffer.from(file);
		const captureLength = (bytes.length - fixedLength) / (entry.parts.length - 1);
		if (!Number.isInteger(captureLength) || start < 0 || start >= bytes.length * 3) return false;
		const triplets = bytes.toString('hex').replace(/../g, '%$&');
		for (const tail of [0, 1, 2]) {
			const end = tripletOffset(prefixLength + captureLength, tail);
			if (end <= start || end > triplets.length) continue;
			for (const capture of wildcardSpellings(triplets.slice(start, end), partial, entry.suffix)) {
				if (!validTarget(`./${capture}`)) continue;
				const path = entry.parts.join(capture);
				if (/%2f|%5c/i.test(path + entry.suffix.replaceAll('*', () => capture))) continue;
				if (Result.getOrUndefined(attempt(() => decodeURIComponent(path))) === file) return true;
			}
		}
		return false;
	});
}

function shipped(files: ReadonlySet<string>, entry: EntryPoint, probes: readonly string[]): boolean {
	if (entry.kind === 'file') {
		const candidates = entry.path.endsWith('/') ? probes.filter(probe => probe.startsWith('/')) : probes;
		return candidates.some(probe => files.has(posix.normalize(`${entry.path}${probe}`)));
	}
	return patternShipped(files, entry);
}

function unresolved(field: unknown): string[] {
	if (field === null || typeof field !== 'object') return [];
	return Object.entries(field).flatMap(([name, range]) =>
		typeof range === 'string' && /^(?:workspace|catalog):/.test(range)
			? [`a published version for ${name} (${range})`]
			: []
	);
}

function exportProblem(resolution: Resolution): string[] {
	switch (resolution.kind) {
		case 'invalid':
			return [`a valid exports target (found ${JSON.stringify(resolution.value)})`];
		case 'unusable':
			return [`a resolvable exports target (found ${JSON.stringify(resolution.value)})`];
		case 'malformed':
			return [`a valid exports map (found ${resolution.reason})`];
		default:
			return [];
	}
}

function npmMissing(files: readonly string[], manifest: Decoded<typeof npmManifest>): string[] {
	const repository = manifest.repository;
	const packed = new Set(files);
	const main = entryPoints(manifest.main).filter(entry => !shipped(packed, entry, mainProbes));
	const declarations = [manifest.types, manifest.typings].flatMap(field => entryPoints(field))
		.filter(entry => !shipped(packed, entry, declarationProbes));
	const exports = packageExports(manifest.exports);
	const declared = [
		...[manifest.module, manifest.bin].flatMap(field => entryPoints(field)),
		...exports.flatMap(resolution => resolution.kind === 'target' ? [resolution.entry] : []),
	].filter(entry => !shipped(packed, entry, ['']));
	return [
		...lacking({
			README: files.some(path => readmeFile.test(path)),
			description: filled(manifest.description),
			license: filled(manifest.license),
			'a license file': files.some(path => licenseFile.test(path)),
			repository: typeof repository === 'string' ? filled(repository) : filled(repository?.url),
		}),
		...new Set([...main, ...declarations, ...declared].map(entry => entry.path)),
		...new Set(exports.flatMap(exportProblem)),
		...[manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies].flatMap(unresolved),
	];
}

function packedManifest(runner: Runner, file: string): Effect.Effect<Decoded<typeof npmManifest>, ActionFailure> {
	return checked(runner, ['tar', '-xzOf', file, 'package/package.json'], '.').pipe(
		Effect.flatMap(packaged => Effect.fromResult(attempt(() => decodeSync(npmManifest, JSON.parse(packaged))))),
	);
}

function tarballIndex(runner: Runner): Effect.Effect<Map<string, string>, ActionFailure> {
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
		const files = listing.split('\n').map(line => line.trim().replace(/^package\//, ''))
			.filter(line => line !== '' && !line.endsWith('/'));
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
	tarballs: ReadonlyMap<string, string>,
): Effect.Effect<Artifact, ActionFailure, Scope.Scope> {
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
			const target = yield* Effect.fromResult(attempt(() => decodeSync(cargoMetadata, JSON.parse(metadata))));
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
		const tarball = tarballs.get(`${pkg.name}@${pkg.version}`);
		if (tarball) return yield* prebuilt(runner, tarball);
		if (pkg.generated) {
			return yield* fail(
				runner.tarballs
					? `${runner.tarballs} holds no tarball for ${pkg.name} ${pkg.version}`
					: `${pkg.name} is generated; pass its tarball through the npm-tarballs input`,
			);
		}
		const out = yield* scratch(pkg.name);
		const packer = workspacePackers.find(({ lockfiles }) => lockfiles.some(file => runner.exists(file)));
		if (packer) {
			yield* checked(runner, [...packer.command, out], dir);
			const written = yield* Effect.fromResult(attempt(() => readdirSync(out).filter(name => name.endsWith('.tgz'))));
			const [file, ...extra] = written;
			if (!file || extra.length) {
				return yield* fail(`${packer.command.join(' ')} wrote ${written.length} tarballs for ${pkg.name}`);
			}
			return yield* prebuilt(runner, join(out, file));
		}
		const output = yield* checked(runner, ['npm', 'pack', '--json', '--pack-destination', out], dir);
		const start = output.startsWith('[') ? 0 : output.lastIndexOf('\n[') + 1;
		const [first] = yield* Effect.fromResult(attempt(() => decodeSync(packed, JSON.parse(output.slice(start)))));
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
	const step = <S extends Contract>(path: `/api/workflow/publish/${string}`, schema: S, body: object) =>
		runner.call(path, { executionId: runner.executionId, ...body }).pipe(
			Effect.flatMap(value =>
				Effect.fromResult(attempt((): Decoded<S> => decodeSync(schema, value))).pipe(
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
		const values = yield* Effect.fromResult(attempt(() => decodeSync(secretValues, granted)));
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
	let installed = false;
	const toolchain = Effect.gen(function*() {
		if (installed || !['rust-toolchain.toml', 'rust-toolchain'].some(file => runner.exists(file))) return;
		yield* checked(runner, ['rustup', 'toolchain', 'install'], '.');
		installed = true;
	});
	const one = (pkg: LedgerPackage, tarballs: ReadonlyMap<string, string>) =>
		Effect.gen(function*() {
			runner.log(`Building ${pkg.name} ${pkg.version}`);
			const built = yield* Effect.result(build(runner, pkg, toolchain, tarballs));
			if (built._tag === 'Failure') {
				const reported = yield* report(pkg, { outcome: 'failed', message: built.failure.message });
				if (reported.kind === 'settled') runner.log(`${pkg.name} ${pkg.version}: ${show(reported.entry)}`);
				return;
			}
			const artifact = built.success;
			if (artifact.missing.length && !pkg.force) {
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
		}).pipe(Effect.scoped);
	return Effect.gen(function*() {
		const tarballs = yield* tarballIndex(runner);
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
			yield* one(handed.package, tarballs);
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

export function publicRepository(privateValue: string | undefined): boolean {
	return privateValue === 'false';
}

const credentials = mutableRecord(Schema.String.check(matchesPattern(githubSecretNamePattern)), textSchema);

export function command(argv: string[], options: { cwd: string; env?: Record<string, string> }) {
	return Effect.acquireUseRelease(
		Effect.sync(() => attempt(() => Bun.spawn(argv, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdout: 'pipe',
			stderr: 'pipe',
		}))).pipe(Effect.flatMap(Effect.fromResult)),
		child => attemptAsync(async (): Promise<Command> => {
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
		}),
		terminate,
	);
}

export const main: Effect.Effect<void, Invalid> = Effect.gen(function*() {
	const clock = yield* Clock.Clock;
	const environment = process.env;
	const origin = yield* serviceOrigin;
	const executionId = yield* Effect.fromResult(
		required({ EXECUTION_ID: environment.EXECUTION_ID || environment.BEEPBOOP_EXECUTION_ID }, 'EXECUTION_ID'),
	);
	const mapping = yield* Effect.fromResult(
		attempt(() => decodeSync(credentials, JSON.parse(environment.CREDENTIALS || '{}'))),
	);
	const entries = yield* publishPackages({
		executionId,
		credentials: mapping,
		provenance: publicRepository(environment.REPOSITORY_PRIVATE),
		...(environment.NPM_TARBALLS ? { tarballs: environment.NPM_TARBALLS } : {}),
		call: (path, body) => call(origin, path, body),
		run: command,
		sleep: milliseconds => Effect.sleep(milliseconds),
		exists: path => existsSync(path),
		now: () => clock.currentTimeMillisUnsafe(),
		log: line => console.log(line),
	});
	yield* requireAll(entries);
});

if (import.meta.main) await runMain(main);
