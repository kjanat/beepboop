import { posix } from 'node:path';
import { Effect, Result, Schema } from 'effect';
import { filled, lacking, licenseFile, readmeFile } from '@/discovery/analysis/metadata-fields.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';

export const npmManifest = mutableStruct({
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
	const decoded = Result.getOrUndefined(Result.try(() => decodeURIComponent(path)));
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
				if (Result.getOrUndefined(Result.try(() => decodeURIComponent(path))) === file) return true;
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

export function npmMissing(files: readonly string[], manifest: Decoded<typeof npmManifest>): string[] {
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
