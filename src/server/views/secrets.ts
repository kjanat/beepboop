import type { ViewOf } from '@/server/loaders.ts';
import { workflowChoices } from '@/server/views/workflows.ts';

export function secretsPage(data: ViewOf<'secrets'>) {
	const configured = data.repositories.flatMap(repository => {
		const workflows = workflowChoices(repository);
		return workflows.length ? [{ id: repository.id, name: repository.name, workflows }] : [];
	});
	const grantsByAlias = new Map<string, typeof data.grants>();
	for (const grant of data.grants) {
		const group = grantsByAlias.get(grant.alias);
		if (group) group.push(grant);
		else grantsByAlias.set(grant.alias, [grant]);
	}
	const copies = new Map<string, (typeof data.deliveries)[number]['state']>();
	for (const delivery of data.deliveries) {
		const key = JSON.stringify([delivery.grant_id, delivery.version]);
		if (!copies.has(key)) copies.set(key, delivery.state);
	}
	return {
		configured,
		versions: JSON.stringify(Object.fromEntries(data.secrets.map(secret => [secret.alias, secret.version]))),
		secrets: data.secrets.map(secret => {
			const grants = (grantsByAlias.get(secret.alias) ?? []).map(grant => ({
				...grant,
				copy: copies.get(JSON.stringify([grant.id, secret.version])),
			}));
			return { ...secret, grants, synchronized: grants.some(grant => grant.delivery !== 'runtime') };
		}),
	};
}
