import { parse as parseToml } from 'smol-toml';
import { directory, inWorkspace, object } from './helpers.ts';
import type { Manager } from './registry.ts';
import { emptyInventory } from './registry.ts';
import { verifyRegistry } from './verification.ts';
export const cargoManager: Manager = {
	name: 'cargo',
	verifyPublication(publication, request) {
		const url = `https://crates.io/api/v1/crates/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(publication.version)
		}`;
		return verifyRegistry(publication, request, url, body => {
			const entry = object(object(body).version);
			return {
				matches: entry.crate === publication.name && entry.num === publication.version && entry.yanked === false,
				digest: entry.checksum,
			};
		});
	},

	discover(snapshot) {
		const inventory = emptyInventory();
		const detected = new Set<import('../types.ts').ManagerName>();
		let workspace: Record<string, unknown> = {};
		try {
			workspace = object(parseToml(snapshot.files['Cargo.toml'] ?? '').workspace);
		} catch {
			inventory.diagnostics.push('Cargo.toml: invalid TOML');
		}
		const members = Array.isArray(workspace.members) ? workspace.members.map(String) : [];
		const exclude = Array.isArray(workspace.exclude) ? workspace.exclude.map(String) : [];
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			try {
				if ((path === 'Cargo.toml' || path.endsWith('/Cargo.toml'))) {
					if (path !== 'Cargo.toml' && !inWorkspace(directory(path), members, exclude)) continue;
					const manifest = object(parseToml(source)),
						pkg = object(manifest.package);
					if (typeof pkg.name !== 'string') continue;
					const inherited = object(pkg.version).workspace === true;
					const version = inherited ? object(workspace.package).version : pkg.version;
					if (typeof version !== 'string') throw new Error('Missing package version');
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
					inventory.packages.push({
						manager: 'cargo',
						name: pkg.name,
						version,
						manifest: path,
						versionSource: inherited
							? 'Cargo.toml#workspace.package.version'
							: `${path}#package.version`,
						publish: pkg.publish !== false
							&& (!Array.isArray(pkg.publish) || pkg.publish.includes('crates-io')),
						dependencies: Object.entries(deps).map(([name, value]) => {
							const dep = object(object(value).workspace === true ? shared[name] : value);
							return typeof dep.package === 'string' ? dep.package : name;
						}),
					});
					detected.add('cargo');
				}
			} catch {
				inventory.diagnostics.push(`${path}: cannot safely discover configuration`);
			}
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
		if (!path || !key) throw new Error('Invalid version source');
		const changed = new Map<string, string>();
		const section = key.slice(0, -'.version'.length);
		let current = '',
			count = 0;
		const after = before
			.split('\n')
			.map((line) => {
				const heading = line.match(/^\s*\[([^\]]+)\]/);
				if (heading) current = heading[1] ?? '';
				if (current === section && /^\s*version\s*=\s*["']/.test(line)) {
					count++;
					return line.replace(/(version\s*=\s*)["'][^"']*["']/, `$1"${version}"`);
				}
				return line;
			})
			.join('\n');
		if (count !== 1) throw new Error(`Cannot safely edit ${source}`);
		changed.set(path, after);
		const result = changed.get(path);
		if (result === undefined) throw new Error('Missing version edit');
		return result;
	},
	updateDependencies({ snapshot, packages, version, changed }) {
		// Update internal Cargo dependencies in every manifest, including unpublished consumers.
		for (const [path, original] of Object.entries(snapshot.files).filter(([path]) => path.endsWith('Cargo.toml'))) {
			let current = '';
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
							return line.replace(pattern, (_match, prefix: string, range: string, quote: string) => {
								if (!/^[~^=]?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(range)) {
									throw new Error(`Cannot safely update Cargo dependency range ${range} in ${path}`);
								}
								return `${prefix}${range.match(/^[~^=]/)?.[0] ?? ''}${version}${quote}`;
							});
						}
					}
					return line;
				})
				.join('\n');
			if (after !== original) changed.set(path, after);
		}
	},
};
