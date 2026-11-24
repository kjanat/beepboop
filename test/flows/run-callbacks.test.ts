import { expect, test } from 'bun:test';
import { discoveredWidget } from '@root/test/support/client.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { bearer } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { approvePromotion, only, prepareRelease } from '@root/test/support/releases.ts';
import { passChecks } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import type { RunIdentity } from '@/auth/actions-oidc.ts';

let world: World;
eachWorld(created => {
	world = created;
});

function refusal(call: Promise<unknown>): Promise<string> {
	return call.then(() => 'accepted', (error: unknown) => error instanceof Error ? error.message : String(error));
}

test('run callbacks refuse a managed preparation and a run that is not bound to the release', async () => {
	const session = await world.cliSession();
	const repository = await discoveredWidget(world, session);
	const api = bearer(world, session);
	await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
	await world.wait(20_000);
	const preparation = await only(api, 'prepare');
	const merged = world.github.merge(repository, one(repository.pulls, 'preparation PR').number);
	passChecks(repository, merged.sha);
	await world.push(repository);
	await world.wait(1_000);
	await approvePromotion(api, merged.sha);
	await world.wait(16_000);
	const promotion = await only(api, 'promote');
	const ref = `refs/heads/${repository.defaultBranch}`;
	const stranger: RunIdentity = {
		repositoryId: repository.id,
		repository: repository.name,
		ownerId,
		actorId: botId,
		runId: 9_999,
		attempt: 1,
		sha: merged.sha,
		workflowSha: merged.sha,
		workflowRef: `${repository.name}/.github/workflows/other.yml@${ref}`,
		ref,
		event: 'workflow_dispatch',
	};
	const coordinator = world.coordinator(repository);
	const purl = 'pkg:npm/widget@1.1.0';
	const callbacks = (id: string) => [
		refusal(coordinator.register(id, stranger)),
		refusal(coordinator.prepared(id, stranger, [])),
		refusal(coordinator.report(id, stranger, [], [])),
		refusal(coordinator.refs(id, stranger)),
		refusal(coordinator.publishRelease(id, stranger)),
		refusal(coordinator.publishNext(id, stranger)),
		refusal(coordinator.publishClaim(id, stranger, purl, `sha256:${'0'.repeat(64)}`)),
		refusal(coordinator.publishReport(id, stranger, { executionId: id, purl, outcome: 'published' })),
	];
	expect(await Promise.all(callbacks(preparation.id))).toEqual(Array(8).fill('Operation is not a workflow'));
	expect(await Promise.all(callbacks(promotion.id))).toEqual([
		'Workflow binding mismatch',
		'Preparation run identity mismatch',
		'Report identity mismatch',
		'Ref operation identity mismatch',
		'Release operation identity mismatch',
		'Publication identity mismatch',
		'Publication identity mismatch',
		'Publication identity mismatch',
	]);
	expect(await only(api, 'promote')).toEqual(promotion);
});
