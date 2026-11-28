import { Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { object } from '@/discovery/managers/manifest-editing.ts';
import type { DiscovererOf } from '@/discovery/managers/registry.ts';
import { emptyInventory } from '@/discovery/managers/registry.ts';
import { goreleaserConfig } from '@/domain/catalog.ts';
import type { Channel } from '@/domain/destinations.ts';
import type { Snapshot } from '@/domain/inventory.ts';
import { excluded, registry } from '@/domain/package-publication.ts';
import { latestTag, tagSource } from '@/domain/version-tags.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';
import { yaml } from '@/kernel/parse/yaml.ts';

function cargoName(snapshot: Snapshot): unknown {
	return Result.try(() => parseToml(snapshot.files['Cargo.toml'] ?? '')).pipe(
		Result.map(manifest => object(object(manifest).package).name),
		Result.getOrElse(() => undefined),
	);
}
function moduleName(snapshot: Snapshot): string | undefined {
	const module = /^\s*module\s+["`]?([^\s"`]+)/m.exec(snapshot.files['go.mod'] ?? '')?.[1];
	return module?.split('/').at(-1);
}
export function projectName(snapshot: Snapshot, config: Record<string, unknown>): string | undefined {
	const release = object(config.release);
	return [
		config.project_name,
		cargoName(snapshot),
		object(release.github).name,
		object(release.gitlab).name,
		object(release.gitea).name,
		moduleName(snapshot),
		snapshot.repository.name.split('/')[1],
	].find((name): name is string => typeof name === 'string' && name.trim() !== '');
}
function literal(value: unknown): string | undefined {
	return typeof value === 'string' && !value.includes('{{') ? value.replace(/^\/+|\/+$/g, '') : undefined;
}
function entries(config: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = config[key];
	return Array.isArray(value) ? value.map(object) : [];
}
function channelsOf(path: string, config: Record<string, unknown>, project: string) {
	const channels: Channel[] = [];
	const diagnostics: Diagnostic[] = [];
	const skip = (key: string, index: number) =>
		diagnostics.push(
			fileProblem(
				path,
				'unsupported',
				`${key}[${index}] has a templated or missing name or repository; not checked`,
				'warning',
			),
		);
	for (
		const [key, directory] of [['homebrew_casks', 'Casks'], ['brews', 'Formula'], ['scoops', '']] as const
	) {
		for (const [index, entry] of entries(config, key).entries()) {
			const repository = object(entry.repository);
			const owner = literal(repository.owner);
			const name = literal(repository.name);
			const file = literal(entry.name ?? project);
			const folder = literal(entry.directory ?? directory);
			if (!owner || !name || !file || folder === undefined) {
				skip(key, index);
				continue;
			}
			const target = { repository: `${owner}/${name}`, directory: folder, name: file, manifest: path };
			channels.push(
				key === 'scoops'
					? { destination: 'scoop', ...target }
					: { destination: 'homebrew', kind: key === 'brews' ? 'formula' : 'cask', ...target },
			);
		}
	}
	for (const [key, suffix] of [['aurs', '-bin'], ['aur_sources', '']] as const) {
		for (const [index, entry] of entries(config, key).entries()) {
			const name = literal(entry.name ?? `${project}${suffix}`);
			if (name) channels.push({ destination: 'aur', name, manifest: path });
			else skip(key, index);
		}
	}
	return { channels, diagnostics };
}

export const goreleaserDiscoverer: DiscovererOf<'goreleaser'> = {
	name: 'goreleaser',
	discover(snapshot) {
		const result = emptyInventory();
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			if (!goreleaserConfig.test(path)) continue;
			const parsed = yaml(source);
			if (Result.isFailure(parsed)) {
				result.diagnostics.push(fileProblem(path, 'invalid-manifest', `cannot safely discover configuration`));
				continue;
			}
			const config = parsed.success;
			result.managers = ['goreleaser'];
			const name = projectName(snapshot, config);
			if (!name) {
				result.diagnostics.push(fileProblem(path, 'invalid-manifest', `project_name cannot be derived`));
				continue;
			}
			const disable = object(config.release).disable;
			if (typeof disable === 'string' && disable.includes('{{')) {
				result.diagnostics.push(
					fileProblem(path, 'unsupported', `release.disable is a template; publication assumed`, 'warning'),
				);
			}
			const version = latestTag(snapshot.tags ?? [], 'v');
			const { channels, diagnostics } = channelsOf(path, config, name);
			result.diagnostics.push(...diagnostics);
			result.packages.push({
				manager: 'goreleaser',
				name,
				...(version === undefined ? {} : { version }),
				manifest: path,
				versionSource: tagSource('v'),
				publication: disable === true || disable === 'true' ? excluded('publish-disabled') : registry,
				dependencies: [],
				...(channels.length ? { channels } : {}),
			});
		}
		return result;
	},
};
