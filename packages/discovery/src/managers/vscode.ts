import { object } from '@/discovery/managers/manifest-editing.ts';
import { packageManifests } from '@/discovery/managers/package-json.ts';
import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { emptyInventory } from '@/discovery/managers/registry.ts';
import { identityOf } from '@/domain/package-identity.ts';
import { excluded, registry } from '@/domain/package-publication.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';

const identifier = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export const vscodeDiscoverer: DiscovererOf<'vscode'> = {
	name: 'vscode',
	identity: pkg => identityOf(pkg),
	discover(snapshot) {
		const inventory = emptyInventory();
		for (const { path, manifest } of packageManifests(snapshot, inventory.diagnostics)) {
			if (typeof object(manifest.engines).vscode !== 'string') continue;
			inventory.managers = ['vscode'];
			if (typeof manifest.publisher !== 'string' || !identifier.test(manifest.publisher)) {
				inventory.diagnostics.push(
					fileProblem(path, 'invalid-manifest', `VS Code extension publisher is missing or invalid`),
				);
				continue;
			}
			if (typeof manifest.name !== 'string' || !identifier.test(manifest.name)) {
				inventory.diagnostics.push(
					fileProblem(path, 'invalid-manifest', `VS Code extension name is missing or invalid`),
				);
				continue;
			}
			inventory.packages.push({
				manager: 'vscode',
				name: `${manifest.publisher}.${manifest.name}`,
				...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
				manifest: path,
				versionSource: `${path}#version`,
				publication: manifest.private === true ? excluded('private') : registry,
				dependencies: Array.isArray(manifest.extensionDependencies)
					? manifest.extensionDependencies.filter(dependency => typeof dependency === 'string')
					: [],
			});
		}
		return inventory;
	},
};
