import { env } from 'cloudflare:workers';
import { Data, Effect, Result, Schema } from 'effect';
import type { AutomationBindings } from '@/automation/service.ts';
import { decodeSync, mapped, matchesPattern, mutableRecord, mutableStruct, safeDecode, schemaIssues } from '@/schema';

export class ConfigurationError extends Data.TaggedError('ConfigurationError')<{ readonly message: string }> {}

const required = mutableStruct({
	OWNER_ID: Schema.String.check(matchesPattern(/^[1-9][0-9]*$/)),
	ADMIN_SUBJECT: Schema.String.check(Schema.isMinLength(1)),
	APPLICATION_ORIGIN: Schema.String.check(Schema.makeFilter(value => URL.canParse(value))),
	OPENAUTH_ISSUER: Schema.String.check(Schema.makeFilter(value => URL.canParse(value))),
	VAULT_ACTIVE_KEY: Schema.String.check(Schema.isMinLength(1)),
	VAULT_KEYS: mapped(Schema.String, mutableRecord(Schema.String, Schema.String), (value, context) => {
		const keys = Result.try(() => decodeSync(mutableRecord(Schema.String, Schema.String), JSON.parse(value)));
		if (Result.isSuccess(keys)) return keys.success;
		context.addIssue({ code: 'custom', message: 'VAULT_KEYS must be a JSON object of strings' });
		return undefined as never;
	}, value => JSON.stringify(value)),
});

export function parseBindings<T extends AutomationBindings>(source: T): Effect.Effect<T, ConfigurationError> {
	const result = safeDecode(required, source);
	return result.success
		? Effect.succeed(source)
		: Effect.fail(
			new ConfigurationError({
				message: `Worker configuration invalid: ${
					schemaIssues(result.error).map(issue => issue.path.join('.')).join(', ')
				}`,
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
