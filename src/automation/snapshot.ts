import { Effect } from 'effect';
import { safeVersionPath } from '@/automation/editors';
import { pkgbuildFile } from '@/automation/managers/channels';
import { tagQueries } from '@/automation/managers/tags';
import type { Snapshot } from '@/automation/types';
import { isLockfile, managerNames, managerSpec } from '@/contract/catalog';
import { type DomainError, precondition } from '@/contract/errors';

export interface TreeEntry {
	path: string;
	type: string;
	mode: string;
}
export interface SnapshotSource {
	repository: Snapshot['repository'];
	sha: string;
	entries: readonly TreeEntry[];
	read(path: string): Effect.Effect<string | null, DomainError>;
	tags(prefixes: readonly string[]): Effect.Effect<string[], DomainError>;
}

const excluded = /(?:^|\/)(?:node_modules|vendor|target|testdata|fixtures|\.git)\//;
const contents: readonly RegExp[] = [
	/^\.github\/beepboop\.json$/,
	/^actions\/(?:begin|prepare|report)\/action\.ya?ml$/,
	pkgbuildFile,
	...managerNames.flatMap(name => managerSpec(name).manifests),
];
const markers: readonly RegExp[] = managerNames.flatMap(name => managerSpec(name).markers);

function marker(path: string): boolean {
	return isLockfile(path) || markers.some(pattern => pattern.test(path));
}
function content(path: string): boolean {
	return contents.some(pattern => pattern.test(path));
}

export function buildSnapshot(
	source: SnapshotSource,
	extraPaths: readonly string[] = [],
): Effect.Effect<Snapshot, DomainError> {
	return Effect.gen(function*() {
		if (extraPaths.some(path => !safeVersionPath(path))) return yield* precondition('Unsafe version file path');
		const blobs = source.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000').map(entry =>
			entry.path
		);
		if (extraPaths.some(path => !blobs.includes(path))) {
			return yield* precondition('Version file missing or not a regular file');
		}
		const included = blobs.filter(path => !excluded.test(path) && (marker(path) || content(path)));
		const blank = new Set(included.filter(path => marker(path) && !extraPaths.includes(path)));
		const fetched = [...new Set([...extraPaths, ...included.filter(path => !blank.has(path))])];
		if (fetched.length > 400) return yield* precondition('Discovery file limit exceeded');
		const read = new Map<string, string>();
		yield* Effect.forEach(fetched, path =>
			source.read(path).pipe(Effect.tap(text =>
				Effect.sync(() => {
					if (text !== null) read.set(path, text);
				})
			)), { concurrency: 8, discard: true });
		const files: Record<string, string> = {};
		for (const path of blobs) {
			const text = blank.has(path) ? '' : read.get(path);
			if (text !== undefined) files[path] = text;
		}
		const prefixes = tagQueries([...new Set([...extraPaths, ...included])]);
		const tags = prefixes.length ? [...new Set(yield* source.tags(prefixes))].sort() : undefined;
		return { repository: source.repository, sha: source.sha, files, paths: blobs, ...(tags ? { tags } : {}) };
	});
}
