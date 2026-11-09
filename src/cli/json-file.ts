import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { failure } from '@/cli/output';

export function readJson(path: string): Effect.Effect<unknown, CLIError> {
	return Effect.tryPromise({
		try: (): Promise<unknown> => Bun.file(path).json(),
		catch: () => failure(`${path} is not readable JSON`, 'INVALID_FILE'),
	});
}
