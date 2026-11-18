import { dirname, join, normalize, relative } from 'node:path';
import { Effect, Schema } from 'effect';
import { parse as parseJsonc } from 'jsonc-parser';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, capture, parse } from '@/tooling/runtime';

const codeExtensions = ['.ts', '.mts', '.mjs', '.js', '.astro'];
const probes = ['', '.ts', '.tsx', '.mts', '/index.ts'];
const javascriptExtensions: readonly (readonly [string, string])[] = [
	['.js', '.ts'],
	['.mjs', '.mts'],
	['.jsx', '.tsx'],
];

export interface Alias {
	readonly pattern: string;
	readonly targets: readonly string[];
}

export interface Reference {
	readonly specifier: string;
	readonly start: number;
	readonly end: number;
}

export interface PathReference extends Reference {
	readonly dynamic: boolean;
}

const tsconfigSchema = Schema.Struct({
	compilerOptions: Schema.Struct({
		paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	}),
});

const quoted = String.raw`(['"])([^'"\n]+)\1`;
const moduleReferences = [
	new RegExp(String.raw`\b(?:from|import)\s*${quoted}`, 'g'),
	new RegExp(String.raw`\bimport\s*\(\s*(?:/\*[\s\S]*?\*/\s*)*${quoted}`, 'g'),
	new RegExp(String.raw`\brequire\s*\(\s*${quoted}`, 'g'),
	new RegExp(String.raw`\bmock\.module\s*\(\s*${quoted}`, 'g'),
];
const scriptSource = new RegExp(String.raw`<script\b[^>]*\bsrc=${quoted}`, 'g');
const literal = String.raw`(['"\x60])([^'"\x60\n]*)\1`;
const pathPatterns = [
	new RegExp(String.raw`\b(?:join|resolve)\(\s*import\.meta\.(?:dir|dirname)\s*,\s*${literal}`, 'g'),
	new RegExp(String.raw`\bnew URL\(\s*${literal}\s*,\s*import\.meta\.url\s*\)`, 'g'),
	/\x60\$\{import\.meta\.(?:dir|dirname)\}\/([^\x60\n]*)\x60/g,
];
const locationSensitive = /\bimport\.meta\.(?:dir|dirname|url|filename|path)\b/g;

export function isCode(path: string): boolean {
	return !path.startsWith('test/fixtures/') && codeExtensions.some(extension => path.endsWith(extension));
}

const regexAfter = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const regexKeywords = new Set([
	'return',
	'typeof',
	'case',
	'do',
	'else',
	'in',
	'of',
	'yield',
	'await',
	'void',
	'delete',
]);

export function shebangLength(source: string): number {
	if (!source.startsWith('#!')) return 0;
	const end = source.indexOf('\n');
	return end < 0 ? source.length : end;
}

export function codeMask(source: string): Uint8Array {
	const code = new Uint8Array(source.length);
	const templates: number[] = [];
	let i = shebangLength(source), significant = '', word = '';
	const skipString = (quote: string) => {
		i++;
		while (i < source.length && source[i] !== quote && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
		i++;
	};
	const skipTemplate = () => {
		while (i < source.length) {
			if (source[i] === '\\') i += 2;
			else if (source[i] === '`') return void i++;
			else if (source[i] === '$' && source[i + 1] === '{') {
				i += 2;
				templates.push(0);
				return;
			} else i++;
		}
	};
	while (i < source.length) {
		const char = source[i] ?? '';
		const next = source[i + 1];
		if (char === '/' && next === '/') {
			while (i < source.length && source[i] !== '\n') i++;
		} else if (char === '/' && next === '*') {
			const end = source.indexOf('*/', i + 2);
			i = end < 0 ? source.length : end + 2;
		} else if (char === '"' || char === "'") {
			skipString(char);
			significant = char;
			word = '';
		} else if (char === '`') {
			i++;
			skipTemplate();
			significant = '`';
			word = '';
		} else if (char === '/' && (significant === '' || regexAfter.has(significant) || regexKeywords.has(word))) {
			let inClass = false;
			i++;
			while (i < source.length && source[i] !== '\n') {
				const current = source[i];
				if (current === '\\') i++;
				else if (current === '[') inClass = true;
				else if (current === ']') inClass = false;
				else if (current === '/' && !inClass) break;
				i++;
			}
			i++;
			while (/[a-z]/i.test(source[i] ?? '')) i++;
			significant = '/';
			word = '';
		} else if (templates.length && (char === '{' || char === '}')) {
			const depth = templates.length - 1;
			const level = templates[depth] ?? 0;
			if (char === '}' && level === 0) {
				templates.pop();
				i++;
				skipTemplate();
				significant = '`';
				word = '';
				continue;
			}
			templates[depth] = level + (char === '{' ? 1 : -1);
			code[i] = 1;
			significant = char;
			word = '';
			i++;
		} else {
			code[i] = 1;
			if (/\s/.test(char)) {
				i++;
				continue;
			}
			word = /[\w$]/.test(char) ? (/[\w$]/.test(significant) ? word + char : char) : '';
			significant = char;
			i++;
		}
	}
	return code;
}

function scan(source: string, offset: number, patterns: readonly RegExp[], into: Map<number, Reference>): void {
	const code = codeMask(source);
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			const [whole, quote, specifier] = match;
			if (quote === undefined || specifier === undefined || !code[match.index]) continue;
			const start = offset + match.index + whole.lastIndexOf(`${quote}${specifier}${quote}`) + 1;
			into.set(start, { specifier, start, end: start + specifier.length });
		}
	}
}

interface Region {
	readonly offset: number;
	readonly text: string;
}

function scriptRegions(path: string, source: string): Region[] {
	if (!path.endsWith('.astro')) return [{ offset: 0, text: source }];
	const regions: Region[] = [];
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
	if (frontmatter?.[1] !== undefined) {
		regions.push({ offset: frontmatter[0].indexOf(frontmatter[1]), text: frontmatter[1] });
	}
	for (const match of source.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
		const body = match[1] ?? '';
		regions.push({ offset: match.index + match[0].indexOf(body), text: body });
	}
	return regions;
}

export function references(path: string, source: string): Reference[] {
	const found = new Map<number, Reference>();
	for (const region of scriptRegions(path, source)) scan(region.text, region.offset, moduleReferences, found);
	if (path.endsWith('.astro')) {
		for (const match of source.matchAll(scriptSource)) {
			const [whole, quote, specifier] = match;
			if (quote === undefined || specifier === undefined) continue;
			const start = match.index + whole.lastIndexOf(`${quote}${specifier}${quote}`) + 1;
			found.set(start, { specifier, start, end: start + specifier.length });
		}
	}
	return [...found.values()].sort((left, right) => left.start - right.start);
}

export function pathReferences(path: string, source: string): PathReference[] {
	const found: PathReference[] = [];
	for (const region of scriptRegions(path, source)) {
		const code = codeMask(region.text);
		for (const pattern of pathPatterns) {
			for (const match of region.text.matchAll(pattern)) {
				const text = match.length === 2 ? match[1] : match[2];
				if (text === undefined || !code[match.index]) continue;
				const dynamic = match.length === 2 || match[1] === '`';
				const head = dynamic ? text.split('${')[0] ?? '' : text;
				const at = region.offset + match.index + match[0].indexOf(text);
				found.push({ specifier: head, start: at, end: at + head.length, dynamic: dynamic && head !== text });
			}
		}
	}
	return found;
}

export function locationSensitiveLines(path: string, source: string): number[] {
	const lines = new Set<number>();
	for (const region of scriptRegions(path, source)) {
		const code = codeMask(region.text);
		for (const match of region.text.matchAll(locationSensitive)) {
			if (!code[match.index]) continue;
			lines.add(source.slice(0, region.offset + match.index).split('\n').length);
		}
	}
	return [...lines].sort((left, right) => left - right);
}

function clean(path: string): string {
	return normalize(path).replace(/^\.\//, '').replace(/\/$/, '');
}

export function repositoryPath(path: string): string {
	return clean(path) === '.' ? '' : clean(path);
}

export const readAliases = Effect.fn('readAliases')(function*(root: string): Effect.fn.Return<Alias[], ToolFailure> {
	const text = yield* attemptPromise(() => Bun.file(join(root, 'tsconfig.json')).text());
	const config = yield* parse(tsconfigSchema, parseJsonc(text));
	return Object.entries(config.compilerOptions.paths).map(([pattern, targets]) => ({ pattern, targets }));
});

export const trackedFiles = Effect.fn('trackedFiles')(function*(root: string): Effect.fn.Return<string[], ToolFailure> {
	const listing = yield* capture(['git', 'ls-files', '-z'], { cwd: root });
	return listing.split('\0').filter(Boolean);
});

function wildcard(alias: Alias): string | undefined {
	return alias.pattern.endsWith('*') ? alias.pattern.slice(0, -1) : undefined;
}

function matchingAlias(aliases: readonly Alias[], specifier: string): { alias: Alias; rest: string } | undefined {
	const exact = aliases.find(alias => alias.pattern === specifier);
	if (exact) return { alias: exact, rest: '' };
	let best: { alias: Alias; rest: string; length: number } | undefined;
	for (const alias of aliases) {
		const prefix = wildcard(alias);
		if (prefix === undefined || !specifier.startsWith(prefix)) continue;
		if (!best || prefix.length > best.length) {
			best = { alias, rest: specifier.slice(prefix.length), length: prefix.length };
		}
	}
	return best && { alias: best.alias, rest: best.rest };
}

export function isRelative(specifier: string): boolean {
	return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

export function isLocal(aliases: readonly Alias[], specifier: string): boolean {
	return isRelative(specifier) || matchingAlias(aliases, specifier) !== undefined;
}

function splitQuery(specifier: string): [string, string] {
	const index = specifier.search(/[?#]/);
	return index < 0 ? [specifier, ''] : [specifier.slice(0, index), specifier.slice(index)];
}

function probe(files: ReadonlySet<string>, base: string): string | undefined {
	const candidates = probes.map(extension => repositoryPath(`${base}${extension}`));
	for (const [from, to] of javascriptExtensions) {
		if (base.endsWith(from)) candidates.push(repositoryPath(`${base.slice(0, -from.length)}${to}`));
	}
	return candidates.find(path => files.has(path));
}

export function resolveReference(
	aliases: readonly Alias[],
	files: ReadonlySet<string>,
	importer: string,
	specifier: string,
): string | undefined {
	const [path] = splitQuery(specifier);
	if (isRelative(path)) return probe(files, join(dirname(importer), path));
	const matched = matchingAlias(aliases, path);
	if (!matched) return undefined;
	for (const target of matched.alias.targets) {
		const found = probe(files, target.replace('*', matched.rest));
		if (found) return found;
	}
	return undefined;
}

export function specifierCandidates(aliases: readonly Alias[], importer: string, path: string, query = ''): string[] {
	const candidates: { specifier: string; length: number }[] = [];
	for (const alias of aliases) {
		const prefix = wildcard(alias);
		for (const target of alias.targets) {
			if (prefix === undefined) {
				if (repositoryPath(target) === path) candidates.push({ specifier: alias.pattern, length: Infinity });
				continue;
			}
			const base = repositoryPath(target.replace(/\*$/, ''));
			const start = base ? `${base}/` : '';
			if (path.startsWith(start)) {
				candidates.push({ specifier: `${prefix}${path.slice(start.length)}`, length: start.length });
			}
		}
	}
	const local = relative(dirname(importer), path);
	return [
		...candidates.sort((left, right) => right.length - left.length).map(candidate => candidate.specifier),
		local.startsWith('../') ? local : `./${local}`,
	].map(specifier => `${specifier}${query}`);
}

export function queryOf(specifier: string): string {
	return splitQuery(specifier)[1];
}

export function packageOf(path: string): string | undefined {
	const [top, name] = path.split('/');
	return top === 'packages' && name ? name : undefined;
}
