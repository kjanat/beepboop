import { Result } from 'effect';
import { object } from '@/automation/managers/helpers';
import type { Snapshot } from '@/automation/types';
import type { Diagnostic } from '@/contract/diagnostics';
import { fileProblem } from '@/contract/diagnostics';

export function* packageManifests(
	snapshot: Snapshot,
	diagnostics: Diagnostic[],
): Generator<{ path: string; manifest: Record<string, unknown> }> {
	for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
		if (path !== 'package.json' && !path.endsWith('/package.json')) continue;
		const parsed = Result.try(() => object(JSON.parse(source)));
		if (Result.isFailure(parsed)) {
			diagnostics.push(fileProblem(path, 'invalid-manifest', `cannot safely discover configuration`));
			continue;
		}
		yield { path, manifest: parsed.success };
	}
}
