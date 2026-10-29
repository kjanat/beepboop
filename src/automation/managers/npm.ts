import { parse as parseToml } from 'smol-toml';
import type { Package } from '../types.ts';
import { directory, inWorkspace, object } from './helpers.ts';
import type { Manager } from './registry.ts';
import { emptyInventory } from './registry.ts';
import { verifyRegistry } from './verification.ts';
export const npmManager: Manager = {
	name: 'npm',
	verifyPublication(publication, request) {
		const url = `https://registry.npmjs.org/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(publication.version)
		}`;
		return verifyRegistry(
			publication,
			request,
			url,
			body => {
				const entry = object(body);
				return {
					matches: entry.name === publication.name && entry.version === publication.version,
					digest: object(entry.dist).integrity,
				};
			},
			publication.channel
				? `https://registry.npmjs.org/-/package/${encodeURIComponent(publication.name)}/dist-tags`
				: undefined,
		);
	},

	discover(snapshot) {
		const inventory = emptyInventory();
		const detected = new Set<import('../types.ts').ManagerName>();
		let npmMembers: string[] = [];
		try {
			const root = object(JSON.parse(snapshot.files['package.json'] ?? '{}'));
			const workspaces = Array.isArray(root.workspaces)
				? root.workspaces
				: object(root.workspaces).packages;
			if (Array.isArray(workspaces)) npmMembers = workspaces.map(String);
		} catch {
			inventory.diagnostics.push('package.json: invalid JSON');
		}
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			try {
				if ((path === 'package.json' || path.endsWith('/package.json'))) {
					const pkg = object(JSON.parse(source));
					if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') continue;
					const member = path === 'package.json' || inWorkspace(directory(path), npmMembers, []);
					// Standalone nested packages are still inventoried; independent versions are not silently synchronized.
					inventory.packages.push({
						manager: 'npm',
						name: pkg.name,
						version: pkg.version,
						manifest: path,
						versionSource: `${path}#version`,
						publish: pkg.private !== true && typeof object(pkg.engines).vscode !== 'string',
						dependencies: Object.keys({
							...object(pkg.dependencies),
							...object(pkg.optionalDependencies),
							...object(pkg.peerDependencies),
						}),
					});
					if (!member && pkg.private !== true) {
						inventory.diagnostics.push(
							`${path}: standalone package; assign its release stream explicitly`,
						);
					}
					detected.add('npm');
				}
			} catch {
				inventory.diagnostics.push(`${path}: cannot safely discover configuration`);
			}
		}
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!path.endsWith('/npm/targets.json')) continue;
			try {
				const descriptor = object(JSON.parse(source));
				if (typeof descriptor.scope !== 'string' || !Array.isArray(descriptor.targets)) continue;
				const workspace = object(parseToml(snapshot.files['Cargo.toml'] ?? '').workspace);
				const version = object(workspace.package).version;
				if (typeof version !== 'string') {
					inventory.diagnostics.push(`${path}: generated package versions require producer evidence`);
					continue;
				}
				const facades: Record<string, unknown>[] = Array.isArray(descriptor.facades)
					? descriptor.facades.map(object)
					: typeof descriptor.facade === 'string'
					? [{ name: descriptor.facade }]
					: [];
				const generated: Package[] = [];
				const add = (name: string, dependencies: string[], optional = false) =>
					generated.push({
						manager: 'npm',
						name,
						version,
						manifest: path,
						versionSource: 'Cargo.toml#workspace.package.version',
						publish: true,
						dependencies,
						generated: true,
						optional,
					});
				for (const facade of facades) {
					if (typeof facade.name !== 'string') continue;
					const platforms: string[] = [];
					for (const raw of descriptor.targets) {
						const target = object(raw);
						if (typeof target.pkg !== 'string') continue;
						const name = `${descriptor.scope}/${typeof facade.pkg === 'string' ? `${facade.pkg}-` : ''}${target.pkg}`;
						platforms.push(name);
						add(name, [], target.experimental === true);
					}
					add(facade.name, platforms);
					if (typeof facade.shim === 'string') add(facade.shim, [facade.name]);
				}
				const bundle = object(descriptor.bundle);
				if (typeof bundle.name === 'string') {
					add(
						bundle.name,
						facades.map((f) => String(f.name)),
					);
				}
				inventory.packages = inventory.packages.filter(
					(p) => p.manager !== 'npm' || !generated.some((g) => g.name === p.name),
				);
				inventory.packages.push(...generated);
				detected.add('npm');
			} catch {
				inventory.diagnostics.push(`${path}: invalid npm target descriptor`);
			}
		}

		inventory.managers = [...detected];
		return inventory;
	},
	ownsVersionSource(source) {
		const path = source.split('#')[0] ?? '';
		return path === 'package.json' || path.endsWith('/package.json');
	},
	editVersion({ source, before, version, packages }) {
		const [path, key] = source.split('#');
		if (!path || !key) throw new Error('Invalid version source');
		const changed = new Map<string, string>();
		const data = object(JSON.parse(before));
		data.version = version;
		for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
			if (data[section] === undefined) continue;
			const deps = object(data[section]);
			for (const pkg of packages.filter((p) => p.manager === 'npm')) {
				const old = deps[pkg.name];
				if (typeof old === 'string' && /^[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(old)) {
					deps[pkg.name] = `${old.match(/^[~^]/)?.[0] ?? ''}${version}`;
				}
			}
			data[section] = deps;
		}
		const indent = before.match(/\n([\t ]+)"/)?.[1] ?? '  ';
		changed.set(path, `${JSON.stringify(data, null, indent)}\n`);
		const result = changed.get(path);
		if (result === undefined) throw new Error('Missing version edit');
		return result;
	},
	updateDependencies({ snapshot, packages, version, changed }) {
		for (
			const [path, original] of Object.entries(snapshot.files).filter(
				([path]) => path === 'package.json' || path.endsWith('/package.json'),
			)
		) {
			const before = changed.get(path) ?? original;
			const data = object(JSON.parse(before));
			let altered = false;
			for (
				const section of [
					'dependencies',
					'devDependencies',
					'optionalDependencies',
					'peerDependencies',
				]
			) {
				if (data[section] === undefined) continue;
				const dependencies = object(data[section]);
				for (const pkg of packages.filter((p) => p.manager === 'npm')) {
					const value = dependencies[pkg.name];
					if (typeof value === 'string' && /^[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)) {
						const next = `${value.match(/^[~^]/)?.[0] ?? ''}${version}`;
						if (next !== value) {
							dependencies[pkg.name] = next;
							altered = true;
						}
					}
				}
				data[section] = dependencies;
			}
			if (altered) {
				changed.set(
					path,
					`${JSON.stringify(data, null, before.match(/\n([\t ]+)"/)?.[1] ?? '  ')}\n`,
				);
			}
		}
	},
};
