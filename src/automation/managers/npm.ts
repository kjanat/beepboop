import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import type { Manager } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { latestVersion, verifyRegistry } from '@/automation/managers/verification';
import { excluded, registry } from '@/automation/package-publication';
import type { Package } from '@/automation/types';
import { packageIdentity } from '@/package-url';
export const npmManager: Manager = {
	name: 'npm',
	identity(pkg) {
		const slash = pkg.name.lastIndexOf('/');
		return packageIdentity({
			type: 'npm',
			name: slash < 0 ? pkg.name : pkg.name.slice(slash + 1),
			namespace: slash < 0 ? undefined : pkg.name.slice(0, slash),
			version: pkg.version,
		});
	},
	latest(pkg, request) {
		return latestVersion(
			request,
			`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,
			body => object(object(body)['dist-tags']).latest,
		);
	},
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
		const detected = new Set<import('@/automation/types').ManagerName>();
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			try {
				if ((path === 'package.json' || path.endsWith('/package.json'))) {
					const pkg = object(JSON.parse(source));
					if (typeof pkg.name !== 'string' || !pkg.name.trim()) {
						if (Object.hasOwn(pkg, 'name')) {
							inventory.diagnostics.push(`${path}: package name must be a nonempty string`);
						}
						continue;
					}
					// Standalone nested packages are still inventoried; independent versions are not silently synchronized.
					inventory.packages.push({
						manager: 'npm',
						name: pkg.name,
						...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
						manifest: path,
						versionSource: `${path}#version`,
						publication: pkg.private === true
							? excluded('private')
							: typeof object(pkg.engines).vscode === 'string'
							? excluded('vscode-extension')
							: registry,
						dependencies: Object.keys({
							...object(pkg.dependencies),
							...object(pkg.optionalDependencies),
							...object(pkg.peerDependencies),
						}),
					});
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
						publication: registry,
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
