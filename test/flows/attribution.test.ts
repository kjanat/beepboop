import { expect, test } from 'bun:test';
import { widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { Effect } from 'effect';
import { AutomationService } from '@/automation/service';

const trailer = 'Co-authored-by: kjanat <6353477+kjanat@users.noreply.github.com>';

let world: World;
eachWorld(created => {
	world = created;
});

test('a pull request commit carries the administrator trailer only for work that followed their action', async () => {
	const repository = widget(world.github, { configured: false });
	const { gateway } = new AutomationService(world.env);
	const snapshot = await Effect.runPromise(gateway.snapshot(repository.name, repository.id));
	const edit = { path: 'NOTES.md', before: '', after: 'notes\n' };
	const commit = async (branch: string, coAuthored: boolean) => {
		const { head } = await Effect.runPromise(
			gateway.pullRequest(
				snapshot,
				branch,
				'chore: notes',
				'Notes',
				[edit],
				undefined,
				undefined,
				undefined,
				undefined,
				{
					coAuthored,
				},
			),
		);
		return world.github.resolve(repository, head).message;
	};
	expect(await commit('automation/by-hand', true)).toBe(`chore: notes\n\n${trailer}`);
	expect(await commit('automation/by-schedule', false)).toBe('chore: notes');
});
