import { Effect } from 'effect';
import type { VerificationContext } from '@/automation/gateway.ts';
import type { Adapter, RegistryVersion } from '@/automation/managers/registry';
import { publicationResult } from '@/automation/managers/verification';
import type { Publication } from '@/automation/types';
import { goreleaserDiscoverer } from '@/discovery/managers/goreleaser.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';

function verifyRelease(
	publication: Publication,
	context: VerificationContext | undefined,
): Effect.Effect<Publication> {
	if (!context) return Effect.succeed({ ...publication, outcome: 'uncertain' });
	const tag = `v${publication.version.replace(/^v/, '')}`;
	const url = `https://github.com/${context.repository}/releases/tag/${encodeURIComponent(tag)}`;
	const result = publicationResult(publication, url);
	return context.github(`/repos/${context.repository}/releases/tags/${encodeURIComponent(tag)}`).pipe(
		Effect.map(found => {
			if (found === null) return result('pending');
			const release = object(found);
			if (release.tag_name !== tag) return result('failed');
			const assets = Array.isArray(release.assets) ? release.assets.map(object) : [];
			if (release.draft !== false || !assets.length || assets.some(asset => asset.state !== 'uploaded')) {
				return result('pending');
			}
			return result('succeeded');
		}),
		Effect.orElseSucceed(() => result('uncertain')),
	);
}

export const goreleaserManager: Adapter<'goreleaser'> = {
	...goreleaserDiscoverer,
	verifyPublication: (publication, _request, context) => verifyRelease(publication, context),
	latest(_pkg, _request, context) {
		if (!context) {
			return Effect.succeed({ kind: 'failed', url: 'https://api.github.com', reason: 'GitHub access unavailable' });
		}
		const url = `https://github.com/${context.repository}/releases/latest`;
		return context.github(`/repos/${context.repository}/releases/latest`).pipe(
			Effect.map((found): RegistryVersion => {
				if (found === null) return { kind: 'missing', url };
				const tag = object(found).tag_name;
				return typeof tag === 'string' && /^v?\d+\.\d+\.\d+/.test(tag)
					? { kind: 'published', version: tag.replace(/^v/, '') }
					: { kind: 'failed', url, reason: 'no valid version' };
			}),
			Effect.orElseSucceed((): RegistryVersion => ({ kind: 'failed', url, reason: 'request failed' })),
		);
	},
};
