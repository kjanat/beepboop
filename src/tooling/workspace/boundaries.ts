import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, capture, main, parse, readJson, refuse } from '@/tooling/runtime';
import {
	isCode,
	isLocal,
	isRelative,
	packageOf,
	readAliases,
	references,
	repositoryPath,
	resolveReference,
	trackedFiles,
} from '@/tooling/workspace/modules';

const dependencyMap = Schema.optional(Schema.Record(Schema.String, Schema.String));
const manifestSchema = Schema.Struct({
	name: Schema.String,
	dependencies: dependencyMap,
	devDependencies: dependencyMap,
	peerDependencies: dependencyMap,
	optionalDependencies: dependencyMap,
});

const platformModules = /^(?:node:|bun:|cloudflare:|astro:|virtual:)|^bun$/;

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

interface Workspace {
	readonly directory: string;
	readonly name: string;
	readonly dependencies: ReadonlySet<string>;
}

const workspaces = Effect.fn('workspaces')(function*(
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
		found.set(directory, { directory, name: manifest.name, dependencies: new Set(declared) });
	}
	return found;
});

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

function packageName(specifier: string): string {
	const [scope, name] = specifier.split('/');
	return specifier.startsWith('@') && name ? `${scope}/${name}` : scope ?? specifier;
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

const ignored = Effect.fn('ignored')(function*(root: string, path: string) {
	return yield* capture(['git', 'check-ignore', '-q', path], { cwd: root }).pipe(
		Effect.as(true),
		Effect.orElseSucceed(() => false),
	);
});

export const checkBoundaries = Effect.fn('checkBoundaries')(function*(
	root: string,
): Effect.fn.Return<BoundaryReport, ToolFailure> {
	const files = yield* trackedFiles(root);
	const known = new Set(files);
	const aliases = yield* readAliases(root);
	const packages = yield* workspaces(root, files);
	const names = new Map([...packages.values()].map(workspace => [workspace.name, workspace]));
	const violations: Violation[] = [];
	const edges = new Map<string, Set<string>>();
	const checked = files.filter(file => isCode(file) && packages.has(packageOf(file) ?? ''));
	for (const file of checked) {
		const owner = packages.get(packageOf(file) ?? '');
		if (!owner) continue;
		const source = yield* attemptPromise(() => Bun.file(join(root, file)).text());
		for (const { specifier } of references(file, source)) {
			const local = isLocal(aliases, specifier);
			const target = resolveReference(aliases, known, file, specifier);
			if (local && target === undefined) {
				const generated = isRelative(specifier)
					&& (yield* ignored(root, repositoryPath(join(dirname(file), specifier))));
				if (!generated) violations.push({ _tag: 'Unresolved', file, specifier });
				continue;
			}
			if (!local && platformModules.test(specifier)) continue;
			const dependency = target ? packages.get(packageOf(target) ?? '') : names.get(packageName(specifier));
			if (target && !dependency) {
				violations.push({ _tag: 'OutsidePackage', file, specifier, target });
				continue;
			}
			if (dependency?.directory === owner.directory) continue;
			const declared = dependency?.name ?? packageName(specifier);
			if (dependency) edges.set(owner.name, (edges.get(owner.name) ?? new Set()).add(dependency.name));
			if (!owner.dependencies.has(declared)) {
				violations.push({ _tag: 'Undeclared', file, specifier, dependency: declared });
			}
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
