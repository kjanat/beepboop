import { expect, test } from 'bun:test';
import { nextVersion, parseVersionRequest } from '#automation/version';

test('version requests calculate stable and prerelease transitions', () => {
	for (
		const [current, request, expected] of [
			['1.4.2', { bump: 'patch' }, '1.4.3'],
			['0.4.2', { bump: 'minor' }, '0.5.0'],
			['1.4.2', { bump: 'major' }, '2.0.0'],
			['1.4.2', { bump: 'prerelease', base: 'minor', identifier: 'alpha' }, '1.5.0-alpha.1'],
			['1.5.0-alpha.1', { bump: 'next' }, '1.5.0-alpha.2'],
			['1.5.0-alpha.2', { bump: 'stable' }, '1.5.0'],
		] as const
	) expect(nextVersion(current, parseVersionRequest(request))).toBe(expected);
});
test('version requests reject ambiguity and downgrades', () => {
	expect(() => parseVersionRequest({ version: '1.2.3', bump: 'patch' })).toThrow();
	expect(() => nextVersion('1.2.3', { version: '1.2.3' })).toThrow();
	expect(() => nextVersion('1.2.3', { version: '1.1.0' })).toThrow();
	expect(() => nextVersion('1.2.3-alpha.1', { bump: 'patch' })).toThrow();
	expect(() => nextVersion('1.2.3', { bump: 'next' })).toThrow();
});
