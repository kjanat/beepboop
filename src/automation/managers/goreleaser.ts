import { parse as parseToml } from 'smol-toml';
import type { Publication, Snapshot } from '../types.ts';
import { goreleaserConfig, object, yaml } from './helpers.ts';
import type { Manager, VerificationContext } from './registry.ts';
import { emptyInventory } from './registry.ts';
import { latestTag, tagSource } from './tags.ts';

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
			result.packages.push({
				manager: 'goreleaser',
				name,
				...(version === undefined ? {} : { version }),
				manifest: path,
				versionSource: tagSource('v'),
				publish: disable !== true && disable !== 'true',
				dependencies: [],
			});
		}
		return result;
	},
};
