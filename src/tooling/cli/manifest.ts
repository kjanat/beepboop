import { Effect, Schema } from 'effect';
import type { ParseError } from 'jsonc-parser';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { parseSync } from 'rolldown/utils';
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
const requireNames = new Set(['require', '__require']);
const transpiler = new Bun.Transpiler({ loader: 'js' });

function isNode(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isRequireCallee(callee: unknown): boolean {
	if (!isNode(callee)) return false;
	if (callee.type === 'Identifier') return typeof callee.name === 'string' && requireNames.has(callee.name);
	if (callee.type !== 'MemberExpression' || !isNode(callee.object) || !isNode(callee.property)) return false;
	return callee.object.type === 'Identifier' && typeof callee.object.name === 'string'
		&& requireNames.has(callee.object.name) && callee.property.type === 'Identifier'
		&& callee.property.name === 'resolve';
}

function staticString(node: unknown): string | undefined {
	if (!isNode(node)) return undefined;
	if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
	if (node.type !== 'TemplateLiteral' || !Array.isArray(node.expressions) || node.expressions.length > 0) {
		return undefined;
	}
	const [quasi] = Array.isArray(node.quasis) ? node.quasis : [];
	return isNode(quasi) && isNode(quasi.value) && typeof quasi.value.cooked === 'string'
		? quasi.value.cooked
		: undefined;
}

function helperSpecifiers(node: unknown, found: string[]): string[] {
	if (Array.isArray(node)) {
		for (const child of node) helperSpecifiers(child, found);
		return found;
	}
	if (!isNode(node)) return found;
	if (node.type === 'CallExpression' && isRequireCallee(node.callee) && Array.isArray(node.arguments)) {
		const specifier = staticString(node.arguments[0]);
		if (specifier !== undefined) found.push(specifier);
	}
	for (const child of Object.values(node)) helperSpecifiers(child, found);
	return found;
}

export function leakedSpecifiers(bundle: string): string[] {
	const code = bundle.replace(/^#![^\n]*/, '');
	const imports = transpiler.scanImports(code).map(({ path }) => path);
	const parsed = parseSync('cli.js', code);
	if (parsed.errors.length) throw new Error(`cli.js does not parse: ${parsed.errors[0]?.message}`);
	const helpers = helperSpecifiers(parsed.program, []);
	return [...new Set([...imports, ...helpers].filter(path => workspaceSpecifier.test(path)))];
}
