import { Effect } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import type { Publication } from '@/automation/types';
import { fromPromise } from '@/failure';
import { record, text } from '@/model';

/** Verify the current default-branch manifest without evaluating package code. */
export function verifyManifest(publication: Publication, gateway: RepositoryGateway): Effect.Effect<Publication> {
	const [, repository, path] = publication.name.match(/^([\w.-]+\/[\w.-]+)\/(.+\.(?:json|rb))$/) ?? [];
	if (!repository || !path || path.split('/').some((part) => part === '..' || part === '')) {
		return Effect.succeed({ ...publication, outcome: 'failed' });
	}
	return Effect.gen(function*() {
		const metadata = record(yield* gateway.call(`/repos/${repository}`, ''));
		const branch = text(metadata.default_branch);
		const content = yield* gateway.file(repository, path, branch, '');
		if (content === null) return { ...publication, outcome: 'pending' as const };
		const digest = yield* fromPromise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
		const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
		const version = path.endsWith('.json')
			? record(JSON.parse(content)).version
			: content.match(/^\s*version\s+["']([^"']+)["']/m)?.[1];
		const valid = version === publication.version && publication.digest === `sha256:${hash}`;
		return {
			...publication,
			outcome: valid ? 'succeeded' as const : 'failed' as const,
			url: `https://github.com/${repository}/blob/${branch}/${path}`,
		};
	}).pipe(Effect.catchCause(() => Effect.succeed({ ...publication, outcome: 'uncertain' as const })));
}
