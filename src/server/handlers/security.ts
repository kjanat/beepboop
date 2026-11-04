import { Authenticators } from '@/automation/auth';
import { notFound, precondition } from '@/contract/errors';
import { routes } from '@/contract/routes';
import { admin, elevated } from '@/server/handlers/kit';

export const securityEndpoints = {
	authenticatorsOptions: admin(routes.authenticatorsOptions, async (input, { env, actor }) => {
		const authenticators = new Authenticators(env);
		const register = input.register === true;
		if (register && (await authenticators.enrolled(actor)) > 0) {
			await authenticators.consume(actor, input.proof ?? '');
		}
		return authenticators.options(actor, register, input.label);
	}),
	authenticatorsVerify: admin(
		routes.authenticatorsVerify,
		(input, { env, actor }) => new Authenticators(env).verify(actor, input.id, input.response),
	),
	authenticatorsRemove: elevated(routes.authenticatorsRemove, async (input, { env, service, actor }) => {
		const authenticators = new Authenticators(env);
		const keys = await authenticators.list(actor);
		if (!keys.some(key => key.id === input.id)) throw notFound('security-key', 'Unknown security key', input.id);
		if (keys.length < 2) throw precondition('Cannot remove the last enrolled key');
		return async () => {
			await authenticators.remove(actor, input.id);
			await service.store.audit(actor, 'authenticator.remove', input.id);
			return { removed: true };
		};
	}),
	cliSessionsRevoke: admin(routes.cliSessionsRevoke, async (input, { service, actor }) => {
		await service.cliSessions.revoke(input.id);
		await service.store.audit(actor, 'cli.revoke', input.id.slice(0, 12));
		return { ok: true };
	}),
	cliSessionsRevokeAll: admin(routes.cliSessionsRevokeAll, async (_, { service, actor }) => {
		await service.cliSessions.revokeAll();
		await service.store.audit(actor, 'cli.revoke-all', 'all');
		return { ok: true };
	}),
} as const;
