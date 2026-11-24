import type { UnsettableVersion } from '@/domain/binary-platforms.ts';

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

type Found = { kind: 'const' } | { kind: 'var'; type: string; stated: boolean };

const unparenthesized = (type: string) => type.trim().replace(/^\(\s*([\s\S]*?)\s*\)$/, '$1');

function declared(constant: boolean, spec: string): Found | undefined {
	const parsed = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*([^=]*?)\s*(?:=\s*([\s\S]*))?$/.exec(spec);
	const names = parsed?.[1]?.split(',').map(name => name.trim()) ?? [];
	const index = names.indexOf('version');
	if (index < 0) return undefined;
	if (constant) return { kind: 'const' };
	const stated = parsed?.[2] ? unparenthesized(parsed[2]) : '';
	if (stated) return { kind: 'var', type: stated, stated: true };
	const type = inferred(split(parsed?.[3] ?? '', char => char === ',')[index] ?? '');
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

const cgo = /^import\s*(?:\(\s*(?:[^)]*\n\s*)?)?"C"\s*(?:$|\n|\))/m;

function built(file: string, source: string): string[] | undefined {
	if (constrainedName(file) || /^\/\/(?:go:build|\s*\+build)\s/m.test(source) || cgo.test(source)) return undefined;
	const list = statements(code(source));
	return list[0] === 'package main' ? list : undefined;
}

function declaration(list: readonly string[]): Found | undefined {
	for (const statement of list) {
		const keyword = /^(?:var|const)\b/.exec(statement)?.[0];
		const found = keyword
			? specs(statement, keyword).map(spec => declared(keyword === 'const', spec)).find(Boolean)
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
		/^type\b/.test(statement)
			? specs(statement, 'type').flatMap((spec): [string, TypeDeclaration][] => {
				const match = /^([A-Za-z_]\w*)\s*(=?)\s*([\s\S]+)$/.exec(spec);
				return match?.[1] && match[3] ? [[match[1], { alias: match[2] === '=', target: match[3] }]] : [];
			})
			: []
	);
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
	seen: ReadonlySet<string> = new Set(),
): boolean {
	const name = unparenthesized(type);
	if (/^(?:\*|\[|map\[|chan\b|<-|func\b|struct\b|interface\b)/.test(name)) return true;
	const declaration = types.get(name);
	if (declaration && !seen.has(name)) {
		return !declaration.alias || notString(declaration.target, types, new Set([...seen, name]));
	}
	return predeclared.has(name);
}

export function unsettableVersion(files: readonly (readonly [string, string])[]): UnsettableVersion | undefined {
	const parsed = files.flatMap(([file, source]) => {
		const list = built(file, source);
		return list ? [{ file, list }] : [];
	});
	const types = new Map(parsed.flatMap(({ list }) => typeDeclarations(list)));
	for (const { file, list } of parsed) {
		const found = declaration(list);
		if (!found) continue;
		if (found.kind === 'const') return { kind: 'const', file };
		return !found.stated || notString(found.type, types)
			? { kind: 'var', type: found.type, file }
			: undefined;
	}
	return undefined;
}
