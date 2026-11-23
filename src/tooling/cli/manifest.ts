import { Effect, Schema } from 'effect';
import type { ParseError } from 'jsonc-parser';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { jsonIndent } from '@/discovery/managers/manifest-editing.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { mutableStruct } from '@/kernel/schema/structs.ts';
import type { ToolFailure } from '@/tooling/runtime';
import { parse, refuse } from '@/tooling/runtime';

export const packageManifest = mutableStruct({ name: Schema.String, version: Schema.String });

export const generatedJsr = Effect.fnUntraced(
	function*(npm: Decoded<typeof packageManifest>, jsrSource: string): Effect.fn.Return<string, ToolFailure> {
		const errors: ParseError[] = [];
		const parsed: unknown = parseJsonc(jsrSource, errors, { allowTrailingComma: true });
		if (errors.length) return yield* refuse('jsr.json is not valid JSON');
		const jsr = yield* parse(mutableStruct({ name: Schema.String }), parsed);
		if (npm.name !== jsr.name) return yield* refuse('npm and JSR must share a name');
		const indent = jsonIndent(jsrSource);
		return applyEdits(
			jsrSource,
			modify(jsrSource, ['version'], npm.version, {
				formattingOptions: { insertSpaces: !indent.startsWith('\t'), tabSize: indent.length },
			}),
		);
	},
);

const workspaceSpecifier = /^(?:@\/|@beepboop(?:bot)?\/)/;
const transpiler = new Bun.Transpiler({ loader: 'js' });

export function leakedSpecifiers(bundle: string): string[] {
	return [
		...new Set(
			transpiler.scanImports(bundle.replace(/^#![^\n]*/, '')).map(({ path }) => path).filter(path =>
				workspaceSpecifier.test(path)
			),
		),
	];
}
