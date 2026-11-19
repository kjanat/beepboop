import { DurableObject } from 'cloudflare:workers';
import { Effect, Logger } from 'effect';
import { DomainError, precondition } from '@/kernel/errors/domain-error.ts';
import { failure, toDomainError } from '@/kernel/errors/classify.ts';

export class Probe extends DurableObject {
	async check(kind: string): Promise<void> {
		if (kind === 'precondition') {
			throw new DomainError({
				problem: precondition('The crate needs a license').problem,
				message: 'The crate needs a license',
				detail: 'server-only detail',
				cause: new Error('server-only cause'),
			});
		}
		if (kind === 'upstream') {
			throw new DomainError({
				problem: { code: 'upstream', service: 'registry', retryable: true },
				message: 'Registry lookup failed',
			});
		}
		if (kind === 'malformed') {
			throw Object.assign(new Error('server-only malformed detail'), {
				_tag: 'DomainError',
				problem: { code: 'unexpected' },
			});
		}
		throw new Error('server-only defect');
	}
}

export default {
	async fetch(request: Request, env: { PROBE: DurableObjectNamespace<Probe> }): Promise<Response> {
		try {
			await env.PROBE.getByName('test').check(new URL(request.url).pathname.slice(1));
			return new Response('Unexpected success');
		} catch (error) {
			return Effect.runPromise(failure(request, toDomainError(error)).pipe(Effect.provide(Logger.layer([]))));
		}
	},
};
