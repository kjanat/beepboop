import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, main, refuse } from '@/tooling/runtime';
import { exported, packageName, readWorkspaces } from '@/tooling/workspace/manifests';
import {
	isCode,
	isLocal,
	isRelative,
	packageOf,
	readAliases,
	references,
	repositoryPath,
	resolveReference,
	splitQuery,
	trackedFiles,
} from '@/tooling/workspace/modules';

const platformModules = /^(?:node:|bun:|cloudflare:|astro:|virtual:)|^bun$/;
const builtins = new Set(builtinModules);
const rootAssets = ['schemas/', 'presets/'];

export type Violation =
	| { readonly _tag: 'OutsidePackage'; readonly file: string; readonly specifier: string; readonly target: string }
	| { readonly _tag: 'Undeclared'; readonly file: string; readonly specifier: string; readonly dependency: string }
	| { readonly _tag: 'Unresolved'; readonly file: string; readonly specifier: string }
	| { readonly _tag: 'Cycle'; readonly packages: readonly string[] }
	| { readonly _tag: 'DuplicateEffect'; readonly path: string };

export interface BoundaryReport {
	readonly files: number;
	readonly packages: number;
	readonly violations: readonly Violation[];
}

function cycles(edges: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
	const found: string[][] = [];
	const done = new Set<string>();
	const visit = (node: string, path: string[]) => {
		const start = path.indexOf(node);
		if (start >= 0) {
			found.push([...path.slice(start), node]);
			return;
		}
		if (done.has(node)) return;
		for (const next of edges.get(node) ?? []) visit(next, [...path, node]);
		done.add(node);
	};
	for (const node of edges.keys()) visit(node, []);
	return found;
}

export function describe(violation: Violation): string {
	switch (violation._tag) {
		case 'OutsidePackage':
			return `${violation.file} imports ${violation.specifier}, which resolves outside any package (${violation.target})`;
		case 'Undeclared':
			return `${violation.file} imports ${violation.specifier} without declaring ${violation.dependency}`;
		case 'Unresolved':
			return `${violation.file} imports ${violation.specifier}, which resolves to no tracked file`;
		case 'Cycle':
			return `Package cycle: ${violation.packages.join(' -> ')}`;
		case 'DuplicateEffect':
			return `A second copy of effect is installed at ${violation.path}`;
	}
}

export const checkBoundaries = Effect.fn('checkBoundaries')(function*(
	root: string,
): Effect.fn.Return<BoundaryReport, ToolFailure> {
	const files = yield* trackedFiles(root);
	const known = new Set(files);
	const aliases = yield* readAliases(root);
	const packages = yield* readWorkspaces(root, files);
	const names = new Map([...packages.values()].map(workspace => [workspace.name, workspace]));
	const violations: Violation[] = [];
	const edges = new Map<string, Set<string>>();
	const checked = files.filter(file => isCode(file) && packages.has(packageOf(file) ?? ''));
	for (const file of checked) {
		const owner = packages.get(packageOf(file) ?? '');
		if (!owner) continue;
		const source = yield* attemptPromise(() => Bun.file(join(root, file)).text());
		for (const { specifier, kind } of references(file, source)) {
			const [path] = splitQuery(specifier);
			const named = names.get(packageName(specifier));
			if (isLocal(aliases, specifier)) {
				const target = resolveReference(aliases, known, file, specifier);
				if (target === undefined) {
					const output = isRelative(path) && owner.outputs.has(repositoryPath(join(dirname(file), path)));
					if (!output) violations.push({ _tag: 'Unresolved', file, specifier });
					continue;
				}
				if (rootAssets.some(asset => target.startsWith(asset))) continue;
				const dependency = packages.get(packageOf(target) ?? '');
				if (!dependency) {
					violations.push({ _tag: 'OutsidePackage', file, specifier, target });
					continue;
				}
				if (dependency.directory === owner.directory) continue;
				edges.set(owner.name, (edges.get(owner.name) ?? new Set()).add(dependency.name));
				if (!owner.dependencies.has(dependency.name)) {
					violations.push({ _tag: 'Undeclared', file, specifier, dependency: dependency.name });
				}
				continue;
			}
			if (platformModules.test(path) || builtins.has(path)) continue;
			if (named && named.directory !== owner.directory) {
				edges.set(owner.name, (edges.get(owner.name) ?? new Set()).add(named.name));
			}
			if (named && exported(named, known, specifier, kind) === undefined) {
				violations.push({ _tag: 'Unresolved', file, specifier });
				continue;
			}
			if (named?.directory === owner.directory) continue;
			const dependency = named?.name ?? packageName(specifier);
			if (!owner.dependencies.has(dependency)) violations.push({ _tag: 'Undeclared', file, specifier, dependency });
		}
	}
	for (const cycle of cycles(edges)) violations.push({ _tag: 'Cycle', packages: cycle });
	for (const workspace of packages.values()) {
		const path = `packages/${workspace.directory}/node_modules/effect/package.json`;
		if (yield* attemptPromise(() => Bun.file(join(root, path)).exists())) {
			violations.push({ _tag: 'DuplicateEffect', path });
		}
	}
	return { files: checked.length, packages: packages.size, violations };
});

export const boundariesCommand = Effect.fn('boundariesCommand')(function*(root: string) {
	const report = yield* checkBoundaries(root);
	if (report.violations.length) {
		return yield* refuse(
			[...report.violations.map(describe), `${report.violations.length} package boundary violations`].join('\n'),
		);
	}
	return `Checked ${report.files} files in ${report.packages} packages`;
});

if (import.meta.main) {
	await main(Effect.gen(function*() {
		console.log(yield* boundariesCommand(process.cwd()));
	}));
}
