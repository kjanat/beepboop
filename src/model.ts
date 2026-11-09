import { Result } from 'effect';
import { z } from 'zod';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { shaPattern } from '@/contract/ids';
import { compare, semverPattern } from '@/contract/semver';

export type Parsed<A> = Result.Result<A, DomainError>;

function invalid(message: string): Parsed<never> {
	return Result.fail(precondition(message));
}

export const textSchema = z.string().min(1);
export const countSchema = z.int().positive();
export const shaSchema = z.string().regex(shaPattern);
export const looseSchema = z.unknown().optional();

export function decode<S extends z.ZodType>(schema: S, value: unknown): Parsed<z.output<S>> {
	const parsed = schema.safeParse(value);
	return parsed.success ? Result.succeed(parsed.data) : invalid(z.prettifyError(parsed.error));
}

export function record(value: unknown): Parsed<Record<string, unknown>> {
	return typeof value !== 'object' || value === null || Array.isArray(value)
		? invalid('Expected object')
		: Result.succeed(Object.fromEntries(Object.entries(value)));
}
export function string(value: unknown): Parsed<string> {
	return typeof value === 'string' ? Result.succeed(value) : invalid('Expected string');
}
export function text(value: unknown): Parsed<string> {
	return typeof value === 'string' && value.length > 0 ? Result.succeed(value) : invalid('Expected nonempty string');
}
export function integer(value: unknown): Parsed<number> {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
		? Result.succeed(value)
		: invalid('Expected positive integer');
}
export function array(value: unknown): Parsed<unknown[]> {
	return Array.isArray(value) ? Result.succeed(value) : invalid('Expected array');
}
export function boolean(value: unknown): Parsed<boolean> {
	return typeof value === 'boolean' ? Result.succeed(value) : invalid('Expected boolean');
}
export function strings(value: unknown): Parsed<string[]> {
	return array(value).pipe(Result.flatMap(items => Result.all(items.map(text))));
}
export function matches(value: unknown, pattern: RegExp): Parsed<string> {
	return text(value).pipe(
		Result.flatMap(result => pattern.test(result) ? Result.succeed(result) : invalid('Invalid value format')),
	);
}
export function sha(value: unknown): Parsed<string> {
	return matches(value, shaPattern);
}
export function semver(value: unknown): Parsed<string> {
	return matches(value, semverPattern);
}
/** Versions that are not semver order before every valid version. */
export function compareVersions(left: string, right: string): number {
	const a = semverPattern.test(left), b = semverPattern.test(right);
	if (!a || !b) return a === b ? 0 : a ? 1 : -1;
	return compare(left.replace(/^v/, ''), right.replace(/^v/, ''));
}
export function oneOf<const T extends string>(value: unknown, allowed: readonly T[], message: string): Parsed<T> {
	const match = allowed.find(item => item === value);
	return match === undefined ? invalid(message) : Result.succeed(match);
}
