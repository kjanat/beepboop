import { Effect } from 'effect';
import type { RepositoryGateway } from '@/automation/github';
import { repositorySchema } from '@/automation/github-resources';
import type { Publication } from '@/automation/types';
import { sha256Hex } from '@/contract/ids';
import { fromJson, fromPromise } from '@/failure';
import { record } from '@/model';

/** Verify the current default-branch manifest without evaluating package code. */
export function verifyManifest(publication: Publication, gateway: RepositoryGateway): Effect.Effect<Publication> {
	const [, repository, path] = publication.name.match(/^([\w.-]+\/[\w.-]+)\/(.+\.(?:json|rb))$/) ?? [];
	if (!repository || !path || path.split('/').some((part) => part === '..' || part === '')) {
		return Effect.succeed({ ...publication, outcome: 'failed' });
	}
	return Effect.gen(function*() {
		const branch = (yield* gateway.read(repositorySchema, `/repos/${repository}`, '')).default_branch;
		const content = yield* gateway.file(repository, path, branch, '');
		if (content === null) return { ...publication, outcome: 'pending' as const };
		const hash = yield* fromPromise(() => sha256Hex(content));
		const version = path.endsWith('.json')
			? (yield* Effect.fromResult(record(yield* fromJson(content)))).version
			: content.match(/^\s*version\s+["']([^"']+)["']/m)?.[1];
		const valid = version === publication.version && publication.digest === `sha256:${hash}`;
		return {
			...publication,
			outcome: valid ? 'succeeded' as const : 'failed' as const,
			url: `https://github.com/${repository}/blob/${branch}/${path}`,
		};
	}).pipe(Effect.catchCause(() => Effect.succeed({ ...publication, outcome: 'uncertain' as const })));
}
