import { Effect } from 'effect';

export function terminate(
	child: Pick<Bun.Subprocess, 'exitCode' | 'signalCode' | 'kill' | 'exited'>,
): Effect.Effect<void> {
	return Effect.promise(async () => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		child.kill('SIGTERM');
		const escalation = setTimeout(() => child.kill('SIGKILL'), 1000);
		try {
			await child.exited;
		} finally {
			clearTimeout(escalation);
		}
	});
}
