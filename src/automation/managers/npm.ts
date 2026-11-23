import { Effect } from 'effect';
import { applyEdits, modify, parseTree } from 'jsonc-parser';
import { jsonIndent, object } from '@/automation/managers/helpers';
import { discoverNpmTargets } from '@/automation/managers/npm-targets';
import { packageManifests } from '@/automation/managers/package-json';
import type { Adapter, RegistryVersion } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { latestVersion, unpublished, verifyRegistry } from '@/automation/managers/verification';
import type { Package } from '@/domain/inventory.ts';
import { excluded, publishable, registry } from '@/domain/package-publication.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { packageIdentity } from '@/package-url';

const defaultRegistry = /^https?:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)(?:[/:?#]|$)/;
function foreignRegistry(value: unknown): boolean {
	return typeof value === 'string' && !defaultRegistry.test(value.trim());
}

function reaches(packages: ReadonlyMap<string, Package>, from: string, target: string): boolean {
	const next = [from], seen = new Set<string>();
	for (const name of next) {
		if (name === target) return true;
		if (seen.has(name)) continue;
		seen.add(name);
		next.push(...(packages.get(name)?.dependencies ?? []));
	}
	return false;
}
type ManifestChange = readonly [path: readonly string[], value: string];
function pinnedDependencies(
	data: Record<string, unknown>,
	sections: readonly string[],
	packages: readonly Package[],
	version: string,
): ManifestChange[] {
	return sections.flatMap(section => {
		if (data[section] === undefined) return [];
		const dependencies = object(data[section]);
		return packages.filter(p => p.manager === 'npm').flatMap((pkg): ManifestChange[] => {
			const value = dependencies[pkg.name];
			if (typeof value !== 'string' || !/^[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value)) return [];
			const next = `${value.match(/^[~^]/)?.[0] ?? ''}${version}`;
			return next === value ? [] : [[[section, pkg.name], next]];
		});
	});
}
function editManifest(before: string, changes: readonly ManifestChange[]): string {
	const indent = jsonIndent(before);
	const formattingOptions = { insertSpaces: !indent.startsWith('\t'), tabSize: indent.length };
	return changes.reduce(
		(text, [path, value]) => applyEdits(text, modify(text, [...path], value, { formattingOptions })),
		before,
	);
}
function insertedVersion(before: string, version: string): string {
	const properties = parseTree(before)?.children ?? [];
	const anchor = properties.find(property => property.children?.[0]?.value === 'name') ?? properties.at(-1);
	const eol = before.includes('\r\n') ? '\r\n' : '\n';
	const line = `${eol}${jsonIndent(before)}"version": ${JSON.stringify(version)}`;
	const end = anchor ? anchor.offset + anchor.length : before.indexOf('{') + 1;
	return `${before.slice(0, end)}${anchor ? `,${line}` : `${line}${eol}`}${before.slice(end)}`;
}
export function npmLatest(name: string, request: Fetcher): Effect.Effect<RegistryVersion> {
	return latestVersion(
		request,
		`https://registry.npmjs.org/${encodeURIComponent(name)}`,
		body => {
			const latest = object(object(body)['dist-tags']).latest;
			const staged = typeof latest === 'string' && object(object(object(body).versions)[latest]).stub === true;
			return staged ? unpublished : latest;
		},
	);
}
export const npmManager: Adapter<'npm'> = {
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
	latest: (pkg, request) => npmLatest(pkg.name, request),
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
				return { name: entry.name, version: entry.version, digest: object(entry.dist).integrity };
			},
			publication.channel
				? `https://registry.npmjs.org/-/package/${encodeURIComponent(publication.name)}/dist-tags`
				: undefined,
		);
	},

	discover(snapshot) {
		const inventory = emptyInventory();
		const detected = new Set<import('@/domain/catalog.ts').ManagerName>();
		const optional = new Map<string, string[]>();
		for (const { path, manifest: pkg } of packageManifests(snapshot, inventory.diagnostics)) {
			if (typeof object(pkg.engines).vscode === 'string') continue;
			if (typeof pkg.name !== 'string' || !pkg.name.trim()) {
				if (Object.hasOwn(pkg, 'name')) {
					inventory.diagnostics.push(
						fileProblem(path, 'invalid-manifest', `package name must be a nonempty string`),
					);
				}
				continue;
			}
			// Standalone nested packages are still inventoried; independent versions are not silently synchronized.
			const optionalNames = Object.keys(object(pkg.optionalDependencies));
			optional.set(pkg.name, optionalNames);
			inventory.packages.push({
				manager: 'npm',
				name: pkg.name,
				...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
				manifest: path,
				versionSource: `${path}#version`,
				publication: pkg.private === true
					? excluded('private')
					: foreignRegistry(object(pkg.publishConfig).registry)
					? excluded('other-registry')
					: registry,
				dependencies: [...new Set([
					...Object.keys(object(pkg.dependencies)).filter(name => !optionalNames.includes(name)),
					...Object.keys(object(pkg.peerDependencies)),
				])],
			});
			detected.add('npm');
		}
		if (discoverNpmTargets(snapshot, inventory)) detected.add('npm');
		const packages = new Map(inventory.packages.filter(publishable).map(pkg => [pkg.name, pkg]));
		// Keep optional publication ordering wherever it can be satisfied.
		for (const pkg of [...inventory.packages].sort((a, b) => a.name.localeCompare(b.name))) {
			for (const name of (optional.get(pkg.name) ?? []).sort()) {
				if (pkg.dependencies.includes(name)) continue;
				if (!publishable(pkg) || !reaches(packages, name, pkg.name)) pkg.dependencies.push(name);
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
		return Effect.gen(function*() {
			const [path, key] = source.split('#');
			if (!path || !key) return yield* precondition('Invalid version source');
			const data = yield* fromSync(() => object(JSON.parse(before)));
			const pins = pinnedDependencies(
				data,
				['dependencies', 'optionalDependencies', 'peerDependencies'],
				packages,
				version,
			);
			return yield* fromSync(() =>
				editManifest(
					'version' in data ? editManifest(before, [[['version'], version]]) : insertedVersion(before, version),
					pins,
				)
			);
		});
	},
	updateDependencies: ({ snapshot, packages, version, changed }) =>
		fromSync(() => {
			for (
				const [path, original] of Object.entries(snapshot.files).filter(
					([path]) => path === 'package.json' || path.endsWith('/package.json'),
				)
			) {
				const before = changed.get(path) ?? original;
				const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
				const pins = pinnedDependencies(object(JSON.parse(before)), sections, packages, version);
				if (pins.length) changed.set(path, editManifest(before, pins));
			}
		}),
};
