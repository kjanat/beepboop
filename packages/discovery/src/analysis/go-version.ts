import type { UnsettableVersion, VersionDeclaration } from '@/domain/binary-platforms.ts';

const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|`[^`]*`|'(?:[^'\\\n]|\\.)*'/g;

function code(source: string): string {
	return source.replace(tokens, token =>
		token.startsWith('//')
			? ''
			: token.startsWith('/*')
			? token.includes('\n') ? '\n' : ' '
			: token.startsWith("'")
			? "''"
			: '""');
}

function split(text: string, ends: (char: string, current: string) => boolean): string[] {
	const parts: string[] = [];
	let depth = 0, current = '';
	for (const char of text) {
		if ('([{'.includes(char)) depth += 1;
		else if (')]}'.includes(char)) depth -= 1;
		if (depth === 0 && ends(char, current)) {
			parts.push(current.trim());
			current = '';
		} else current += char;
	}
	return [...parts, current.trim()].filter(Boolean);
}

const statements = (text: string) =>
	split(
		text,
		(char, current) => char === ';' || char === '\n' && /(?:[\w"')\]}]|(?<![\w.])\d+\.)\s*$/.test(current),
	);

function specs(statement: string, keyword: string): string[] {
	const body = statement.slice(keyword.length).trim();
	return body.startsWith('(') && body.endsWith(')') ? statements(body.slice(1, -1)) : [body];
}

function literalType(value: string): string | undefined {
	const composite = /^(&?)\s*((?:\[[^\]]*\]|map\[[^\]]*\]|\*)*[A-Za-z_][\w.]*)\s*\{/.exec(value);
	if (!composite) return undefined;
	const [whole, pointer, type] = composite;
	let depth = 0;
	for (let index = whole.length - 1; index < value.length; index += 1) {
		const char = value[index] ?? '';
		if ('([{'.includes(char)) depth += 1;
		else if (')]}'.includes(char)) depth -= 1;
		if (depth === 0) return index === value.length - 1 ? `${pointer ? '*' : ''}${type}` : undefined;
	}
	return undefined;
}

function inferred(value: string): string | undefined {
	const literal = literalType(value);
	if (literal) return literal;
	if (value === "''") return 'rune';
	if (/^(?:true|false)$/.test(value)) return 'bool';
	if (/^[-+]?(?:\d[\d_]*|0[xXbBoO][\da-fA-F_]+)$/.test(value)) return 'int';
	if (/^[-+]?[\d.][\d_.eE+-]*$/.test(value)) return 'float64';
	return undefined;
}

function declared(constant: boolean, spec: string): VersionDeclaration | undefined {
	const parsed = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*([^=]*?)\s*(?:=\s*([\s\S]*))?$/.exec(spec);
	const names = parsed?.[1]?.split(',').map(name => name.trim()) ?? [];
	const index = names.indexOf('version');
	if (index < 0) return undefined;
	if (constant) return { kind: 'const' };
	const values = split(parsed?.[3] ?? '', char => char === ',');
	const type = parsed?.[2]?.replace(/^\(\s*([\s\S]*?)\s*\)$/, '$1') || inferred(values[index] ?? '');
	return type === undefined ? undefined : { kind: 'var', type };
}

function built(source: string): string[] | undefined {
	if (/^\/\/(?:go:build| \+build) ignore\s*$/m.test(source)) return undefined;
	const list = statements(code(source));
	return list[0] === 'package main' ? list : undefined;
}

function declaration(list: readonly string[]): VersionDeclaration | undefined {
	for (const statement of list) {
		const keyword = /^(?:var|const)\b/.exec(statement)?.[0];
		const found = keyword
			? specs(statement, keyword).map(spec => declared(keyword === 'const', spec)).find(Boolean)
			: undefined;
		if (found) return found;
	}
	return undefined;
}

function stringAliases(list: readonly string[]): string[] {
	return list.flatMap(statement =>
		/^type\b/.test(statement)
			? specs(statement, 'type').flatMap(spec => /^([A-Za-z_]\w*)\s*=\s*string$/.exec(spec)?.[1] ?? [])
			: []
	);
}

export function unsettableVersion(files: readonly (readonly [string, string])[]): UnsettableVersion | undefined {
	const parsed = files.flatMap(([file, source]) => {
		const list = built(source);
		return list ? [{ file, list }] : [];
	});
	const strings = new Set(['string', ...parsed.flatMap(({ list }) => stringAliases(list))]);
	for (const { file, list } of parsed) {
		const found = declaration(list);
		if (found) return found.kind === 'var' && strings.has(found.type) ? undefined : { ...found, file };
	}
	return undefined;
}
