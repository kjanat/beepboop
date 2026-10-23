import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Edit, ReleaseReference, Snapshot } from './types.ts';

export interface HookReference {
	repository: string;
	path: string;
	ref: string;
}
function entries(source: string) {
	const doc = parseDocument(source, { uniqueKeys: true });
	if (doc.errors.length) throw new Error('Invalid pre-commit configuration');
	const repos = doc.get('repos', true);
	if (!isSeq(repos)) throw new Error('Expected pre-commit repos sequence');
	return repos.items.flatMap(item => {
		if (!isMap(item)) throw new Error('Invalid pre-commit repository');
		const repo = item.get('repo');
		if (repo === 'local' || repo === 'meta') return [];
		if (typeof repo !== 'string') throw new Error('Expected hook repository URL');
		const match = repo.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
		if (!match) return [];
		const rev = item.get('rev', true);
		if (!isScalar(rev) || typeof rev.value !== 'string' || !rev.range) throw new Error('Expected scalar hook revision');
		return [{ repository: match[1] as string, rev }];
	});
}
export function discoverHooks(snapshot: Snapshot): HookReference[] {
	return Object.entries(snapshot.files).filter(([path]) => /(?:^|\/)\.pre-commit-config\.ya?ml$/.test(path))
		.flatMap(([path, source]) =>
			entries(source).map(entry => ({ path, repository: entry.repository, ref: String(entry.rev.value) }))
		);
}
export function planHookUpdates(snapshot: Snapshot, release: ReleaseReference): Edit[] {
	const edits: Edit[] = [];
	for (const [path, before] of Object.entries(snapshot.files)) {
		if (!/(?:^|\/)\.pre-commit-config\.ya?ml$/.test(path)) continue;
		const updates = entries(before).filter(entry =>
			entry.repository.toLowerCase() === release.repository.name.toLowerCase()
		);
		let after = before;
		for (const { rev } of updates.sort((a, b) => (b.rev.range?.[0] ?? 0) - (a.rev.range?.[0] ?? 0))) {
			const target = /^[a-f0-9]{40}$/.test(String(rev.value)) ? release.commit : release.tag;
			if (!target) throw new Error('Hook update requires an upstream version tag');
			if (!/^[a-f0-9]{40}$/.test(release.commit)) throw new Error('Invalid upstream release commit');
			const range = rev.range as [number, number, number];
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
			entries(after);
			edits.push({ path, before, after });
		}
	}
	return edits;
}
