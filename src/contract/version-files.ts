import { Effect, Result, Schema } from 'effect';
import { unsafeRelativePath } from '@/relative-path';
import type { Decoded } from '@/schema';
import { matchesPattern, mutableArray, refined, strictStruct } from '@/schema';

export function safeVersionPath(path: string): boolean {
	return !path.includes('\\') && !unsafeRelativePath(path, ['', '.', '..', '.git']);
}
export function textVersionPattern(pattern: string) {
	return Result.try({
		try: () => new RegExp(pattern, 'dgmu'),
		catch: error => {
			if (error instanceof SyntaxError) return error;
			throw error;
		},
	});
}
const common = {
	path: refined(Schema.String, safeVersionPath, 'Expected a repository-relative path'),
	group: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	template: Schema.String.check(Schema.isMaxLength(1000)).pipe(Schema.withDecodingDefault(Effect.succeed('{version}'))),
};
export const versionFileSchema = Schema.Union([
	strictStruct({
		...common,
		format: Schema.Literal('json'),
		key: mutableArray(
			Schema.Union([
				Schema.String.check(Schema.isMinLength(1)),
				Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
			]),
		).check(Schema.isMinLength(1)),
	}),
	strictStruct({
		...common,
		format: Schema.Literal('yaml'),
		key: mutableArray(
			Schema.Union([
				Schema.String.check(Schema.isMinLength(1)),
				Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
			]),
		).check(Schema.isMinLength(1)),
	}),
	strictStruct({
		...common,
		format: Schema.Literal('toml'),
		key: mutableArray(Schema.String.check(matchesPattern(/^[A-Za-z0-9_-]+$/))).check(Schema.isMinLength(1)),
	}),
	strictStruct({
		...common,
		format: Schema.Literal('text'),
		prefix: Schema.String.check(Schema.isMinLength(1)),
		suffix: Schema.String.check(Schema.isMinLength(1)),
	}),
	strictStruct({
		...common,
		format: Schema.Literal('text'),
		pattern: refined(
			Schema.String.check(Schema.isMinLength(1)),
			pattern => Result.isSuccess(textVersionPattern(pattern)),
			'Expected a valid Unicode regular expression',
		),
	}),
]);
export type VersionFile = Decoded<typeof versionFileSchema>;
