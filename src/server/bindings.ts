import { env } from 'cloudflare:workers';
import { Data, Effect, Result } from 'effect';
import { z } from 'zod';
import type { AutomationBindings } from '@/automation/service.ts';

export class ConfigurationError extends Data.TaggedError('ConfigurationError')<{ readonly message: string }> {}

const required = z.object({
	OWNER_ID: z.string().regex(/^[1-9][0-9]*$/),
	ADMIN_SUBJECT: z.string().min(1),
	APPLICATION_ORIGIN: z.url(),
	OPENAUTH_ISSUER: z.url(),
	VAULT_ACTIVE_KEY: z.string().min(1),
	VAULT_KEYS: z.string().transform((value, context) => {
		const keys = Result.try(() => z.record(z.string(), z.string()).parse(JSON.parse(value)));
		if (Result.isSuccess(keys)) return keys.success;
		context.addIssue({ code: 'custom', message: 'VAULT_KEYS must be a JSON object of strings' });
		return z.NEVER;
	}),
});

export function parseBindings<T extends AutomationBindings>(source: T): Effect.Effect<T, ConfigurationError> {
	const result = required.safeParse(source);
	return result.success
		? Effect.succeed(source)
		: Effect.fail(
			new ConfigurationError({
				message: `Worker configuration invalid: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`,
			}),
		);
}

/** Local sign-in must return to the local application, never production. */
export const bindings: Effect.Effect<AutomationBindings, ConfigurationError> = Effect.suspend(() => parseBindings(env))
	.pipe(
		Effect.map(parsed =>
			import.meta.env.MODE === 'development' ? { ...parsed, APPLICATION_ORIGIN: 'http://localhost:4321' } : parsed
		),
	);
