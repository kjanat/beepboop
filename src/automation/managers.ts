import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { record } from '#model';
import { discoverHooks } from './precommit.ts';
import type { Inventory, ManagerName, Package, Publication, ReleasePlan, Snapshot } from './types.ts';
import { nextVersion, parseVersionRequest } from './version.ts';

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? record(value) : {};
}
function glob(pattern: string, path: string): boolean {
	const expression = pattern
		.split('**')
		.map((part) =>
			part
				.split('*')
				.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
				.join('[^/]*')
		)
		.join('.*');
	return new RegExp(`^${expression}$`).test(path);
}
function directory(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
function inWorkspace(path: string, members: string[], exclusions: string[]): boolean {
	return (
		members.some((pattern) => glob(pattern.replace(/\/$/, ''), path))
		&& !exclusions.some((pattern) => glob(pattern, path))
	);
}
function yaml(source: string): Record<string, unknown> {
	const doc = parseDocument(source, { uniqueKeys: true });
	if (doc.errors.length) throw new Error('Invalid YAML');
	return object(doc.toJS({ maxAliasCount: 100 }));
}
export function publicationOrder(packages: Package[]): string[] {
	const byName = new Map(packages.map((p) => [`${p.manager}:${p.name}`, p]));
	const visiting = new Set<string>(),
		visited = new Set<string>(),
		order: string[] = [];
	function visit(key: string): void {
		if (visited.has(key)) return;
		if (visiting.has(key)) throw new Error(`Publication dependency cycle at ${key}`);
		const pkg = byName.get(key);
		if (!pkg) return;
		visiting.add(key);
		for (const name of [...pkg.dependencies].sort()) visit(`${pkg.manager}:${name}`);
		visiting.delete(key);
		visited.add(key);
		if (pkg.publish) order.push(key);
	}
	for (const key of [...byName.keys()].sort()) visit(key);
	return order;
}
export function discover(
	snapshot: Snapshot,
	enabled: ManagerName[] = [
		'pre-commit',
		'cargo',
		'npm',
		'github-release',
		'oci',
		'goreleaser',
		'manifest',
		'workflow',
	],
): Inventory {
	const inventory: Inventory = {
		packages: [],
		workflows: [],
		managers: [],
		diagnostics: [],
		publicationOrder: [],
	};
	const detected = new Set<ManagerName>();
	let workspace: Record<string, unknown> = {};
	try {
		workspace = object(parseToml(snapshot.files['Cargo.toml'] ?? '').workspace);
	} catch {
		inventory.diagnostics.push('Cargo.toml: invalid TOML');
	}
	const members = Array.isArray(workspace.members) ? workspace.members.map(String) : [];
	const exclude = Array.isArray(workspace.exclude) ? workspace.exclude.map(String) : [];
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
			if (enabled.includes('cargo') && (path === 'Cargo.toml' || path.endsWith('/Cargo.toml'))) {
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
			if (enabled.includes('npm') && (path === 'package.json' || path.endsWith('/package.json'))) {
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
			if (enabled.includes('workflow') && /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) {
				const workflow = yaml(source),
					trigger = workflow.on;
				const events = typeof trigger === 'string'
					? [trigger]
					: Array.isArray(trigger)
					? trigger.map(String)
					: Object.keys(object(trigger));
				const jobs = object(workflow.jobs);
				const localActions = [
					...source.matchAll(/uses:\s*["']?((?:\.\/|\$\/)\.github\/[^\s"']+)/g),
				].map((m) => m[1] as string);
				inventory.workflows.push({
					tagTriggered: events.includes('release') || Array.isArray(object(object(trigger).push).tags),
					file: path.slice('.github/workflows/'.length),
					name: String(workflow.name ?? path),
					events,
					jobs: Object.keys(jobs),
					localActions,
					dispatchInputs: Object.keys(object(object(object(trigger).workflow_dispatch).inputs)),
					publication: /\b(?:publish|release|deploy|promotion|promote)\b/i.test(
						String(workflow.name ?? path),
					),
				});
				detected.add('workflow');
				if (events.includes('release') || /gh release|releases\/|release-action/.test(source)) {
					detected.add('github-release');
				}
				if (/docker\/(?:build-push|metadata)-action|skopeo copy/.test(source)) detected.add('oci');
			}
			if (/^\.?goreleaser.*\.ya?ml$/.test(path) && enabled.includes('goreleaser')) {
				yaml(source);
				detected.add('goreleaser');
			}
			if (/(?:^|\/)(?:Casks|Formula|bucket)\/[^/]+\.(?:rb|json)$/.test(path)) {
				detected.add('manifest');
			}
		} catch {
			inventory.diagnostics.push(`${path}: cannot safely discover configuration`);
		}
	}
	for (const [path, source] of Object.entries(snapshot.files)) {
		if (!enabled.includes('npm') || !path.endsWith('/npm/targets.json')) continue;
		try {
			const descriptor = object(JSON.parse(source));
			if (typeof descriptor.scope !== 'string' || !Array.isArray(descriptor.targets)) continue;
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
	for (const pkg of inventory.packages) {
		pkg.dependencies = pkg.dependencies.filter((name) =>
			inventory.packages.some((other) => other.manager === pkg.manager && other.name === name)
		);
	}
	try {
		inventory.publicationOrder = publicationOrder(inventory.packages);
	} catch (error) {
		inventory.diagnostics.push(String(error));
	}
	inventory.managers = [...detected].filter((m) => enabled.includes(m)).sort();
	if (enabled.includes('pre-commit')) {
		try {
			inventory.references = discoverHooks(snapshot);
			if (inventory.references.length) inventory.managers.push('pre-commit');
		} catch (error) {
			inventory.diagnostics.push(error instanceof Error ? error.message : 'Invalid hook configuration');
		}
	}
	return inventory;
}

/** Changes only version-bearing lines. Lockfiles and generated files remain preparation-workflow work. */
export function planRelease(
	snapshot: Snapshot,
	inventory: Inventory,
	target: unknown,
	selected?: string[],
): ReleasePlan {
	const request = parseVersionRequest(target);
	const packages = inventory.packages.filter(
		(p) => p.publish && (!selected || selected.includes(`${p.manager}:${p.name}`)),
	);
	if (!packages.length) throw new Error('No selected publishable packages');
	const current = [...new Set(packages.map(p => p.version))];
	if (!('version' in request) && current.length !== 1) {
		throw new Error('Select a synchronized version group or supply an explicit version');
	}
	const version = nextVersion(current[0] as string, request);
	for (const previous of current) nextVersion(previous, { version });
	const diagnostics: string[] = [],
		changed = new Map<string, string>();
	const sources = new Set(packages.map((p) => p.versionSource));
	if (
		selected
		&& inventory.packages.some(
			(p) =>
				p.publish
				&& sources.has(p.versionSource)
				&& !packages.some((chosen) => chosen.manager === p.manager && chosen.name === p.name),
		)
	) {
		throw new Error('Selected packages share a version source with packages outside the selection');
	}
	for (const source of sources) {
		const [path, key] = source.split('#');
		if (!path || !key) throw new Error('Invalid version source');
		const before = changed.get(path) ?? snapshot.files[path];
		if (before === undefined) throw new Error('Missing manifest');
		if (path.endsWith('.json')) {
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
		} else {
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
		}
	}
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
	const requiresPreparation = Object.keys(snapshot.files).some((p) =>
		/(?:^|\/)(Cargo.lock|package-lock.json|bun.lock|pnpm-lock.yaml|yarn.lock)$/.test(p)
	);
	if (requiresPreparation) {
		diagnostics.push(
			'Preparation workflow must regenerate lockfiles and generated version carriers before promotion',
		);
	}
	return {
		version,
		sourceSha: snapshot.sha,
		packages,
		edits: [...changed]
			.map(([path, after]) => ({ path, before: snapshot.files[path] as string, after }))
			.filter((e) => e.before !== e.after),
		diagnostics,
		requiresPreparation,
	};
}

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export async function verifyPublication(
	publication: Publication,
	request: Fetcher = fetch,
): Promise<Publication> {
	let url: string;
	if (publication.manager === 'npm') {
		url = `https://registry.npmjs.org/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(
				publication.version,
			)
		}`;
	} else if (publication.manager === 'cargo') {
		url = `https://crates.io/api/v1/crates/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(
				publication.version,
			)
		}`;
	} else return { ...publication, outcome: 'uncertain' };
	try {
		const response = await request(url, {
			redirect: 'error',
			signal: AbortSignal.timeout(15_000),
			headers: { 'User-Agent': 'beepboop release verification' },
		});
		if (response.status === 404) return { ...publication, outcome: 'pending', url };
		if (!response.ok) return { ...publication, outcome: 'uncertain', url };
		const data = object(await response.json());
		const entry = publication.manager === 'cargo' ? object(data.version) : data;
		const digest = publication.manager === 'cargo' ? entry.checksum : object(entry.dist).integrity;
		const matches = publication.manager === 'cargo'
			? entry.crate === publication.name
				&& entry.num === publication.version
				&& entry.yanked === false
			: entry.name === publication.name && entry.version === publication.version;
		if (
			!matches
			|| typeof digest !== 'string'
			|| (publication.digest && publication.digest !== digest)
		) {
			return { ...publication, outcome: 'failed', url };
		}
		if (publication.channel && publication.manager === 'npm') {
			const tags = await request(
				`https://registry.npmjs.org/-/package/${encodeURIComponent(publication.name)}/dist-tags`,
				{ redirect: 'error', signal: AbortSignal.timeout(15_000) },
			);
			if (!tags.ok || object(await tags.json())[publication.channel] !== publication.version) {
				return { ...publication, outcome: 'pending', url };
			}
		}
		return { ...publication, outcome: 'succeeded', digest, url };
	} catch {
		return { ...publication, outcome: 'uncertain', url };
	}
}
