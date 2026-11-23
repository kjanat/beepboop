import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createCaptureOutput } from '@kjanat/dreamcli/testkit';
import { Effect } from 'effect';
import { Client } from '@/cli/client/api';
import { followInterval, followPolls, followRelease } from '@/cli/render/follow';
import { temporaryDirectory } from '@/tooling/runtime';

afterEach(() => mock.restore());

const running = {
	id: 'promote-1',
	repositoryId: 1,
	repository: 'octo/widget',
	stream: 'main',
	operation: 'promote',
	state: 'running',
	version: '1.0.1',
	sourceSha: 'a'.repeat(40),
	approvedBy: 'start',
	updatedAt: 1,
	publications: [{ id: 'pkg:npm/widget', name: 'widget', manager: 'npm', version: '1.0.1', outcome: 'pending' }],
};

function follow(executions: unknown[]) {
	const [out, captured] = createCaptureOutput();
	const exit = spyOn(out, 'setExitCode');
	return Effect.runPromise(Effect.scoped(Effect.gen(function*() {
		const client = yield* Client.at('https://beepboop.test', yield* temporaryDirectory('beepboop-follow-'));
		yield* client.save({ token: `cli_${'a'.repeat(64)}` });
		const pauses = spyOn(client, 'pause').mockReturnValue(Effect.void);
		const lists = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(
			(input: string | URL | Request) =>
				Promise.resolve(
					Response.json(String(input).endsWith('/api/executions/binaries') ? { legs: [], assets: [] } : executions),
				),
			{ preconnect: fetch.preconnect },
		));
		yield* followRelease(client, out, {
			repository: 'octo/widget',
			repositoryId: 1,
			defaultBranch: 'main',
			stream: 'main',
			version: '1.0.1',
			execution: { id: 'prepare-1' },
			bumped: false,
		});
		return { pauses, lists, captured, exit };
	})));
}

const stopped =
	'Stopped following 1.0.1 after 60 minutes. The release goes on in Beepboop. Follow it with beepboop runs list --repository octo/widget.';

test('follow stops polling at its bound while the release has not started', async () => {
	const { pauses, lists, captured, exit } = await follow([]);
	expect(followPolls * followInterval).toBe(60 * 60_000);
	expect(pauses).toHaveBeenCalledTimes(followPolls);
	expect(lists).toHaveBeenCalledTimes(followPolls);
	expect(captured.stderr.join('')).toContain(stopped);
	expect(captured.activity.at(-1)).toMatchObject({ type: 'spinner:fail' });
	expect(exit).toHaveBeenCalledWith(1);
});

test('follow stops polling at its bound while the release runs, and fails its open progress bars', async () => {
	const { pauses, captured, exit } = await follow([running]);
	expect(pauses).toHaveBeenCalledTimes(followPolls);
	expect(captured.stderr.join('')).toContain(stopped);
	expect(captured.activity).toContainEqual(expect.objectContaining({ type: 'spinner:succeed' }));
	expect(captured.activity.at(-1)).toMatchObject({ type: 'progress:fail' });
	expect(exit).toHaveBeenCalledWith(1);
});
