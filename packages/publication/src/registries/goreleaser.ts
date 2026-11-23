import { Effect } from 'effect';
import type { Publication } from '@/automation/types';
import { goreleaserDiscoverer } from '@/discovery/managers/goreleaser.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import type { VerificationContext } from '@/publication/registries/context.ts';
import { VerificationOutcome } from '@/publication/registries/outcome.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import { publicationResult } from '@/publication/registries/verification.ts';

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
			return Effect.succeed(
				VerificationOutcome.LookupFailed({ url: 'https://api.github.com', reason: 'GitHub access unavailable' }),
			);
		}
		const url = `https://github.com/${context.repository}/releases/latest`;
		return context.github(`/repos/${context.repository}/releases/latest`).pipe(
			Effect.map((found): VerificationOutcome => {
				if (found === null) return VerificationOutcome.Missing({ url });
				const tag = object(found).tag_name;
				return typeof tag === 'string' && /^v?\d+\.\d+\.\d+/.test(tag)
					? VerificationOutcome.Published({ version: tag.replace(/^v/, '') })
					: VerificationOutcome.LookupFailed({ url, reason: 'no valid version' });
			}),
			Effect.orElseSucceed(() => VerificationOutcome.LookupFailed({ url, reason: 'request failed' })),
		);
	},
};
