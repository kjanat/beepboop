import { Effect, Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { jsonIndent, object } from '@/automation/managers/helpers';
import { packageManifests } from '@/automation/managers/package-json';
import type { Adapter, Fetcher, RegistryVersion } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { latestVersion, verifyRegistry } from '@/automation/managers/verification';
import { excluded, registry } from '@/automation/package-publication';
import type { Package } from '@/automation/types';
import { npmTargets } from '@/contract/catalog';
import { fileProblem } from '@/contract/diagnostics';
import { precondition } from '@/contract/errors';
import { safeVersionPath } from '@/contract/version-files';
import { fromSync } from '@/failure';
import { packageIdentity } from '@/package-url';

const defaultRegistry = /^https?:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)(?:[/:?#]|$)/;
function foreignRegistry(value: unknown): boolean {
	return typeof value === 'string' && !defaultRegistry.test(value.trim());
}
function pinDependencies(
	data: Record<string, unknown>,
	sections: readonly string[],
	packages: readonly Package[],
	version: string,
): boolean {
	let altered = false;
	for (const section of sections) {
		if (data[section] === undefined) continue;
		const dependencies = object(data[section]);
		for (const pkg of packages.filter(p => p.manager === 'npm')) {
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
	return altered;
}
function manifestText(data: Record<string, unknown>, before: string): string {
	return `${JSON.stringify(data, null, jsonIndent(before))}\n`;
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
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!npmTargets.test(path)) continue;
			const invalid = () =>
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', `invalid npm target descriptor`));
			const parsed = Result.try(() => object(JSON.parse(source)));
			if (Result.isFailure(parsed)) {
				invalid();
				continue;
			}
			const descriptor = parsed.success;
			const { targets } = descriptor;
			if (typeof descriptor.scope !== 'string' || !Array.isArray(targets)) continue;
			const versionSource = descriptor.versionSource ?? 'Cargo.toml#workspace.package.version';
			if (typeof versionSource !== 'string') {
				invalid();
				continue;
			}
			const versionLocation = /^((?:[^/#]+\/)*Cargo\.toml)#((?:workspace\.)?package\.version)$/.exec(versionSource);
			const versionPath = versionLocation?.[1];
			const versionKey = versionLocation?.[2];
			if (!versionPath || !versionKey || !safeVersionPath(versionPath)) {
				invalid();
				continue;
			}
			const cargo = Result.try(() => object(parseToml(snapshot.files[versionPath] ?? '')));
			if (Result.isFailure(cargo)) {
				invalid();
				continue;
			}
			const version = versionKey.split('.').reduce<unknown>((value, key) => object(value)[key], cargo.success);
			if (typeof version !== 'string') {
				inventory.diagnostics.push(
					fileProblem(path, 'invalid-manifest', `generated packages need a string version at ${versionSource}`),
				);
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
					versionSource,
					publication: registry,
					dependencies,
					generated: true,
					optional,
				});
			for (const facade of facades) {
				if (typeof facade.name !== 'string') continue;
				const platforms: string[] = [];
				for (const raw of targets) {
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
			data.version = version;
			pinDependencies(data, ['dependencies', 'optionalDependencies', 'peerDependencies'], packages, version);
			return manifestText(data, before);
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
				const data = object(JSON.parse(before));
				const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
				if (pinDependencies(data, sections, packages, version)) changed.set(path, manifestText(data, before));
			}
		}),
};
