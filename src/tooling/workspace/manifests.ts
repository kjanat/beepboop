import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { ToolFailure } from '@/tooling/runtime';
import { parse, readJson } from '@/tooling/runtime';
import type { ReferenceKind } from '@/tooling/workspace/modules';
import { candidatePaths, packageOf, repositoryPath, splitQuery } from '@/tooling/workspace/modules';

type ExportTarget = string | null | { readonly [key: string]: ExportTarget };
const exportTarget: Schema.Codec<ExportTarget> = Schema.Union([
	Schema.String,
	Schema.Null,
	Schema.Record(Schema.String, Schema.suspend(() => exportTarget)),
]);
const dependencyMap = Schema.optional(Schema.Record(Schema.String, Schema.String));
const conditions: Readonly<Record<ReferenceKind, ReadonlySet<string>>> = {
	import: new Set(['bun', 'import', 'module', 'node', 'default']),
	require: new Set(['bun', 'require', 'node', 'default']),
};
const manifestSchema = Schema.Struct({
	name: Schema.String,
	dependencies: dependencyMap,
	devDependencies: dependencyMap,
	peerDependencies: dependencyMap,
	optionalDependencies: dependencyMap,
	files: Schema.optional(Schema.Array(Schema.String)),
	bin: Schema.optional(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
	exports: Schema.optional(exportTarget),
});

export interface Workspace {
	readonly directory: string;
	readonly name: string;
	readonly dependencies: ReadonlySet<string>;
	readonly base: string;
	readonly outputs: ReadonlySet<string>;
	readonly exports: ReadonlyMap<string, ExportTarget>;
}

function subpaths(field: ExportTarget | undefined): Map<string, ExportTarget> {
	if (field === undefined || field === null) return new Map();
	if (typeof field === 'string') return new Map([['.', field]]);
	const keys = Object.keys(field);
	return keys.length && keys.every(key => key.startsWith('.'))
		? new Map(Object.entries(field))
		: new Map([['.', field]]);
}

function conditional(target: ExportTarget | undefined, kind: ReferenceKind): string | null | undefined {
	if (target === undefined || target === null || typeof target === 'string') return target;
	for (const [name, branch] of Object.entries(target)) {
		if (!conditions[kind].has(name)) continue;
		const resolved = conditional(branch, kind);
		if (resolved !== undefined) return resolved;
	}
	return undefined;
}

function values(field: string | Readonly<Record<string, string>> | undefined, key: string): [string, string][] {
	if (field === undefined) return [];
	return typeof field === 'string' ? [[key, field]] : Object.entries(field);
}

export const readWorkspaces = Effect.fn('readWorkspaces')(function*(
	root: string,
	files: readonly string[],
): Effect.fn.Return<Map<string, Workspace>, ToolFailure> {
	const found = new Map<string, Workspace>();
	for (const file of files) {
		const directory = packageOf(file);
		if (!directory || file !== `packages/${directory}/package.json`) continue;
		const manifest = yield* parse(manifestSchema, yield* readJson(join(root, file)));
		const declared = [
			manifest.dependencies,
			manifest.devDependencies,
			manifest.peerDependencies,
			manifest.optionalDependencies,
		].flatMap(map => Object.keys(map ?? {}));
		const base = `packages/${directory}`;
		const outputs = [...(manifest.files ?? []), ...values(manifest.bin, manifest.name).map(([, path]) => path)];
		found.set(directory, {
			directory,
			name: manifest.name,
			dependencies: new Set(declared),
			base,
			outputs: new Set(outputs.map(path => repositoryPath(join(base, path)))),
			exports: subpaths(manifest.exports),
		});
	}
	return found;
});

export function packageName(specifier: string): string {
	const [path] = splitQuery(specifier);
	const [scope, name] = path.split('/');
	return path.startsWith('@') && name ? `${scope}/${name}` : scope ?? path;
}

export function workspaceOf(workspaces: Iterable<Workspace>, specifier: string): Workspace | undefined {
	const name = packageName(specifier);
	for (const workspace of workspaces) if (workspace.name === name) return workspace;
	return undefined;
}

export function exported(
	workspace: Workspace,
	files: ReadonlySet<string>,
	specifier: string,
	kind: ReferenceKind,
): string | undefined {
	const [path] = splitQuery(specifier);
	const subpath = `.${path.slice(workspace.name.length)}`;
	let selected: { target: ExportTarget | undefined; rest: string } | undefined = workspace.exports.has(subpath)
		? { target: workspace.exports.get(subpath), rest: '' }
		: undefined;
	if (!selected) {
		let best: { readonly star: number; readonly length: number } | undefined;
		for (const [key, target] of workspace.exports) {
			const star = key.indexOf('*');
			if (star < 0) continue;
			const head = key.slice(0, star), tail = key.slice(star + 1);
			if (!subpath.startsWith(head) || !subpath.endsWith(tail) || subpath.length < key.length) continue;
			if (best && (star < best.star || (star === best.star && key.length <= best.length))) continue;
			best = { star, length: key.length };
			selected = { target, rest: subpath.slice(head.length, subpath.length - tail.length) };
		}
	}
	const target = conditional(selected?.target, kind);
	if (typeof target !== 'string' || !selected) return undefined;
	const base = repositoryPath(join(workspace.base, target.replaceAll('*', selected.rest)));
	return candidatePaths(base).find(candidate => files.has(candidate));
}

export function exportSpecifiers(workspace: Workspace, path: string, query: string, kind: ReferenceKind): string[] {
	const found: string[] = [];
	for (const [key, entry] of workspace.exports) {
		const target = conditional(entry, kind);
		if (typeof target !== 'string') continue;
		const resolved = repositoryPath(join(workspace.base, target));
		const star = resolved.indexOf('*');
		if (star < 0) {
			if (resolved === path) found.push(`${workspace.name}${key.slice(1)}${query}`);
			continue;
		}
		const head = resolved.slice(0, star), tail = resolved.slice(star + 1);
		if (!path.startsWith(head) || !path.endsWith(tail) || resolved.indexOf('*', star + 1) >= 0) continue;
		const rest = path.slice(head.length, path.length - tail.length);
		found.push(`${workspace.name}${key.replaceAll('*', rest).slice(1)}${query}`);
	}
	return found;
}
