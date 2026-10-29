import { parse as parseToml } from 'smol-toml';
import { isScalar, parseDocument } from 'yaml';
import { z } from 'zod';
import { semver } from '#model';
import type { ReleasePlan, Snapshot } from './types.ts';

export function safeVersionPath(path: string): boolean {
	return path.length > 0 && !path.startsWith('/') && !path.includes('\\')
		&& !path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')
		&& !/^[A-Za-z]:/.test(path);
}
const common = {
	path: z.string().refine(safeVersionPath, 'Expected a repository-relative path'),
	group: z.string().min(1).optional(),
	template: z.string().max(1000).default('{version}'),
};
export const versionFileSchema = z.discriminatedUnion('format', [
	z.strictObject({
		...common,
		format: z.literal('json'),
		key: z.array(z.union([z.string().min(1), z.number().int().nonnegative()])).min(1),
	}),
	z.strictObject({
		...common,
		format: z.literal('yaml'),
		key: z.array(z.union([z.string().min(1), z.number().int().nonnegative()])).min(1),
	}),
	z.strictObject({ ...common, format: z.literal('toml'), key: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).min(1) }),
	z.strictObject({ ...common, format: z.literal('text'), prefix: z.string().min(1), suffix: z.string().min(1) }),
]);
export type VersionFile = z.infer<typeof versionFileSchema>;

function valueAt(data: unknown, key: (string | number)[]): unknown {
	for (const part of key) {
		if (!data || typeof data !== 'object' || !Object.hasOwn(data, part)) throw new Error('Version field is missing');
		data = Reflect.get(data, part);
	}
	return data;
}

function edit(source: string, rule: VersionFile, version: string): string {
	const value = rule.template.replaceAll('{version}', version);
	if (rule.format === 'text') {
		const start = source.indexOf(rule.prefix);
		if (start < 0 || source.indexOf(rule.prefix, start + 1) >= 0) {
			throw new Error('Text prefix must match exactly once');
		}
		const from = start + rule.prefix.length;
		const to = source.indexOf(rule.suffix, from);
		if (to < 0) throw new Error('Text suffix is missing');
		return source.slice(0, from) + value + source.slice(to);
	}
	if (rule.format === 'toml') {
		const prior = valueAt(parseToml(source), rule.key);
		if (typeof prior !== 'string') throw new Error('TOML version field must be a string');
		let section: string[] = [], count = 0;
		const result = source.split('\n').map(line => {
			const heading = line.match(/^\s*\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/);
			if (heading) section = (heading[1] ?? '').split('.');
			else if (/^\s*\[/.test(line)) section = ['<unsupported table>'];
			const match = line.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)("(?:[^"\\]|\\.)*"|'[^']*')(\s*(?:#.*)?\r?)$/);
			if (!match || JSON.stringify([...section, ...(match[2] ?? '').split('.')]) !== JSON.stringify(rule.key)) {
				return line;
			}
			count++;
			return `${match[1]}${match[2]}${match[3]}${JSON.stringify(value)}${match[5]}`;
		}).join('\n');
		if (count !== 1 || valueAt(parseToml(result), rule.key) !== value) {
			throw new Error('Cannot safely locate TOML version field');
		}
		return result;
	}
	if (rule.format === 'json') JSON.parse(source);
	const document = parseDocument(source, { uniqueKeys: true });
	if (document.errors.length) throw new Error('Invalid version document');
	const node = document.getIn(rule.key, true);
	if (!isScalar(node) || typeof node.value !== 'string' || !node.range) {
		throw new Error('Version field must be a scalar string');
	}
	if (node.anchor || node.tag || node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') {
		throw new Error('Version field cannot use anchors, tags, or block scalars');
	}
	const result = source.slice(0, node.range[0]) + JSON.stringify(value) + source.slice(node.range[1]);
	const updated = parseDocument(result, { uniqueKeys: true });
	if (updated.errors.length) throw new Error('Version edit produced invalid syntax');
	const data = rule.format === 'json' ? JSON.parse(result) : updated.toJS({ maxAliasCount: 100 });
	if (valueAt(data, rule.key) !== value) throw new Error('Version edit did not update the selected field');
	return result;
}

function currentValue(source: string, rule: VersionFile): unknown {
	if (rule.format === 'text') {
		const from = source.indexOf(rule.prefix) + rule.prefix.length;
		return source.slice(from, source.indexOf(rule.suffix, from));
	}
	const data = rule.format === 'toml'
		? parseToml(source)
		: rule.format === 'json'
		? JSON.parse(source)
		: parseDocument(source, { uniqueKeys: true }).toJS({ maxAliasCount: 100 });
	return valueAt(data, rule.key);
}

/** Compose version fields without overwriting a different adapter's chosen version. */
export function applyVersionFiles(
	snapshot: Snapshot,
	files: Record<string, string>,
	rules: VersionFile[],
	versions: Record<string, string>,
): void {
	const selected = new Set<string>();
	for (const rule of rules) {
		const group = rule.group ?? (Object.keys(versions).length === 1 ? Object.keys(versions)[0] : undefined);
		const version = group && Object.hasOwn(versions, group) ? versions[group] : undefined;
		if (!version) throw new Error(`Version file needs a known release group: ${rule.path}`);
		const identity = JSON.stringify([rule.path, rule.format === 'text' ? [rule.prefix, rule.suffix] : rule.key]);
		if (selected.has(identity)) throw new Error(`Duplicate version field: ${rule.path}`);
		selected.add(identity);
		const original = snapshot.files[rule.path];
		const current = files[rule.path];
		if (original === undefined || current === undefined) throw new Error(`Version file is missing: ${rule.path}`);
		edit(original, rule, version);
		const prior = currentValue(original, rule), existing = currentValue(current, rule);
		if (prior !== existing && existing !== rule.template.replaceAll('{version}', version)) {
			throw new Error(`Conflicting version edit: ${rule.path}`);
		}
		const after = edit(current, rule, version);
		files[rule.path] = after;
	}
}

export function planVersionFiles(snapshot: Snapshot, target: unknown, rules: VersionFile[]): ReleasePlan {
	const version = semver(target).replace(/^v/, '');
	const files = { ...snapshot.files };
	applyVersionFiles(snapshot, files, rules, { release: version });
	const requiresPreparation = Object.keys(files).some(path =>
		/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
	);
	return {
		lockfiles: Object.keys(snapshot.files).filter(path =>
			/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(path)
		),
		version,
		sourceSha: snapshot.sha,
		packages: [],
		requiresPreparation,
		diagnostics: requiresPreparation ? ['Preparation workflow must regenerate lockfiles before promotion'] : [],
		edits: Object.entries(files).flatMap(([path, after]) => {
			const before = snapshot.files[path];
			return before === undefined || before === after ? [] : [{ path, before, after }];
		}),
	};
}
