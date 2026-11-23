import { Result } from 'effect';
import { object } from '@/automation/managers/helpers';
import type { Snapshot } from '@/domain/inventory.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';

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
