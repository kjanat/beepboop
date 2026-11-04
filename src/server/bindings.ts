import { env } from 'cloudflare:workers';
import { z } from 'zod';
import type { AutomationBindings } from '@/automation/service.ts';

class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigurationError';
	}
}

const required = z.object({
	OWNER_ID: z.string().regex(/^[1-9][0-9]*$/),
	ADMIN_SUBJECT: z.string().min(1),
	APPLICATION_ORIGIN: z.url(),
	OPENAUTH_ISSUER: z.url(),
	VAULT_ACTIVE_KEY: z.string().min(1),
	VAULT_KEYS: z.string().transform((value, context) => {
		try {
			return z.record(z.string(), z.string()).parse(JSON.parse(value));
		} catch {
			context.addIssue({ code: 'custom', message: 'VAULT_KEYS must be a JSON object of strings' });
			return z.NEVER;
		}
	}),
});

export function parseBindings<T extends AutomationBindings>(source: T): T {
	const result = required.safeParse(source);
	if (!result.success) {
		throw new ConfigurationError(
			`Worker configuration invalid: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`,
		);
	}
	return source;
}

/** Local sign-in must return to the local application, never production. */
export function bindings(): AutomationBindings {
	const parsed = parseBindings(env);
	return import.meta.env.MODE === 'development' ? { ...parsed, APPLICATION_ORIGIN: 'http://localhost:4321' } : parsed;
}
