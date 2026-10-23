import { expect, test } from 'bun:test';
import { compareVersions, semver } from '#model';

test('SemVer precedence includes numeric prereleases and ignores build metadata', () => {
	const values = [
		'0.1.0-alpha',
		'0.1.0-alpha.1',
		'0.1.0-alpha.2',
		'0.1.0-alpha.10',
		'0.1.0-beta',
		'0.1.0-rc.1',
		'0.1.0',
		'0.2.0',
	];
	for (let i = 1; i < values.length; i++) {
		expect(compareVersions(values[i - 1] ?? '', values[i] ?? '')).toBe(-1);
	}
	expect(compareVersions('v0.1.0+build.1', '0.1.0+build.2')).toBe(0);
	for (const value of ['1.0.0-01', '1.0.0-a..b', '01.0.0', '1.0.0-', '1.0.0+']) {
		expect(() => semver(value)).toThrow();
	}
});
