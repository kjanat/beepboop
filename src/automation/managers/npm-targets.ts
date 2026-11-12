import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { packageManifests } from '@/automation/managers/package-json';
import { latestTag, tagPrefix } from '@/automation/managers/tags';
import { registry } from '@/automation/package-publication';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import { npmTargets } from '@/contract/catalog';
import { fileProblem } from '@/contract/diagnostics';
import { npmTargetDescriptor, platformMap } from '@/contract/targets';
import { safeVersionPath } from '@/contract/version-files';

export function discoverNpmTargets(snapshot: Snapshot, inventory: Inventory): boolean {
	const manifests = [...packageManifests(snapshot, [])];
	let detected = false;
	for (const [path, source] of Object.entries(snapshot.files)) {
		if (!npmTargets.test(path)) continue;
		const invalid = (detail: string) => inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', detail));
		const json = Result.try((): unknown => JSON.parse(source));
		if (Result.isFailure(json)) {
			invalid('invalid target descriptor JSON');
			continue;
		}
		const raw = object(json.success);
		const parsed = npmTargetDescriptor.safeParse(json.success);
		const groups: { name: string; platforms: { name: string; optional: boolean }[]; shim?: string }[] = [];
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
			const map = platformMap.safeParse(json.success);
			if (!map.success || !Object.keys(map.data).length) continue;
			const keys = Object.keys(map.data).filter(key => key !== '$schema');
			if (!keys.length) continue;
			for (const { manifest } of manifests) {
				if (typeof manifest.name !== 'string' || manifest.private === true) continue;
				const names = Object.keys(object(manifest.optionalDependencies));
				const platforms = keys.map(key => names.filter(name => name.endsWith(`-${key}`)));
				if (platforms.every(matches => matches.length === 1)) {
					groups.push({
						name: manifest.name,
						platforms: platforms.flatMap(matches => matches.map(name => ({ name, optional: false }))),
					});
				}
			}
		}
		if (!groups.length) continue;
		const names = groups.flatMap(
			group => [group.name, ...group.platforms.map(platform => platform.name), ...(group.shim ? [group.shim] : [])],
		);
		if (bundle) names.push(bundle);
		if (new Set(names).size !== names.length) {
			invalid('duplicate generated npm package names');
			continue;
		}
		const facadeManifests = manifests.filter(({ manifest }) => groups.some(group => group.name === manifest.name));
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
		const versionSource = sourceOverride ?? defaultSource;
		if (!versionSource) {
			invalid('generated packages need an explicit versionSource');
			continue;
		}
		const prefix = tagPrefix(versionSource);
		let version: string | undefined;
		if (prefix !== undefined) version = latestTag(snapshot.tags ?? [], prefix);
		else {
			const [file, key] = versionSource.split('#');
			if (!file || !key || !safeVersionPath(file)) {
				invalid('invalid generated package versionSource');
				continue;
			}
			const value = Result.try(() =>
				file.endsWith('Cargo.toml') ? parseToml(snapshot.files[file] ?? '') : JSON.parse(snapshot.files[file] ?? '')
			);
			const found = Result.isSuccess(value)
				? key.split('.').reduce<unknown>((current, key) => object(current)[key], value.success)
				: undefined;
			if (typeof found !== 'string') {
				invalid(`generated packages need a string version at ${versionSource}`);
				continue;
			}
			version = found;
		}
		const generated: Package[] = [];
		const add = (name: string, dependencies: string[], optional = false) =>
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
		for (const group of groups) {
			for (const platform of group.platforms) add(platform.name, [], platform.optional);
			const original = inventory.packages.find(pkg => pkg.manager === 'npm' && pkg.name === group.name);
			add(group.name, [
				...new Set([...(original?.dependencies ?? []), ...group.platforms.map(platform => platform.name)]),
			]);
			if (group.shim) add(group.shim, [group.name]);
		}
		if (bundle) add(bundle, groups.map(group => group.name));
		inventory.packages = inventory.packages.filter(pkg =>
			pkg.manager !== 'npm' || !generated.some(entry => entry.name === pkg.name)
		);
		inventory.packages.push(...generated);
		detected = true;
	}
	return detected;
}
