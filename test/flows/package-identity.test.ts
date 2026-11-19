import { expect, test } from 'bun:test';
import { matchesPackage, packageId, packageKey, packagePurl } from '@/automation/package-identity';

const leftPad = { manager: 'npm', name: 'left-pad', version: '1.3.0' } as const;
const scoped = {
	manager: 'npm',
	name: '@octo/lint',
	version: '2.0.0',
	identity: { type: 'npm', namespace: '@octo', name: 'lint', version: '2.0.0' },
} as const;

const matches: [string, typeof leftPad | typeof scoped, boolean][] = [
	['pkg:npm/left-pad@1.3.0', leftPad, true],
	['pkg:npm/left-pad@1.2.0', leftPad, false],
	['pkg:npm/left-pad', leftPad, true],
	['pkg:npm/left-pad', scoped, false],
	['pkg:npm/%40octo/lint', scoped, true],
	['pkg:npm/%40octo/lint@2.0.0', scoped, true],
	['pkg:npm/%40octo/lint@2.0.0', leftPad, false],
	['npm:left-pad', leftPad, true],
	['npm:left-pad', scoped, false],
];

test('package matching answers the same on every lookup', () => {
	const answers = () => matches.map(([reference, pkg]) => matchesPackage(reference, pkg));
	const expected = matches.map(([, , match]) => match);
	expect(answers()).toEqual(expected);
	expect(answers()).toEqual(expected);
	expect([packageId(leftPad), packagePurl(leftPad), packageId(scoped), packagePurl(scoped)]).toEqual([
		'pkg:npm/left-pad',
		'pkg:npm/left-pad@1.3.0',
		'pkg:npm/%40octo/lint',
		'pkg:npm/%40octo/lint@2.0.0',
	]);
});

test('package keys stay correct after the canonical cache fills', () => {
	expect(packageKey('pkg:npm/left-pad@1.3.0')).toBe('pkg:npm/left-pad');
	for (let index = 0; index <= 4096; index++) packageKey(`pkg:generic/filler-${index}`);
	expect(packageKey('pkg:npm/left-pad@1.3.0')).toBe('pkg:npm/left-pad');
	expect(packageKey({ type: 'npm', name: 'left-pad', version: '1.3.0' })).toBe('pkg:npm/left-pad');
	expect(matchesPackage('pkg:npm/left-pad@1.3.0', leftPad)).toBe(true);
});

test('an invalid package reference fails on every lookup', () => {
	expect(() => matchesPackage('pkg:npm/', leftPad)).toThrow();
	expect(() => matchesPackage('pkg:npm/', leftPad)).toThrow();
});
