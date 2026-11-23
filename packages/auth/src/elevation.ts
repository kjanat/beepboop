import { Effect } from 'effect';
import type { SessionStore } from '@/auth/adapters/d1/sessions.ts';
import { fromJson } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { forbidden } from '@/kernel/errors/domain-error.ts';
import { record } from '@/kernel/schema/result.ts';

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
	const document = yield* sessions.take(proof);
	if (document === undefined) return yield* forbidden('Fresh security-key authentication required');
	const data = yield* Effect.fromResult(record(yield* fromJson(document)));
	if (data.subject !== subject || data.elevated !== true) {
		return yield* forbidden('Invalid authentication proof');
	}
});
