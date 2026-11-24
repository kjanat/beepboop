import type { UnsettableVersion } from '@/domain/binary-platforms.ts';

const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|`[^`]*`|'(?:[^'\\\n]|\\.)*'/g;
const cPath = /^(?:"(?:C|\\x43|\\103|\\u0043|\\U00000043)"|`C`)$/;

function code(source: string): string {
	return source.replace(tokens, token =>
		token.startsWith('//')
			? ''
			: token.startsWith('/*')
			? token.includes('\n') ? '\n' : ' '
			: token.startsWith("'")
			? "''"
			: cPath.test(token)
			? '"C"'
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

const keywordEnd =
	/(?<![\p{L}\p{Nd}_.])(?:case|chan|const|default|defer|else|for|func|go|goto|if|import|interface|map|package|range|select|struct|switch|type|var)\s*$/u;

const statements = (text: string) =>
	split(
		text,
		(char, current) =>
			char === ';'
			|| char === '\n' && /(?:[\p{L}\p{Nd}_"')\]}]|(?<![\p{L}\p{Nd}_.])\d+\.)\s*$/u.test(current)
				&& !keywordEnd.test(current),
	);

function specs(statement: string, keyword: string): string[] {
	const body = statement.slice(keyword.length).trim();
	return body.startsWith('(') && body.endsWith(')') ? statements(body.slice(1, -1)) : [body];
}

function literalType(value: string): string | undefined {
	const composite = /^(&?)\s*((?:\[[^\]]*\]|map\[[^\]]*\]|\*)*[\p{L}_][\p{L}\p{Nd}_.]*)\s*\{/u.exec(value);
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

type Universal = (name: string) => boolean;

function inferred(value: string, universal: Universal): string | undefined {
	const literal = literalType(value);
	if (literal) return literal;
	if (value === "''") return 'rune';
	if (/^(?:true|false)$/.test(value)) return universal(value) ? 'bool' : undefined;
	if (/^[-+]?(?:\d[\d_]*|0[xXbBoO][\da-fA-F_]+)$/.test(value)) return 'int';
	if (/^[-+]?[\d.][\d_.eE+-]*$/.test(value)) return 'float64';
	return undefined;
}

type Found = { kind: 'const' } | { kind: 'var'; type: string; stated: boolean };

const unparenthesized = (type: string) => type.trim().replace(/^\(\s*([\s\S]*?)\s*\)$/, '$1');

const specNames = (spec: string) =>
	/^[\p{L}_][\p{L}\p{Nd}_]*(?:\s*,\s*[\p{L}_][\p{L}\p{Nd}_]*)*/u.exec(spec)?.[0].split(',').map(name => name.trim())
		?? [];

function declared(constant: boolean, spec: string, universal: Universal): Found | undefined {
	const parsed = /^([\p{L}_][\p{L}\p{Nd}_]*(?:\s*,\s*[\p{L}_][\p{L}\p{Nd}_]*)*)\s*([^=]*?)\s*(?:=\s*([\s\S]*))?$/u.exec(
		spec,
	);
	const index = specNames(spec).indexOf('version');
	if (index < 0) return undefined;
	if (constant) return { kind: 'const' };
	const stated = parsed?.[2] ? unparenthesized(parsed[2]) : '';
	if (stated) return { kind: 'var', type: stated, stated: true };
	const type = inferred(split(parsed?.[3] ?? '', char => char === ',')[index] ?? '', universal);
	return type === undefined ? undefined : { kind: 'var', type, stated: false };
}

// KnownOS and KnownArch from Go's src/internal/syslist/syslist.go, which go/build uses for file-name constraints.
const knownOS = new Set([
	'aix',
	'android',
	'darwin',
	'dragonfly',
	'freebsd',
	'hurd',
	'illumos',
	'ios',
	'js',
	'linux',
	'nacl',
	'netbsd',
	'openbsd',
	'plan9',
	'solaris',
	'wasip1',
	'windows',
	'zos',
]);
const knownArch = new Set([
	'386',
	'amd64',
	'amd64p32',
	'arm',
	'armbe',
	'arm64',
	'arm64be',
	'loong64',
	'mips',
	'mipsle',
	'mips64',
	'mips64le',
	'mips64p32',
	'mips64p32le',
	'ppc',
	'ppc64',
	'ppc64le',
	'riscv',
	'riscv64',
	's390',
	's390x',
	'sparc',
	'sparc64',
	'wasm',
]);

function constrainedName(file: string): boolean {
	const stem = file.slice(file.lastIndexOf('/') + 1).split('.')[0] ?? '';
	const last = stem.includes('_') ? stem.slice(stem.lastIndexOf('_') + 1) : '';
	return knownOS.has(last) || knownArch.has(last);
}

const importsC = (list: readonly string[]) =>
	list.some(statement =>
		/^import(?![\p{L}\p{Nd}_])/u.test(statement) && specs(statement, 'import').some(spec => spec.endsWith('"C"'))
	);

function built(file: string, list: readonly string[], source: string): boolean {
	return !constrainedName(file) && !/^\s*\/\/(?:go:build|\s*\+build)\s/m.test(source)
		&& /^package\s+main$/.test(list[0] ?? '') && !importsC(list);
}

function declaration(list: readonly string[], universal: Universal): Found | undefined {
	for (const statement of list) {
		const keyword = /^(?:var|const)(?![\p{L}\p{Nd}_])/u.exec(statement)?.[0];
		const found = keyword
			? specs(statement, keyword).map(spec => declared(keyword === 'const', spec, universal)).find(Boolean)
			: undefined;
		if (found) return found;
	}
	return undefined;
}

interface TypeDeclaration {
	alias: boolean;
	target: string;
}
function typeDeclarations(list: readonly string[]): [string, TypeDeclaration][] {
	return list.flatMap(statement =>
		/^type(?![\p{L}\p{Nd}_])/u.test(statement)
			? specs(statement, 'type').flatMap((spec): [string, TypeDeclaration][] => {
				const match = /^([\p{L}_][\p{L}\p{Nd}_]*)\s*(=?)\s*([\s\S]+)$/u.exec(spec);
				return match?.[1] && match[3] ? [[match[1], { alias: match[2] === '=', target: match[3] }]] : [];
			})
			: []
	);
}

function packageNames(list: readonly string[]): string[] {
	return [
		...list.flatMap(statement => {
			const keyword = /^(?:var|const)(?![\p{L}\p{Nd}_])/u.exec(statement)?.[0];
			return keyword ? specs(statement, keyword).flatMap(specNames) : [];
		}),
		...typeDeclarations(list).map(([name]) => name),
	];
}

const predeclared = new Set([
	'any',
	'bool',
	'byte',
	'complex64',
	'complex128',
	'error',
	'float32',
	'float64',
	'int',
	'int8',
	'int16',
	'int32',
	'int64',
	'rune',
	'uint',
	'uint8',
	'uint16',
	'uint32',
	'uint64',
	'uintptr',
]);

function notString(
	type: string,
	types: ReadonlyMap<string, TypeDeclaration>,
	universal: Universal,
	seen: ReadonlySet<string> = new Set(),
): boolean {
	const name = unparenthesized(type);
	if (/^(?:\*|\[|map\[|<-|(?:chan|func|struct|interface)(?![\p{L}\p{Nd}_]))/u.test(name)) return true;
	const declaration = types.get(name);
	if (declaration && !seen.has(name)) {
		return !declaration.alias || notString(declaration.target, types, universal, new Set([...seen, name]));
	}
	return predeclared.has(name) && universal(name);
}

export function unsettableVersion(
	files: readonly (readonly [string, string | undefined])[],
): UnsettableVersion | undefined {
	const read = files.flatMap(([file, source]) =>
		source === undefined ? [] : [{ file, source, list: statements(code(source)) }]
	);
	const shadowed = new Set(read.flatMap(({ list }) => packageNames(list)));
	const universal = (name: string) => read.length === files.length && !shadowed.has(name);
	const parsed = read.filter(({ file, list, source }) => built(file, list, source));
	const types = new Map(parsed.flatMap(({ list }) => typeDeclarations(list)));
	for (const { file, list } of parsed) {
		const found = declaration(list, universal);
		if (!found) continue;
		if (found.kind === 'const') return { kind: 'const', file };
		return !found.stated || notString(found.type, types, universal)
			? { kind: 'var', type: found.type, file }
			: undefined;
	}
	return undefined;
}
