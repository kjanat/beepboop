import { expect, test } from 'bun:test';
import { Option } from 'effect';
import { parseWatchedPackage } from '@/domain/catalog.ts';
import { isDistributionPath } from '@/domain/distribution-path.ts';
import { botIdentityOf, botLogin, parseBotIdentity } from '@/github/bot-identity.ts';

test('a watched package names a known registry and a package', () => {
	expect(parseWatchedPackage('jsr:@scope/name')).toEqual({ registry: 'jsr', name: '@scope/name' });
	expect(parseWatchedPackage('npm:a:b')).toEqual({ registry: 'npm', name: 'a:b' });
	for (const source of ['npmx', 'npm:', ':svgo', 'pypi:svgo', '']) expect(parseWatchedPackage(source)).toBeUndefined();
});

test('distribution paths stay outside Git metadata and workflows', () => {
	for (const path of ['dist/cli.js', '.github/action.yml', 'a/.gitignore']) expect(isDistributionPath(path)).toBe(true);
	for (
		const path of [
			'',
			'/etc/passwd',
			'a\\b',
			'a\0b',
			'a//b',
			'./a',
			'a/../b',
			'.Git/config',
			'.github',
			'.GitHub/Workflows',
			'.github/workflows/release.yml',
		]
	) expect(isDistributionPath(path)).toBe(false);
});

test('a bot identity carries the noreply address of its login and ID', () => {
	expect(botLogin('beepboop-app')).toEqual(Option.some('beepboop-app[bot]'));
	expect(botLogin('Beepboop')).toEqual(Option.none());
	const identity = botIdentityOf('beepboop-app[bot]', 42);
	expect(identity.email).toBe('42+beepboop-app[bot]@users.noreply.github.com');
	expect(parseBotIdentity(identity)).toEqual(Option.some(identity));
	for (
		const claimed of [
			{ ...identity, email: '43+beepboop-app[bot]@users.noreply.github.com' },
			{ ...identity, login: 'beepboop-app' },
			{ ...identity, id: 0 },
			{ ...identity, id: 1.5 },
			undefined,
		]
	) expect(parseBotIdentity(claimed)).toEqual(Option.none());
});
