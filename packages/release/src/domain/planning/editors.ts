import { Effect } from 'effect';
import type { ReleasePlan } from '@/automation/types';
import { applyVersionFiles } from '@/discovery/editing/version-files.ts';
import { isLockfile } from '@/domain/catalog.ts';
import type { Edit, Snapshot } from '@/domain/inventory.ts';
import { semver } from '@/domain/semver.ts';
import type { VersionFile } from '@/domain/version-files.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';

export function fileEdits(
	original: Readonly<Record<string, string>>,
	files: Iterable<readonly [string, string]>,
): Effect.Effect<Edit[], DomainError> {
	return Effect.gen(function*() {
		const edits: Edit[] = [];
		for (const [path, after] of files) {
			const before = original[path];
			if (before === undefined) return yield* precondition('Missing planned manifest');
			if (before !== after) edits.push({ path, before, after });
		}
		return edits;
	});
}

export const planVersionFiles = Effect.fn('planVersionFiles')(function*(
	snapshot: Snapshot,
	target: unknown,
	rules: VersionFile[],
): Effect.fn.Return<ReleasePlan, DomainError> {
	const version = (yield* Effect.fromResult(semver(target))).replace(/^v/, '');
	const files = { ...snapshot.files };
	yield* applyVersionFiles(snapshot, files, rules, { release: version });
	const edits = yield* fileEdits(snapshot.files, Object.entries(files));
	const requiresPreparation = edits.length > 0
		&& Object.keys(files).some(isLockfile);
	return planned(snapshot, version, edits, requiresPreparation);
});
function planned(
	snapshot: Snapshot,
	version: string,
	edits: ReleasePlan['edits'],
	requiresPreparation: boolean,
): ReleasePlan {
	return {
		lockfiles: Object.keys(snapshot.files).filter(isLockfile),
		version,
		sourceSha: snapshot.sha,
		packages: [],
		requiresPreparation,
		diagnostics: requiresPreparation
			? ['Preparation workflow must regenerate lockfiles before promotion']
			: edits.length
			? []
			: [alreadyPrepared(version, snapshot.sha)],
		edits,
	};
}
export function alreadyPrepared(version: string, commit: string): string {
	return `Commit ${
		commit.slice(0, 12)
	} already carries ${version}. Preparing creates its promotion without a pull request.`;
}
