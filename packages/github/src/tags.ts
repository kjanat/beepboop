import { Clock, Effect, Schema } from 'effect';
import type { RefState } from '@/domain/refs.ts';
import type { GitObject } from '@/github/resources.ts';
import { createdTagSchema, gitTagSchema } from '@/github/resources.ts';
import type { GitHubRequests } from '@/github/transport.ts';
import { GitHubRejection, rateLimited } from '@/github/transport.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { decode, textSchema } from '@/kernel/schema/result.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';

interface TagTarget {
	__typename: string;
	oid: string;
	target?: TagTarget | undefined;
}
const tagTargetSchema: Schema.Codec<TagTarget, unknown> = mutableStruct({
	__typename: textSchema,
	oid: textSchema,
	target: Schema.optional(Schema.suspend(() => tagTargetSchema)),
});
const graphqlEnvelope = looseStruct({
	errors: Schema.optional(mutableArray(looseStruct({ message: Schema.String, type: Schema.optional(Schema.String) }))),
});
const tagRefsSchema = mutableStruct({
	data: mutableStruct({
		repository: mutableStruct({
			refs: mutableStruct({
				pageInfo: mutableStruct({ hasNextPage: Schema.Boolean, endCursor: Schema.NullOr(Schema.String) }),
				nodes: mutableArray(mutableStruct({ name: textSchema, target: tagTargetSchema })),
			}),
		}),
	}),
});
const tagPeelDepth = 8;
function tagTargetSelection(depth: number): string {
	return depth === 0 ? '__typename oid' : `__typename oid ... on Tag{target{${tagTargetSelection(depth - 1)}}}`;
}
const tagRefsQuery =
	`query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){refs(refPrefix:"refs/tags/",first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{name target{${
		tagTargetSelection(tagPeelDepth)
	}}}}}}`;

export interface TagRequest {
	name: string;
	commit: string;
	message: string;
	tagger: { name: string; email: string; date: string };
	signed: boolean;
}

export function peelTag(
	github: GitHubRequests,
	repository: string,
	object: GitObject,
	token: string,
): Effect.Effect<GitObject, DomainError> {
	if (object.type !== 'tag') return Effect.succeed(object);
	return github.read(gitTagSchema, `/repos/${repository}/git/tags/${object.sha}`, token).pipe(
		Effect.map(tag => tag.object),
	);
}

/** GitHub builds the tag object from these fields; a signature appended to the message verifies when the fields reproduce the signed payload. */
export function createTag(
	github: GitHubRequests,
	name: string,
	token: string,
	tag: TagRequest,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const created = yield* github.read(createdTagSchema, `/repos/${name}/git/tags`, token, 'POST', {
			tag: tag.name,
			message: tag.message,
			object: tag.commit,
			type: 'commit',
			tagger: tag.tagger,
		});
		if (tag.signed && !created.verification.verified) {
			return yield* precondition(
				`GitHub did not verify the signature of ${tag.name} (${created.verification.reason ?? 'unknown reason'})`,
			);
		}
		yield* github.call(`/repos/${name}/git/refs`, token, 'POST', { ref: `refs/tags/${tag.name}`, sha: created.sha });
	});
}

export function tagRefs(github: GitHubRequests, name: string, token: string): Effect.Effect<RefState[], DomainError> {
	return Effect.gen(function*() {
		const [owner = '', repository = ''] = name.split('/');
		const result: RefState[] = [];
		let after: string | null = null;
		for (let page = 1; page <= 100; page++) {
			const raw: unknown = yield* github.call('/graphql', token, 'POST', {
				query: tagRefsQuery,
				variables: { owner, name: repository, after },
			}, true);
			const envelope = yield* Effect.fromResult(decode(graphqlEnvelope, raw));
			if (envelope.errors?.length) {
				const reason = `GitHub tag discovery failed: ${envelope.errors.map(error => error.message).join('; ')}`;
				if (envelope.errors.some(error => rateLimited(error.message, error.type))) {
					const clock = yield* Clock.Clock;
					return yield* new GitHubRejection(429, reason, clock.currentTimeMillisUnsafe() + 60_000);
				}
				return yield* precondition(reason);
			}
			const response: Decoded<typeof tagRefsSchema> = yield* Effect.fromResult(decode(tagRefsSchema, raw)).pipe(
				Effect.mapError(() => precondition('GitHub tag discovery returned missing or invalid repository/ref data')),
			);
			const { nodes, pageInfo } = response.data.repository.refs;
			for (const { name: tag, target } of nodes) {
				let peeled = target;
				while (peeled.target) peeled = peeled.target;
				if (peeled.__typename !== 'Commit') return yield* precondition('Tag does not resolve to a commit');
				result.push({ name: tag, oid: target.oid, commit: peeled.oid });
			}
			if (!pageInfo.hasNextPage) return result;
			if (pageInfo.endCursor === null || pageInfo.endCursor === after) {
				return yield* precondition('Tag discovery cursor did not advance');
			}
			after = pageInfo.endCursor;
		}
		return yield* precondition('Tag discovery limit exceeded');
	});
}
