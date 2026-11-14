import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { discover, planRelease } from '@/automation/managers';
import type { Snapshot } from '@/automation/types';

const root = [
	'{',
	'\t"name": "app",',
	'\t"version": "1.2.3",',
	'\t"keywords": ["x509", "pem"],',
	'\t"dependencies": { "lib": "^1.2.3" },',
	'\t"files": ["dist", "CHANGELOG.md"]',
	'}',
	'',
].join('\n');
const lib = '{\n  "name": "lib",\n  "version": "1.2.3",\n  "files": ["dist"]\n}\n';
const site = '{\n  "name": "site",\n  "private": true,\n  "devDependencies": { "lib": "~1.2.3" }\n}\n';

function snapshot(): Snapshot {
	const files = { 'package.json': root, 'packages/lib/package.json': lib, 'site/package.json': site };
	return {
		repository: { id: 1, name: 'example/app', defaultBranch: 'main' },
		sha: 'a'.repeat(40),
		files,
		paths: Object.keys(files),
	};
}

test('npm version and dependency edits change only the edited values', async () => {
	const source = snapshot();
	const planned = await Effect.runPromise(planRelease(source, discover(source, ['npm']), { version: '1.3.0' }));
	const after = new Map(planned.edits.map(edit => [edit.path, edit.after]));
	expect(after.get('package.json')).toBe(
		root.replace('"version": "1.2.3"', '"version": "1.3.0"').replace('"lib": "^1.2.3"', '"lib": "^1.3.0"'),
	);
	expect(after.get('packages/lib/package.json')).toBe(lib.replace('"version": "1.2.3"', '"version": "1.3.0"'));
	expect(after.get('site/package.json')).toBe(site.replace('"lib": "~1.2.3"', '"lib": "~1.3.0"'));
});
