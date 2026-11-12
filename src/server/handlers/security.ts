import { Effect } from 'effect';
import { notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { admin, elevated } from '@/server/handlers/kit';

export const securityEndpoints = {
	authenticatorsOptions: admin(routes.authenticatorsOptions, (input, { service, actor }) =>
		Effect.gen(function*() {
			const authenticators = service.authentication.authenticators;
			const register = input.register === true;
			if (register && (yield* authenticators.enrolled(actor)) > 0) {
				yield* authenticators.consume(actor, input.proof ?? '');
			}
			return yield* authenticators.options(actor, register, input.label);
		})),
	authenticatorsVerify: admin(
		routes.authenticatorsVerify,
		(input, { service, actor }) => service.authentication.authenticators.verify(actor, input.id, input.response),
	),
	authenticatorsRemove: elevated(
		routes.authenticatorsRemove,
		(input, { service, actor }) =>
			Effect.gen(function*() {
				const authenticators = service.authentication.authenticators;
				const keys = yield* authenticators.list(actor);
				if (!keys.some(key => key.id === input.id)) {
					return yield* notFound('security-key', 'Unknown security key', input.id);
				}
				if (keys.length < 2) return yield* precondition('Cannot remove the last enrolled key');
				return {
					commit: Effect.gen(function*() {
						yield* authenticators.remove(actor, input.id);
						yield* service.store.audit(actor, 'authenticator.remove', input.id);
						return { removed: true };
					}),
				};
			}),
	),
	cliSessionsRevoke: admin(routes.cliSessionsRevoke, (input, { service, actor }) =>
		Effect.gen(function*() {
			yield* service.cliSessions.revoke(input.id);
			yield* service.store.audit(actor, 'cli.revoke', input.id.slice(0, 12));
			return { ok: true };
		})),
	cliSessionsRevokeAll: admin(routes.cliSessionsRevokeAll, (_, { service, actor }) =>
		Effect.gen(function*() {
			yield* service.cliSessions.revokeAll();
			yield* service.store.audit(actor, 'cli.revoke-all', 'all');
			return { ok: true };
		})),
} as const;
