import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { packageManifests } from '@/automation/managers/package-json';
import { latestTag, tagPrefix } from '@/automation/managers/tags';
import { publishable, registry } from '@/automation/package-publication';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import { npmTargets } from '@/contract/catalog';
import { fileProblem } from '@/contract/diagnostics';
import { npmTargetDescriptor, platformMap } from '@/contract/targets';
import { safeVersionPath } from '@/contract/version-files';
import { parentDirectory } from '@/relative-path';

interface Manifest {
	path: string;
	manifest: Record<string, unknown>;
}
interface Group {
	name: string;
	platforms: { name: string; optional: boolean }[];
	shim?: string;
	versionSource?: string;
}
interface MapFacade {
	path: string;
	name: string;
	platforms: { key: string; names: string[]; optional: boolean }[];
}
interface OwnedMap {
	path: string;
	directory: string;
	facades: MapFacade[];
}
const within = (directory: string, path: string) => !directory || path.startsWith(`${directory}/`);

function ownedMaps(
	documents: ReadonlyMap<string, unknown>,
	manifests: Manifest[],
	packages: readonly Package[],
): OwnedMap[] {
	return [...documents].flatMap(([path, document]) => {
		const parsed = platformMap.safeParse(document);
		if (!parsed.success) return [];
		const keys = Object.keys(parsed.data).filter(key => key !== '$schema');
		if (!keys.length) return [];
		const candidates = manifests.flatMap(({ path: manifestPath, manifest }): MapFacade[] => {
			if (typeof manifest.name !== 'string') return [];
			const existing = packages.find(pkg =>
				pkg.manager === 'npm' && pkg.manifest === manifestPath && pkg.name === manifest.name
			);
			if (!existing || !publishable(existing)) return [];
			const names = Object.keys(object(manifest.optionalDependencies));
			const platforms = keys.map(key => ({
				key,
				names: names.filter(name => name.endsWith(`-${key}`)),
				optional: object(parsed.data[key]).experimental === true,
			}));
			return platforms.some(platform => platform.names.length)
				? [{ path: manifestPath, name: manifest.name, platforms }]
				: [];
		});
		let directory = parentDirectory(path);
		while (
			directory && !manifests.some(manifest => manifest.path === `${directory}/package.json`)
			&& !candidates.some(facade => within(directory, facade.path))
		) directory = parentDirectory(directory);
		return [{ path, directory, facades: candidates.filter(facade => within(directory, facade.path)) }];
	});
}

function readVersion(snapshot: Snapshot, source: string): { version?: string } | undefined {
	const prefix = tagPrefix(source);
	if (prefix !== undefined) return { version: latestTag(snapshot.tags ?? [], prefix) };
	const [file, key] = source.split('#');
	if (!file || !key || !safeVersionPath(file)) return undefined;
	const parsed = Result.try(() =>
		file.endsWith('Cargo.toml') ? parseToml(snapshot.files[file] ?? '') : JSON.parse(snapshot.files[file] ?? '')
	);
	const value = Result.isSuccess(parsed)
		? key.split('.').reduce<unknown>((current, key) => object(current)[key], parsed.success)
		: undefined;
	return typeof value === 'string' ? { version: value } : undefined;
}

export function discoverNpmTargets(snapshot: Snapshot, inventory: Inventory): boolean {
	const manifests = [...packageManifests(snapshot, [])];
	const originals = [...inventory.packages];
	const excluded = (name: string) =>
		originals.some(pkg => pkg.manager === 'npm' && pkg.name === name && !publishable(pkg));
	const documents = new Map<string, unknown>();
	for (const [path, source] of Object.entries(snapshot.files)) {
		if (!npmTargets.test(path)) continue;
		const parsed = Result.try((): unknown => JSON.parse(source));
		if (Result.isFailure(parsed)) {
			inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', 'invalid target descriptor JSON'));
		} else documents.set(path, parsed.success);
	}
	const maps = ownedMaps(documents, manifests, originals);
	let detected = false;
	for (const [path, document] of documents) {
		const invalid = (detail: string) => inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', detail));
		const raw = object(document);
		const parsed = npmTargetDescriptor.safeParse(document);
		const groups: Group[] = [];
		let sourceOverride: string | undefined;
		let bundle: string | undefined;
		if (parsed.success) {
			const descriptor = parsed.data;
			sourceOverride = descriptor.versionSource;
			bundle = descriptor.bundle?.name;
			const facades = 'platformScope' in descriptor && typeof descriptor.platformScope === 'string'
				? [{ name: String(descriptor.facade), pkg: String(descriptor.binary) }]
				: Array.isArray(descriptor.facades)
				? descriptor.facades
				: [{ name: String(descriptor.facade) }];
			const scope = typeof descriptor.platformScope === 'string' ? descriptor.platformScope : descriptor.scope;
			for (const facade of facades) {
				groups.push({
					name: facade.name,
					...('shim' in facade && typeof facade.shim === 'string' ? { shim: facade.shim } : {}),
					platforms: descriptor.targets.map(target => ({
						name: `${scope}/${'pkg' in facade && facade.pkg ? `${facade.pkg}-` : ''}${target.pkg}`,
						optional: target.experimental === true,
					})),
				});
			}
		} else {
			if (['scope', 'platformScope', 'facade', 'facades'].some(key => Object.hasOwn(raw, key))) {
				invalid(`invalid npm target descriptor: ${parsed.error.message}`);
				continue;
			}
			const map = maps.find(map => map.path === path);
			if (!map) continue;
			for (const facade of map.facades) {
				const owners = maps.filter(other => other.facades.some(candidate => candidate.path === facade.path));
				if (owners.some(other => other.directory.length > map.directory.length)) continue;
				if (owners.some(other => other.path !== path && other.directory === map.directory)) {
					invalid(`ambiguous platform maps for ${facade.name}: ${owners.map(owner => owner.path).join(', ')}`);
					continue;
				}
				const unmatched = facade.platforms.filter(platform => platform.names.length !== 1);
				if (unmatched.length) {
					invalid(
						`${facade.name} needs exactly one optional dependency for each platform: ${
							unmatched.map(platform => `${platform.key} (${platform.names.length} matches)`).join(', ')
						}`,
					);
					continue;
				}
				groups.push({
					name: facade.name,
					versionSource: `${facade.path}#version`,
					platforms: facade.platforms.flatMap(({ names, optional }) => names.map(name => ({ name, optional }))),
				});
			}
		}
		const active = groups.filter(group => !excluded(group.name));
		if (!active.length) continue;
		const names = active.flatMap(
			group => [group.name, ...group.platforms.map(platform => platform.name), ...(group.shim ? [group.shim] : [])],
		);
		if (bundle) names.push(bundle);
		if (new Set(names).size !== names.length) {
			invalid('duplicate generated npm package names');
			continue;
		}
		const facadeManifests = manifests.filter(({ manifest }) => active.some(group => group.name === manifest.name));
		const cargo = Result.try(() => object(parseToml(snapshot.files['Cargo.toml'] ?? '')));
		const root = Result.isSuccess(cargo) ? cargo.success : {};
		const defaultSource = typeof object(object(root.workspace).package).version === 'string'
			? 'Cargo.toml#workspace.package.version'
			: typeof object(root.package).version === 'string'
			? 'Cargo.toml#package.version'
			: snapshot.files['go.mod']
			? 'tags:'
			: facadeManifests.length === 1
			? `${facadeManifests[0]?.path}#version`
			: undefined;
		const generated: Package[] = [];
		const add = (
			name: string,
			dependencies: string[],
			versionSource: string,
			version: string | undefined,
			optional = false,
		) => {
			if (excluded(name)) return;
			generated.push({
				manager: 'npm',
				name,
				...(version === undefined ? {} : { version }),
				manifest: path,
				versionSource,
				publication: registry,
				dependencies,
				generated: true,
				optional,
			});
		};
		let bundleVersion: { source: string; version?: string } | undefined;
		for (const group of active) {
			const versionSource = group.versionSource ?? sourceOverride ?? defaultSource;
			if (!versionSource) {
				invalid(`generated packages for ${group.name} need an explicit versionSource`);
				continue;
			}
			const resolved = readVersion(snapshot, versionSource);
			if (!resolved) {
				invalid(`generated packages need a string version at ${versionSource}`);
				continue;
			}
			bundleVersion = { source: versionSource, ...resolved };
			for (const platform of group.platforms) {
				add(platform.name, [], versionSource, resolved.version, platform.optional);
			}
			const original = originals.find(pkg => pkg.manager === 'npm' && pkg.name === group.name);
			add(
				group.name,
				[...new Set([...(original?.dependencies ?? []), ...group.platforms.map(platform => platform.name)])],
				versionSource,
				resolved.version,
			);
			if (group.shim) add(group.shim, [group.name], versionSource, resolved.version);
		}
		if (bundle && bundleVersion) {
			add(bundle, groups.map(group => group.name), bundleVersion.source, bundleVersion.version);
		}
		inventory.packages = inventory.packages.filter(pkg =>
			pkg.manager !== 'npm' || !generated.some(entry => entry.name === pkg.name)
		);
		inventory.packages.push(...generated);
		detected ||= generated.length > 0;
	}
	return detected;
}
