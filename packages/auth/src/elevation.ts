import { Effect } from 'effect';
import type { SessionStore } from '@/auth/adapters/d1/sessions.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { forbidden } from '@/kernel/errors/domain-error.ts';

export const grantElevation = Effect.fnUntraced(function*(
	sessions: SessionStore,
	subject: string,
): Effect.fn.Return<string, DomainError> {
	const proof = crypto.randomUUID();
	yield* sessions.open('elevation', proof, { subject, elevated: true }, 60000);
	return proof;
});

export const consumeElevation = Effect.fnUntraced(function*(
	sessions: SessionStore,
	subject: string,
	proof: string,
): Effect.fn.Return<void, DomainError> {
	const elevation = yield* sessions.take('elevation', proof);
	if (elevation === undefined) return yield* forbidden('Fresh security-key authentication required');
	if (elevation.subject !== subject) return yield* forbidden('Invalid authentication proof');
});
