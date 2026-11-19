import { Result, Schema } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { rejectWith } from '@/kernel/errors/refusal.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import type { Contract, Decoded } from '@/kernel/schema/structs.ts';
import { matchesPattern, mutableArray, safeDecode } from '@/kernel/schema/structs.ts';

export type Parsed<A> = Result.Result<A, DomainError>;

export const invalid = rejectWith(precondition);

export const textSchema = Schema.String.check(Schema.isMinLength(1));
export const stringsSchema = mutableArray(Schema.String);
export const countSchema = Schema.Int.check(Schema.isGreaterThan(0));
export const shaSchema = Schema.String.check(matchesPattern(shaPattern));
export const looseSchema = Schema.optional(Schema.Unknown);

export function decode<S extends Contract>(schema: S, value: unknown): Parsed<Decoded<S>> {
	const parsed = safeDecode(schema, value);
	return parsed.success ? Result.succeed(parsed.data) : invalid(parsed.error.message);
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
	const parsed = safeDecode(countSchema, value);
	return parsed.success ? Result.succeed(parsed.data) : invalid('Expected positive integer');
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
export function oneOf<const T extends string>(value: unknown, allowed: readonly T[], message: string): Parsed<T> {
	const match = allowed.find(item => item === value);
	return match === undefined ? invalid(message) : Result.succeed(match);
}
