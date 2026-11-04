import { shaPattern } from '@/contract/ids';
import { compare, semVer, semverPattern } from '@/contract/version';

export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Expected object');
	}
	return Object.fromEntries(Object.entries(value));
}
export function string(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Expected string');
	return value;
}
export function text(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error('Expected nonempty string');
	return value;
}
export function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new Error('Expected positive integer');
	}
	return value;
}
export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Expected array');
	return value;
}
export function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Expected boolean');
	return value;
}
export function matches(value: unknown, pattern: RegExp): string {
	const result = text(value);
	if (!pattern.test(result)) throw new Error('Invalid value format');
	return result;
}
export function sha(value: unknown): string {
	return matches(value, shaPattern);
}
export function semver(value: unknown): string {
	return matches(value, semverPattern);
}
export function compareVersions(left: string, right: string): number {
	return compare(semVer.parse(left), semVer.parse(right));
}
export function oneOf<const T extends string>(value: unknown, allowed: readonly T[], message: string): T {
	const match = allowed.find(item => item === value);
	if (match === undefined) throw new Error(message);
	return match;
}
