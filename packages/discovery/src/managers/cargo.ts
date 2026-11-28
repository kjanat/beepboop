import { Effect, Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { editTomlVersion, object } from '@/discovery/managers/manifest-editing.ts';
import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { emptyInventory } from '@/discovery/managers/registry.ts';
import { cargoMembers } from '@/discovery/managers/workspaces.ts';
import { excluded, registry } from '@/domain/package-publication.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { parentDirectory } from '@/kernel/path/relative-path.ts';

function workspaceVersion(source: string): unknown {
	return Result.getOrElse(
		Result.try(() => object(object(parseToml(source).workspace).package).version),
		() => undefined,
	);
}

function editWorkspaceVersion(before: string, version: string): string | undefined {
	const previous = workspaceVersion(before);
	if (typeof previous !== 'string') return undefined;
	if (previous === version) return before;

	// Do not accept a line match that did not update the actual parsed workspace field.
	const table = editTomlVersion(before, heading => heading.replace(/[ \t]/g, '') === 'workspace.package', version);
	if (table !== undefined && workspaceVersion(table) === version) return table;
	const after = editTomlVersion(before, heading => heading.trim() === 'workspace', version, 'package.version');
	return after !== undefined && workspaceVersion(after) === version ? after : undefined;
}

export const cargoDiscoverer = {
	name: 'cargo',
	discover(snapshot) {
		const inventory = emptyInventory();
		const detected = new Set<import('@/domain/catalog.ts').ManagerName>();
		const root = Result.try(() => object(parseToml(snapshot.files['Cargo.toml'] ?? '')));
		if (Result.isFailure(root)) {
			inventory.diagnostics.push(fileProblem('Cargo.toml', 'invalid-manifest', 'invalid TOML'));
		}
		const workspace = Result.isSuccess(root) ? object(root.success.workspace) : {};
		const patched = new Set<string>();
		for (const source of Object.values(Result.isSuccess(root) ? object(root.success.patch) : {})) {
			for (const entry of Object.values(object(source))) {
				const location = object(entry).path;
				if (typeof location === 'string') patched.add(location.replace(/^\.\//, '').replace(/\/+$/, ''));
			}
		}
		const member = cargoMembers(path => snapshot.files[path], Object.keys(snapshot.files));
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			if (path !== 'Cargo.toml' && !path.endsWith('/Cargo.toml')) continue;
			if (path !== 'Cargo.toml' && !member(parentDirectory(path))) continue;
			const parsed = Result.try(() => object(parseToml(source)));
			const manifest = Result.isSuccess(parsed) ? parsed.success : undefined;
			const pkg = object(manifest?.package);
			const inherited = object(pkg.version).workspace === true;
			const version = inherited ? object(workspace.package).version : pkg.version;
			if (!manifest || (typeof pkg.name === 'string' && typeof version !== 'string')) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', `cannot safely discover configuration`));
				continue;
			}
			if (typeof pkg.name !== 'string' || typeof version !== 'string') continue;
			const deps = {
				...object(manifest.dependencies),
				...object(manifest['build-dependencies']),
			};
			for (const target of Object.values(object(manifest.target))) {
				Object.assign(
					deps,
					object(object(target).dependencies),
					object(object(target)['build-dependencies']),
				);
			}
			const shared = object(workspace.dependencies);
			const publish = object(pkg.publish).workspace === true ? object(workspace.package).publish : pkg.publish;
			inventory.packages.push({
				manager: 'cargo',
				name: pkg.name,
				version,
				manifest: path,
				versionSource: inherited
					? 'Cargo.toml#workspace.package.version'
					: `${path}#package.version`,
				publication: patched.has(parentDirectory(path))
					? excluded('upstream-patch')
					: publish === false
					? excluded('publish-disabled')
					: Array.isArray(publish) && !publish.includes('crates-io')
					? excluded('other-registry')
					: registry,
				dependencies: Object.entries(deps).map(([name, value]) => {
					const dep = object(object(value).workspace === true ? shared[name] : value);
					return typeof dep.package === 'string' ? dep.package : name;
				}),
			});
			detected.add('cargo');
		}

		inventory.managers = [...detected];
		return inventory;
	},
	ownsVersionSource(source) {
		const path = source.split('#')[0] ?? '';
		return path === 'Cargo.toml' || path.endsWith('/Cargo.toml');
	},
	editVersion({ source, before, version }) {
		const [path, key] = source.split('#');
		if (!path || !key) return Effect.fail(precondition('Invalid version source'));
		const section = key.slice(0, -'.version'.length);
		const after = key === 'workspace.package.version'
			? editWorkspaceVersion(before, version)
			: editTomlVersion(before, heading => heading === section, version);
		return after === undefined ? Effect.fail(precondition(`Cannot safely edit ${source}`)) : Effect.succeed(after);
	},
	updateDependencies({ snapshot, packages, version, changed }) {
		// Update internal Cargo dependencies in every manifest, including unpublished consumers.
		return Effect.gen(function*() {
			const manifests = Object.entries(snapshot.files).filter(([path]) => path.endsWith('Cargo.toml'));
			for (const [path, original] of manifests) {
				let current = '';
				const unsafe: string[] = [];
				const before = changed.get(path) ?? original;
				const after = before
					.split('\n')
					.map((line) => {
						const heading = line.match(/^\s*\[([^\]]+)\]/);
						if (heading) current = heading[1] ?? '';
						if (!/(?:^|\.)(?:dependencies|build-dependencies|dev-dependencies)(?:\.|$)/.test(current)) {
							return line;
						}
						for (const pkg of packages.filter((p) => p.manager === 'cargo')) {
							const name = line.match(/^\s*["']?([\w-]+)["']?\s*=/)?.[1];
							const renamed = line.match(/package\s*=\s*["']([^"']+)["']/)?.[1];
							if (
								name === pkg.name
								|| renamed === pkg.name
								|| (current.endsWith(`.${pkg.name}`) && name === 'version')
							) {
								const pattern = line.includes('{')
									? /(version\s*=\s*["'])([^"']+)(["'])/
									: /(=\s*["'])([^"']+)(["'])/;
								return line.replace(pattern, (match, prefix: string, range: string, quote: string) => {
									if (!/^[~^=]?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(range)) {
										unsafe.push(range);
										return match;
									}
									return `${prefix}${range.match(/^[~^=]/)?.[0] ?? ''}${version}${quote}`;
								});
							}
						}
						return line;
					})
					.join('\n');
				const [range] = unsafe;
				if (range !== undefined) {
					return yield* precondition(`Cannot safely update Cargo dependency range ${range} in ${path}`);
				}
				if (after !== original) changed.set(path, after);
			}
		});
	},
} satisfies DiscovererOf<'cargo'>;
