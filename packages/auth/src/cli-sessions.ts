import { Effect } from 'effect';
import type { CLISessionStore } from '@/auth/adapters/d1/cli-sessions.ts';
import type { AuthBindings } from '@/auth/service.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { unauthenticated } from '@/kernel/errors/domain-error.ts';
import { cliTokenPattern, sha256Hex } from '@/kernel/schema/ids.ts';

type CLIEnvironment = Pick<AuthBindings, 'ADMIN_SUBJECT'> & Partial<Pick<AuthBindings, 'DB'>>;
export function cliBearer(request: Request): string | undefined {
	const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
	return token !== undefined && cliTokenPattern.test(token) ? token : undefined;
}
export function cliSubject(
	request: Request,
	env: CLIEnvironment,
	sessions: CLISessionStore,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const token = cliBearer(request);
		if (token === undefined) return yield* unauthenticated('CLI login required');
		const hash = yield* fromPromise(() => sha256Hex(token));
		const subject = yield* sessions.subject(hash);
		if (!subject || !env.ADMIN_SUBJECT || subject !== env.ADMIN_SUBJECT) {
			return yield* unauthenticated('CLI session revoked; run beepboop auth login');
		}
		return subject;
	});
}
