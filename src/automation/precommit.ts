import { Effect, Result } from 'effect';
import type { Scalar } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Edit, ReleaseReference, Snapshot } from '@/automation/types';
import { hookConfig } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';

export interface HookReference {
	repository: string;
	path: string;
	ref: string;
}
interface Entry {
	repository: string;
	rev: Scalar;
	range: [number, number, number];
}
function entries(source: string): Result.Result<Entry[], DomainError> {
	return Result.gen(function*() {
		const doc = parseDocument(source, { uniqueKeys: true });
		if (doc.errors.length) return yield* Result.fail(precondition('Invalid pre-commit configuration'));
		const repos = doc.get('repos', true);
		if (!isSeq(repos)) return yield* Result.fail(precondition('Expected pre-commit repos sequence'));
		const found: Entry[] = [];
		for (const item of repos.items) {
			if (!isMap(item)) return yield* Result.fail(precondition('Invalid pre-commit repository'));
			const repo = item.get('repo');
			if (repo === 'local' || repo === 'meta') continue;
			if (typeof repo !== 'string') return yield* Result.fail(precondition('Expected hook repository URL'));
			const repository = repo.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1];
			if (!repository) continue;
			const rev = item.get('rev', true);
			if (!isScalar(rev) || typeof rev.value !== 'string' || !rev.range) {
				return yield* Result.fail(precondition('Expected scalar hook revision'));
			}
			found.push({ repository, rev, range: rev.range });
		}
		return found;
	});
}
export function discoverHooks(snapshot: Snapshot): Result.Result<HookReference[], DomainError> {
	return Result.gen(function*() {
		const references: HookReference[] = [];
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!hookConfig.test(path)) continue;
			for (const entry of yield* entries(source)) {
				references.push({ path, repository: entry.repository, ref: String(entry.rev.value) });
			}
		}
		return references;
	});
}
export function planHookUpdates(snapshot: Snapshot, release: ReleaseReference): Effect.Effect<Edit[], DomainError> {
	return Effect.gen(function*() {
		const edits: Edit[] = [];
		for (const [path, before] of Object.entries(snapshot.files)) {
			if (!hookConfig.test(path)) continue;
			const updates = (yield* Effect.fromResult(entries(before))).filter(entry =>
				entry.repository.toLowerCase() === release.repository.name.toLowerCase()
			);
			let after = before;
			for (const { rev, range } of updates.sort((a, b) => b.range[0] - a.range[0])) {
				const target = /^[a-f0-9]{40}$/.test(String(rev.value)) ? release.commit : release.tag;
				if (!target) return yield* precondition('Hook update requires an upstream version tag');
				if (!/^[a-f0-9]{40}$/.test(release.commit)) return yield* precondition('Invalid upstream release commit');
				const original = before.slice(range[0], range[1]);
				const replacement = original.startsWith("'")
					? `'${target.replaceAll("'", "''")}'`
					: original.startsWith('"')
					? JSON.stringify(target)
					: /^[A-Za-z0-9_./-]+$/.test(target)
					? target
					: JSON.stringify(target);
				after = after.slice(0, range[0]) + replacement + after.slice(range[1]);
			}
			if (after !== before) {
				yield* Effect.fromResult(entries(after));
				edits.push({ path, before, after });
			}
		}
		return edits;
	});
}
