import { expect, test } from 'bun:test';
import { jsrChangedFiles, jsrFilePaths, npmBuild } from '@/publication/registries/release-check.ts';

test('a published npm version matches the build only with the same integrity', () => {
	expect(npmBuild({ dist: { integrity: 'sha512-a' } }, 'sha512-a')).toEqual({ kind: 'matches', integrity: 'sha512-a' });
	expect(npmBuild({ dist: { integrity: 'sha512-b' } }, 'sha512-a')).toEqual({ kind: 'differs', published: 'sha512-b' });
	expect(npmBuild({ dist: null }, 'sha512-a')).toEqual({ kind: 'unreadable' });
	expect(npmBuild({ dist: { integrity: 7 } }, 'sha512-a')).toEqual({ kind: 'unreadable' });
	expect(npmBuild({}, 'sha512-a')).toEqual({ kind: 'unreadable' });
});

test('a published JSR version is compared over its files and the files this build includes', () => {
	const remote: Record<string, { checksum: string }> = {
		'/mod.ts': { checksum: 'sha256-mod' },
		'/README.md': { checksum: 'sha256-readme' },
		'/old.ts': { checksum: 'sha256-old' },
	};
	const paths = jsrFilePaths(remote, ['mod.ts', 'cli.ts']);
	expect(paths).toEqual(['/README.md', '/cli.ts', '/mod.ts', '/old.ts']);
	const local = new Map<string, string | undefined>([
		['/README.md', 'sha256-readme'],
		['/cli.ts', 'sha256-cli'],
		['/mod.ts', 'sha256-changed'],
		['/old.ts', undefined],
	]);
	expect(jsrChangedFiles(remote, local)).toEqual(['/cli.ts', '/mod.ts', '/old.ts']);
	expect(jsrChangedFiles(remote, new Map(paths.map(path => [path, remote[path]?.checksum])))).toEqual([]);
});
