import { Effect } from 'effect';
import { routes } from '@/contract/routes';
import { admin, elevated } from '@/server/handlers/kit';

export const securityEndpoints = {
	authenticatorsOptions: admin(
		routes.authenticatorsOptions,
		(input, { service, actor }) =>
			service.authentication.authenticators.options(
				actor,
				input.register === true
					? { kind: 'register', label: input.label, proof: input.proof }
					: { kind: 'authenticate' },
			),
	),
	authenticatorsVerify: admin(
		routes.authenticatorsVerify,
		(input, { service, actor }) => service.authentication.authenticators.verify(actor, input.id, input.response),
	),
	authenticatorsRemove: elevated(
		routes.authenticatorsRemove,
		(input, { service, actor }) =>
			Effect.gen(function*() {
				const authenticators = service.authentication.authenticators;
				yield* authenticators.removable(actor, input.id);
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
