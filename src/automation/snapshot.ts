import { safeVersionPath } from '@/automation/editors';
import { pkgbuildFile } from '@/automation/managers/channels';
import { tagQueries } from '@/automation/managers/tags';
import type { Snapshot } from '@/automation/types';
import { isLockfile, managerNames, managerSpec } from '@/contract/catalog';

export interface TreeEntry {
	path: string;
	type: string;
	mode: string;
}
export interface SnapshotSource {
	repository: Snapshot['repository'];
	sha: string;
	entries: readonly TreeEntry[];
	read(path: string): Promise<string | null>;
	tags(prefixes: readonly string[]): Promise<string[]>;
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

export async function buildSnapshot(source: SnapshotSource, extraPaths: readonly string[] = []): Promise<Snapshot> {
	if (extraPaths.some(path => !safeVersionPath(path))) throw new Error('Unsafe version file path');
	const blobs = source.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000').map(entry =>
		entry.path
	);
	if (extraPaths.some(path => !blobs.includes(path))) throw new Error('Version file missing or not a regular file');
	const included = blobs.filter(path => !excluded.test(path) && (marker(path) || content(path)));
	const blank = new Set(included.filter(path => marker(path) && !extraPaths.includes(path)));
	const fetched = [...new Set([...extraPaths, ...included.filter(path => !blank.has(path))])];
	if (fetched.length > 400) throw new Error('Discovery file limit exceeded');
	const read = new Map<string, string>();
	for (let offset = 0; offset < fetched.length; offset += 8) {
		await Promise.all(
			fetched.slice(offset, offset + 8).map(async path => {
				const text = await source.read(path);
				if (text !== null) read.set(path, text);
			}),
		);
	}
	const files: Record<string, string> = {};
	for (const path of blobs) {
		const text = blank.has(path) ? '' : read.get(path);
		if (text !== undefined) files[path] = text;
	}
	const prefixes = tagQueries([...new Set([...extraPaths, ...included])]);
	const tags = prefixes.length ? [...new Set(await source.tags(prefixes))].sort() : undefined;
	return { repository: source.repository, sha: source.sha, files, paths: blobs, ...(tags ? { tags } : {}) };
}
