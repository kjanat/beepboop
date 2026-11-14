import { Effect } from 'effect';
import { applyEdits, modify } from 'jsonc-parser';
import { jsonIndent, object } from '@/automation/managers/helpers';
import { discoverNpmTargets } from '@/automation/managers/npm-targets';
import { packageManifests } from '@/automation/managers/package-json';
import type { Adapter, Fetcher, RegistryVersion } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { latestVersion, verifyRegistry } from '@/automation/managers/verification';
import { excluded, registry } from '@/automation/package-publication';
import type { Package } from '@/automation/types';
import { fileProblem } from '@/contract/diagnostics';
import { precondition } from '@/contract/errors';
import { fromSync } from '@/failure';
import { packageIdentity } from '@/package-url';

const defaultRegistry = /^https?:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)(?:[/:?#]|$)/;
function foreignRegistry(value: unknown): boolean {
	return typeof value === 'string' && !defaultRegistry.test(value.trim());
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
export function npmLatest(name: string, request: Fetcher): Effect.Effect<RegistryVersion> {
	return latestVersion(
		request,
		`https://registry.npmjs.org/${encodeURIComponent(name)}`,
		body => object(object(body)['dist-tags']).latest,
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
		const detected = new Set<import('@/contract/catalog').ManagerName>();
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
				dependencies: Object.keys({
					...object(pkg.dependencies),
					...object(pkg.optionalDependencies),
					...object(pkg.peerDependencies),
				}),
			});
			detected.add('npm');
		}
		if (discoverNpmTargets(snapshot, inventory)) detected.add('npm');

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
			return yield* fromSync(() => editManifest(before, [[['version'], version], ...pins]));
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
