import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createCaptureOutput } from '@kjanat/dreamcli/testkit';
import { Duration, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { Client } from '@/cli/client/api';
import { followInterval, followLimit, followRelease } from '@/cli/render/follow';
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

function follow(executions: unknown[], poll: Duration.Duration) {
	const [out, captured] = createCaptureOutput();
	const exit = spyOn(out, 'setExitCode');
	return Effect.runPromise(
		Effect.scoped(Effect.gen(function*() {
			const client = yield* Client.at('https://beepboop.test', yield* temporaryDirectory('beepboop-follow-'));
			yield* client.save({ token: `cli_${'a'.repeat(64)}` });
			const pauses = spyOn(client, 'pause').mockImplementation(() => TestClock.adjust(poll));
			const requests = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(
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
			return { pauses, requests, captured, exit };
		})).pipe(Effect.provide(TestClock.layer())),
	);
}

const stopped =
	'Stopped following 1.0.1 after 60 minutes. The release goes on in Beepboop. Follow it with beepboop runs list --repository octo/widget.';

test('follow stops polling after 60 minutes while the release has not started', async () => {
	const { pauses, requests, captured, exit } = await follow([], Duration.millis(followInterval));
	expect(Duration.toMinutes(followLimit)).toBe(60);
	expect(pauses).toHaveBeenCalledTimes(720);
	expect(pauses).toHaveBeenCalledWith(5_000);
	expect(requests).toHaveBeenCalledTimes(720);
	expect(captured.stderr.join('')).toContain(stopped);
	expect(captured.activity.at(-1)).toMatchObject({ type: 'spinner:fail' });
	expect(exit).toHaveBeenCalledWith(1);
});

test('time spent on slow polls counts toward the 60 minutes, and the bound fails the open progress bars', async () => {
	const { pauses, captured, exit } = await follow([running], Duration.seconds(10));
	expect(pauses).toHaveBeenCalledTimes(360);
	expect(captured.stderr.join('')).toContain(stopped);
	expect(captured.activity).toContainEqual(expect.objectContaining({ type: 'spinner:succeed' }));
	expect(captured.activity.at(-1)).toMatchObject({ type: 'progress:fail' });
	expect(exit).toHaveBeenCalledWith(1);
});
