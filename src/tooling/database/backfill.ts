import { Effect } from 'effect';
import type { PlatformProxy } from 'wrangler';
import { getPlatformProxy } from 'wrangler';
import { ProjectionBackfill } from '@/persistence/d1/backfill';
import type { SqlDatabase } from '@/persistence/d1/database';

// Wrangler's remote bindings require Node's undici dispatcher rather than Bun's fetch.
const [configPath, mode, persistence] = process.argv.slice(2);
type Stage = 'proxy' | 'backfill' | 'cleanup';
let stage: Stage = 'proxy';
let failure: Stage | undefined;
let proxy: PlatformProxy<{ DB: SqlDatabase }> | undefined;
let counts: { executions: number; releases: number } | undefined;
try {
	if (!configPath || (mode !== 'local' && mode !== 'remote') || (mode === 'local' && !persistence)) {
		throw new Error('Invalid internal database invocation');
	}
	proxy = await getPlatformProxy<{ DB: SqlDatabase }>({
		configPath,
		envFiles: [],
		remoteBindings: mode === 'remote',
		persist: mode === 'local' && persistence ? { path: persistence } : false,
	});
	stage = 'backfill';
	counts = await Effect.runPromise(new ProjectionBackfill(proxy.env.DB).drain());
} catch {
	failure = stage;
} finally {
	try {
		await proxy?.dispose();
	} catch {
		failure ??= 'cleanup';
	}
}
if (failure || !counts) {
	process.send?.({ failure: failure ?? 'backfill' });
	process.exitCode = 1;
} else process.send?.({ counts });
process.disconnect?.();
