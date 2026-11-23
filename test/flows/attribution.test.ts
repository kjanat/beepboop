import { expect, test } from 'bun:test';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { pullRequest } from '@/automation/preparation-pull-requests';
import { withAutomation } from '@/automation/service';
import { repositorySnapshot } from '@/automation/snapshot';

const trailer = 'Co-authored-by: kjanat <6353477+kjanat@users.noreply.github.com>';

let world: World;
eachWorld(created => {
	world = created;
});

test('a pull request commit carries the administrator trailer only for work that followed their action', async () => {
	const repository = widget(world.github, { configured: false });
	const gateway = await world.run(withAutomation(service => Effect.succeed(service.gateway)));
	const snapshot = await Effect.runPromise(repositorySnapshot(gateway, repository.name, repository.id));
	const edit = { path: 'NOTES.md', before: '', after: 'notes\n' };
	const commit = async (branch: string, coAuthored: boolean) => {
		const { head } = await Effect.runPromise(
			pullRequest(gateway, { snapshot, branch, title: 'chore: notes', body: 'Notes', edits: [edit], coAuthored }),
		);
		return world.github.resolve(repository, head).message;
	};
	expect(await commit('automation/by-hand', true)).toBe(`chore: notes\n\n${trailer}`);
	expect(await commit('automation/by-schedule', false)).toBe('chore: notes');
});
