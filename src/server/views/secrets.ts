import type { ViewOf } from '@/server/loaders.ts';
import { workflowChoices } from '@/server/views/workflows.ts';

export function secretsPage(data: ViewOf<'secrets'>) {
	const configured = data.repositories.flatMap(repository => {
		const workflows = workflowChoices(repository);
		return workflows.length ? [{ id: repository.id, name: repository.name, workflows }] : [];
	});
	return {
		configured,
		versions: JSON.stringify(Object.fromEntries(data.secrets.map(secret => [secret.alias, secret.version]))),
		secrets: data.secrets.map(secret => {
			const grants = data.grants.filter(grant => grant.alias === secret.alias).map(grant => ({
				...grant,
				copy: data.deliveries.find(d => d.grant_id === grant.id && d.version === secret.version)?.state,
			}));
			return { ...secret, grants, synchronized: grants.some(grant => grant.delivery !== 'runtime') };
		}),
	};
}
