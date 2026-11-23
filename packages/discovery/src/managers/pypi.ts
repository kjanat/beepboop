import { Effect, Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { editTomlVersion, object } from '@/discovery/managers/manifest-editing.ts';
import { isPyproject, privateProject } from '@/discovery/managers/pyproject.ts';
import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { emptyInventory } from '@/discovery/managers/registry.ts';
import { excluded, registry } from '@/domain/package-publication.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { packageIdentity } from '@/package-url';

export const projectName = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export function normalizedProject(name: string): string {
	return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export const pypiDiscoverer: DiscovererOf<'pypi'> = {
	name: 'pypi',
	identity: pkg => packageIdentity({ type: 'pypi', name: pkg.name, version: pkg.version }),
	discover(snapshot) {
		const inventory = emptyInventory();
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!isPyproject(path)) continue;
			const document = Result.try(() => object(parseToml(source)));
			if (Result.isFailure(document)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', 'invalid TOML'));
				continue;
			}
			const project = object(document.success.project);
			if (typeof project.name !== 'string') continue;
			inventory.managers = ['pypi'];
			if (!projectName.test(project.name)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', 'invalid Python project name'));
				continue;
			}
			const hidden = privateProject(document.success);
			inventory.packages.push({
				manager: 'pypi',
				name: normalizedProject(project.name),
				manifest: path,
				...(typeof project.version === 'string' ? { version: project.version } : {}),
				versionSource: `${path}#project.version`,
				publication: hidden ? excluded('private') : registry,
				dependencies: [],
			});
		}
		return inventory;
	},
	ownsVersionSource: source => /(?:^|\/)pyproject\.toml#project\.version$/.test(source),
	editVersion({ before, version }) {
		const after = editTomlVersion(before, heading => heading.trim() === 'project', version);
		return after === undefined
			? Effect.fail(precondition('Cannot safely edit [project].version'))
			: Effect.succeed(after);
	},
};
