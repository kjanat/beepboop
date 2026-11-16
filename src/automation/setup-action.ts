import { Result } from 'effect';
import { object, yaml } from '@/automation/managers/helpers';
import type { SetupPlan } from '@/automation/setup-types';
import type { Snapshot } from '@/automation/types';

/** Entry points are a starting list; owners add chunks, licenses and runtime assets. */
export function actionReleaseOffer(snapshot: Snapshot): SetupPlan['actionRelease'] {
	const manifests = snapshot.paths.filter(path => /(?:^|\/)action\.ya?ml$/.test(path)).sort();
	if (!manifests.length) return undefined;
	const files = new Set<string>();
	for (const path of manifests) {
		const parsed = yaml(snapshot.files[path] ?? '');
		if (Result.isFailure(parsed)) continue;
		const runs = object(parsed.success.runs);
		if (typeof runs.using !== 'string' || !/^node\d+$/.test(runs.using)) continue;
		const directory = path.slice(0, path.lastIndexOf('/') + 1);
		for (const key of ['main', 'pre', 'post']) {
			const entry = runs[key];
			if (typeof entry !== 'string' || !/^[\w./-]+$/.test(entry) || entry.startsWith('/')) continue;
			const parts = directory.split('/').filter(Boolean);
			let escaped = false;
			for (const part of entry.split('/')) {
				if (part === '.') continue;
				if (part === '..') { if (!parts.pop()) escaped = true; }
				else if (!part || part === '.git') escaped = true;
				else parts.push(part);
			}
			if (!escaped && parts.length) files.add(parts.join('/'));
		}
	}
	let commands = '';
	try {
		const manifest = object(JSON.parse(snapshot.files['package.json'] ?? '{}'));
		if (typeof object(manifest.scripts).build === 'string') {
			const manager = String(manifest.packageManager ?? '').split('@')[0];
			if (manager === 'bun') commands = 'bun install --frozen-lockfile\nbun run build';
			else if (manager === 'pnpm') commands = 'pnpm install --frozen-lockfile\npnpm run build';
			else if (manager === 'yarn') {
				commands = /^yarn@1(?:\.|$)/.test(String(manifest.packageManager))
					? 'yarn install --frozen-lockfile\nyarn build'
					: 'yarn install --immutable\nyarn build';
			} else if (manager === 'npm' || snapshot.paths.includes('package-lock.json')) commands = 'npm ci\nnpm run build';
		}
	} catch { /* Invalid package metadata is reported by discovery. */ }
	const entries = [...files].sort();
	return { manifests, files: entries, missing: entries.filter(path => !snapshot.paths.includes(path)), commands };
}
