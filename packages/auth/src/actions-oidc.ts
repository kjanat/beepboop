import { Clock, Effect, Result } from 'effect';
import type { JwsKeyResolver } from 'micro509/jose';
import { verified } from '@/auth/jwt.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { forbidden, unauthenticated } from '@/kernel/errors/domain-error.ts';
import { integer, sha, text } from '@/kernel/schema/result.ts';

export interface RunIdentity {
	helperSha?: string;
	repositoryId: number;
	repository: string;
	ownerId: number;
	actorId: number;
	runId: number;
	attempt: number;
	sha: string;
	workflowSha: string;
	workflowRef: string;
	ref: string;
	environment?: string;
	event: string;
}

export function workflowIdentity(
	request: Request,
	audience: string,
	ownerId: number,
	issuerKeys: JwsKeyResolver,
): Effect.Effect<RunIdentity, DomainError> {
	return Effect.gen(function*() {
		const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
		if (!token || token.length > 20000) return yield* unauthenticated('Workflow authentication required');
		const now = yield* Clock.currentTimeMillis;
		const { claims: payload } = yield* verified(token, {
			key: issuerKeys,
			algorithms: ['RS256'],
			tokenType: { unchecked: true },
			claims: {
				issuer: 'https://token.actions.githubusercontent.com',
				now: () => new Date(now),
				audience,
				requiredClaims: ['exp', 'iat', 'sub'],
				futureIssuedAt: 'allow',
			},
		});
		const identity: RunIdentity = yield* Effect.fromResult(Result.gen(function*() {
			return {
				repositoryId: yield* integer(Number(payload.repository_id)),
				repository: yield* text(payload.repository),
				ownerId: yield* integer(Number(payload.repository_owner_id)),
				actorId: yield* integer(Number(payload.actor_id)),
				runId: yield* integer(Number(payload.run_id)),
				attempt: yield* integer(Number(payload.run_attempt)),
				sha: yield* sha(payload.sha),
				workflowSha: yield* sha(payload.workflow_sha),
				...(payload.job_workflow_sha === undefined || payload.job_workflow_ref === payload.workflow_ref
					? {}
					: { helperSha: yield* sha(payload.job_workflow_sha) }),
				workflowRef: yield* text(payload.workflow_ref),
				ref: yield* text(payload.ref),
				event: yield* text(payload.event_name),
				...(typeof payload.environment === 'string' ? { environment: payload.environment } : {}),
			};
		}));
		if (identity.ownerId !== ownerId || identity.event === 'pull_request_target') {
			return yield* forbidden('Workflow identity is not eligible');
		}
		return identity;
	});
}
