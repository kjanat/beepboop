import { expect, test } from 'bun:test';
import { Schema } from 'effect';
import { decodeSync, encodeSync, mapped, mutableStruct } from '@/schema';

test('mapped requires present-value schemas on both sides', () => {
	const identity = (value: string | undefined) => value;
	// @ts-expect-error Apply optional to the completed mapping, not its input.
	mapped(Schema.optional(Schema.String), Schema.UndefinedOr(Schema.String), identity, identity);
	// @ts-expect-error Exact optional keys also carry field-level presence semantics.
	mapped(Schema.optionalKey(Schema.String), Schema.String, value => value, value => value);
	// @ts-expect-error Apply optional to the completed mapping, not its output.
	mapped(Schema.UndefinedOr(Schema.String), Schema.optional(Schema.String), identity, identity);
	// @ts-expect-error Exact optional output keys must wrap the completed mapping.
	mapped(Schema.String, Schema.optionalKey(Schema.String), value => value, value => value);
});

test('optional mapped fields preserve absence and normalize present values in both directions', () => {
	const schema = mutableStruct({
		value: Schema.optional(mapped(
			Schema.NullOr(Schema.String),
			Schema.UndefinedOr(Schema.String),
			value => value ?? undefined,
			value => value ?? null,
		)),
	});
	const absent: typeof schema.Type = {};
	const encodedAbsent: typeof schema.Encoded = {};
	expect(decodeSync(schema, encodedAbsent)).toEqual(absent);
	expect(encodeSync(schema, absent)).toEqual(encodedAbsent);
	expect(decodeSync(schema, { value: null })).toEqual({ value: undefined });
	expect(decodeSync(schema, { value: undefined })).toEqual({ value: undefined });
	expect(decodeSync(schema, { value: 'handle' })).toEqual({ value: 'handle' });
	expect(encodeSync(schema, { value: 'handle' })).toEqual({ value: 'handle' });
	expect(decodeSync(schema, encodeSync(schema, { value: undefined }))).toEqual({ value: undefined });
	expect(() => decodeSync(schema, { value: 42 })).toThrow();
});
