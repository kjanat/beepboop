import { parse as parseToml } from 'smol-toml';
import type { Channel } from '@/automation/destinations';
import { goreleaserConfig, object, yaml } from '@/automation/managers/helpers';
import type { Manager, VerificationContext } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { latestTag, tagSource } from '@/automation/managers/tags';
import { excluded, registry } from '@/automation/package-publication';
import type { Publication, Snapshot } from '@/automation/types';
import { packageIdentity } from '@/package-url';

function cargoName(snapshot: Snapshot): unknown {
	try {
		return object(object(parseToml(snapshot.files['Cargo.toml'] ?? '')).package).name;
	} catch {
		return undefined;
	}
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
	const diagnostics: string[] = [];
	const skip = (key: string, index: number) =>
		diagnostics.push(`${path}: ${key}[${index}] has a templated or missing name or repository; not checked`);
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
async function verifyRelease(
	publication: Publication,
	context: VerificationContext | undefined,
): Promise<Publication> {
	if (!context) return { ...publication, outcome: 'uncertain' };
	const tag = `v${publication.version.replace(/^v/, '')}`;
	const url = `https://github.com/${context.repository}/releases/tag/${encodeURIComponent(tag)}`;
	try {
		const found = await context.github(`/repos/${context.repository}/releases/tags/${encodeURIComponent(tag)}`);
		if (found === null) return { ...publication, outcome: 'pending', url };
		const release = object(found);
		if (release.tag_name !== tag) return { ...publication, outcome: 'failed', url };
		const assets = Array.isArray(release.assets) ? release.assets.map(object) : [];
		if (release.draft !== false || !assets.length || assets.some(asset => asset.state !== 'uploaded')) {
			return { ...publication, outcome: 'pending', url };
		}
		return { ...publication, outcome: 'succeeded', url };
	} catch {
		return { ...publication, outcome: 'uncertain', url };
	}
}

export const goreleaserManager: Manager = {
	name: 'goreleaser',
	identity(pkg, snapshot) {
		const slash = snapshot.repository.name.lastIndexOf('/');
		return packageIdentity({
			type: 'github',
			namespace: snapshot.repository.name.slice(0, slash),
			name: snapshot.repository.name.slice(slash + 1),
			version: pkg.version === undefined ? undefined : `v${pkg.version.replace(/^v/, '')}`,
		});
	},
	verifyPublication: (publication, _request, context) => verifyRelease(publication, context),
	discover(snapshot) {
		const result = emptyInventory();
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			if (!goreleaserConfig.test(path)) continue;
			let config: Record<string, unknown>;
			try {
				config = yaml(source);
			} catch {
				result.diagnostics.push(`${path}: cannot safely discover configuration`);
				continue;
			}
			result.managers = ['goreleaser'];
			const name = projectName(snapshot, config);
			if (!name) {
				result.diagnostics.push(`${path}: project_name cannot be derived`);
				continue;
			}
			const disable = object(config.release).disable;
			if (typeof disable === 'string' && disable.includes('{{')) {
				result.diagnostics.push(`${path}: release.disable is a template; publication assumed`);
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
