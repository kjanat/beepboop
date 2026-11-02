import { env } from 'cloudflare:workers';
import type { AutomationBindings } from '@/automation/service.ts';

/** Local sign-in must return to the local application, never production. */
export function bindings(): AutomationBindings {
	return import.meta.env.DEV ? { ...env, APPLICATION_ORIGIN: 'http://localhost:4321' } : env;
}
