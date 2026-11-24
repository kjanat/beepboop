import { dirname, join, normalize, posix, relative } from 'node:path';
import { Effect, Schema } from 'effect';
import { parse as parseJsonc } from 'jsonc-parser';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, capture, parse } from '@/tooling/runtime';

const codeExtensions = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx', '.astro'];
const runtimeExtensions = ['.tsx', '.jsx', '.mts', '.ts', '.mjs', '.js', '.cts', '.cjs'];
const probes = [
	'',
	...runtimeExtensions,
	'.d.ts',
	...runtimeExtensions.map(extension => `/index${extension}`),
	'/index.astro',
];
const javascriptExtensions: readonly (readonly [string, readonly string[]])[] = [
	['.js', ['.ts', '.tsx', '.d.ts']],
	['.mjs', ['.mts', '.d.mts']],
	['.cjs', ['.cts', '.d.cts']],
	['.jsx', ['.tsx']],
];

export interface Alias {
	readonly pattern: string;
	readonly targets: readonly string[];
}

export type ReferenceKind = 'import' | 'require';

export interface Reference {
	readonly specifier: string;
	readonly start: number;
	readonly end: number;
	readonly kind: ReferenceKind;
}

export interface PathReference {
	readonly path: string;
	readonly start: number;
	readonly end: number;
	readonly quote: string;
	readonly dynamic: boolean;
	readonly rewritable: boolean;
	readonly encoded: boolean;
	readonly literal: string;
	readonly line: number;
}

const tsconfigSchema = Schema.Struct({
	compilerOptions: Schema.Struct({
		paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	}),
});

const quoted = String.raw`(['"])([^'"\n]+)\1`;
const callable = String.raw`(['"\x60])([^'"\x60\n$]+)\1`;
const moduleReferences: readonly (readonly [RegExp, ReferenceKind])[] = [
	[new RegExp(String.raw`\b(?:from|import)\s*${quoted}`, 'g'), 'import'],
	[new RegExp(String.raw`\bimport\s*\(\s*(?:/\*[\s\S]*?\*/\s*)*${callable}`, 'g'), 'import'],
	[new RegExp(String.raw`\brequire\s*\(\s*${callable}`, 'g'), 'require'],
	[new RegExp(String.raw`\brequire\.resolve\s*\(\s*${callable}`, 'g'), 'require'],
	[new RegExp(String.raw`\bimport\.meta\.resolve\s*\(\s*${callable}`, 'g'), 'import'],
	[new RegExp(String.raw`\bmock\.module\s*\(\s*${callable}`, 'g'), 'import'],
];
const scriptSource = new RegExp(String.raw`<script\b[^>]*\bsrc=${quoted}`, 'g');
const joinCall = /\b(join|resolve)\(\s*import\.meta\.(?:dir|dirname)\s*,\s*/g;
const absolute = /^(?:[a-z][a-z\d+.-]*:|\/)/i;
const urlCall =
	/\bnew URL\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\\n]|\\.)*)\x60)\s*,\s*import\.meta\.url\s*\)/g;
const dirTemplate = /\x60\$\{import\.meta\.(?:dir|dirname)\}\/((?:[^\x60\\\n]|\\.)*)\x60/g;
const singleEscapes: Readonly<Record<string, string>> = {
	n: '\n',
	r: '\r',
	t: '\t',
	b: '\b',
	f: '\f',
	v: '\v',
	0: '\0',
};
const locationSensitive = /\bimport\.meta\.(?:dir|dirname|url|filename|path)\b/g;

export function isCode(path: string): boolean {
	return codeExtensions.some(extension => path.endsWith(extension));
}

const regexKeywords = new Set([
	'return',
	'typeof',
	'case',
	'default',
	'do',
	'else',
	'in',
	'of',
	'yield',
	'await',
	'void',
	'delete',
	'instanceof',
	'new',
	'throw',
]);
const headerKeywords = new Set(['if', 'while', 'for', 'with']);

export function shebangLength(source: string): number {
	if (!source.startsWith('#!')) return 0;
	const end = source.indexOf('\n');
	return end < 0 ? source.length : end;
}

export function isJsx(path: string): boolean {
	return path.endsWith('.jsx') || path.endsWith('.tsx');
}

export function codeMask(source: string, jsx = false): Uint8Array {
	return lex(source, jsx).code;
}

interface Element {
	depth: number;
	inTag: boolean;
	closing: boolean;
}

type Nesting =
	| { readonly kind: 'template'; level: number }
	| { readonly kind: 'jsx'; level: number; readonly element: Element };

const typeParameters = /^<[A-Za-z_$][\w$]*\s*(?:,|extends\b)/;

function lex(
	source: string,
	jsx: boolean,
): { readonly code: Uint8Array; readonly comments: readonly (readonly [number, number])[] } {
	const code = new Uint8Array(source.length);
	const comments: (readonly [number, number])[] = [];
	const nesting: Nesting[] = [];
	const parens: boolean[] = [];
	let i = shebangLength(source);
	let operand = false, word = '', previous = '', wordAfterDot = false, lastPunctuation = '';
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
				nesting.push({ kind: 'template', level: 0 });
				return;
			} else i++;
		}
	};
	const skipJsx = (element: Element): boolean => {
		while (i < source.length) {
			const char = source[i];
			if (char === '{') {
				code[i] = 1;
				i++;
				nesting.push({ kind: 'jsx', level: 0, element });
				return false;
			}
			if (!element.inTag) {
				if (char === '<') {
					element.inTag = true;
					element.closing = source[i + 1] === '/';
					i += element.closing ? 2 : 1;
				} else i++;
				continue;
			}
			if (char === '"' || char === "'") {
				skipString(char);
			} else if (char === '/' && source[i + 1] === '>') {
				i += 2;
				element.inTag = false;
				if (element.depth === 0) return true;
			} else if (char === '>') {
				i++;
				element.inTag = false;
				element.depth += element.closing ? -1 : 1;
				if (element.depth === 0) return true;
			} else i++;
		}
		return true;
	};
	const finishJsx = (element: Element) => {
		if (skipJsx(element)) {
			operand = true;
			previous = '';
		} else operand = false;
	};
	while (i < source.length) {
		const char = source[i] ?? '';
		const next = source[i + 1];
		if (/[\w$]/.test(char)) {
			if (!word) wordAfterDot = lastPunctuation === '.';
			word += char;
			code[i] = 1;
			i++;
			continue;
		}
		if (word) {
			operand = !(regexKeywords.has(word) && !wordAfterDot);
			previous = wordAfterDot ? '' : word;
			word = '';
			lastPunctuation = '';
		}
		if (char === '/' && next === '/') {
			const end = source.indexOf('\n', i);
			const stop = end < 0 ? source.length : end;
			comments.push([i, stop]);
			i = stop;
		} else if (char === '/' && next === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end < 0 ? source.length : end + 2;
			comments.push([i, stop]);
			i = stop;
		} else if (char === '"' || char === "'") {
			skipString(char);
			operand = true;
			previous = '';
		} else if (char === '`') {
			i++;
			skipTemplate();
			operand = true;
			previous = '';
		} else if (char === '/' && !operand) {
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
			operand = true;
			previous = '';
		} else if (
			jsx && char === '<' && !operand && /[A-Za-z_$>]/.test(next ?? '')
			&& !typeParameters.test(source.slice(i, i + 80))
		) {
			i++;
			finishJsx({ depth: 0, inTag: true, closing: false });
		} else if (nesting.length && (char === '{' || char === '}')) {
			const top = nesting.at(-1);
			if (top && char === '}' && top.level === 0) {
				nesting.pop();
				code[i] = 1;
				i++;
				if (top.kind === 'template') {
					skipTemplate();
					operand = true;
					previous = '';
				} else finishJsx(top.element);
				continue;
			}
			if (top) top.level += char === '{' ? 1 : -1;
			code[i] = 1;
			operand = false;
			previous = '';
			lastPunctuation = char;
			i++;
		} else {
			code[i] = 1;
			if (/\s/.test(char)) {
				i++;
				continue;
			}
			if (char === '!' && operand && next !== '=') {
				lastPunctuation = char;
				i++;
				continue;
			}
			if ((char === '+' || char === '-') && next === char) {
				code[i + 1] = 1;
				i += 2;
				lastPunctuation = char;
				continue;
			}
			if (char === '(') parens.push(headerKeywords.has(previous));
			operand = char === ')' ? !parens.pop() : char === ']';
			previous = '';
			lastPunctuation = char;
			i++;
		}
	}
	return { code, comments };
}

function blankComments(source: string, comments: readonly (readonly [number, number])[]): string {
	const parts: string[] = [];
	let from = 0;
	for (const [start, stop] of comments) {
		parts.push(source.slice(from, start), source.slice(start, stop).replace(/[^\n]/g, ' '));
		from = stop;
	}
	parts.push(source.slice(from));
	return parts.join('');
}

function scan(source: string, offset: number, into: Map<number, Reference>, masked: boolean, jsx: boolean): void {
	const lexed = masked ? lex(source, jsx) : undefined;
	const code = lexed?.code;
	const text = lexed ? blankComments(source, lexed.comments) : source;
	for (const [pattern, kind] of moduleReferences) {
		for (const match of text.matchAll(pattern)) {
			const [whole, quote, specifier] = match;
			if (quote === undefined || specifier === undefined || (code && !code[match.index])) continue;
			const start = offset + match.index + whole.lastIndexOf(`${quote}${specifier}${quote}`) + 1;
			into.set(start, { specifier, start, end: start + specifier.length, kind });
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

function collect(path: string, source: string, masked: boolean): Reference[] {
	const found = new Map<number, Reference>();
	for (const region of scriptRegions(path, source)) scan(region.text, region.offset, found, masked, isJsx(path));
	if (path.endsWith('.astro')) {
		for (const match of source.matchAll(scriptSource)) {
			const [whole, quote, specifier] = match;
			if (quote === undefined || specifier === undefined) continue;
			const start = match.index + whole.lastIndexOf(`${quote}${specifier}${quote}`) + 1;
			found.set(start, { specifier, start, end: start + specifier.length, kind: 'import' });
		}
	}
	return [...found.values()].sort((left, right) => left.start - right.start);
}

const transpilers = {
	ts: new Bun.Transpiler({ loader: 'ts' }),
	tsx: new Bun.Transpiler({ loader: 'tsx' }),
	js: new Bun.Transpiler({ loader: 'js' }),
	jsx: new Bun.Transpiler({ loader: 'jsx' }),
};

function transpilerFor(path: string): Bun.Transpiler {
	if (/\.[cm]?js$/.test(path)) return transpilers.js;
	if (path.endsWith('.jsx')) return transpilers.jsx;
	return path.endsWith('.tsx') ? transpilers.tsx : transpilers.ts;
}

export function scannedImports(path: string, source: string): { specifier: string; kind: ReferenceKind }[] {
	const loader = transpilerFor(path);
	const body = path.endsWith('.astro') ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '' : source;
	return loader.scanImports(body.slice(shebangLength(body))).map(entry => ({
		specifier: entry.path,
		kind: entry.kind === 'require-call' || entry.kind === 'require-resolve' ? 'require' : 'import',
	}));
}

export function references(path: string, source: string): Reference[] {
	return collect(path, source, true);
}

export function looseReferences(path: string, source: string): Reference[] {
	return collect(path, source, false);
}

function lineOf(source: string, index: number): number {
	return source.slice(0, index).split('\n').length;
}

interface Argument {
	readonly quote: string;
	readonly text: string;
	readonly start: number;
	readonly end: number;
	readonly dynamic: boolean;
}

function literalArguments(text: string, from: number): { list: Argument[]; complete: boolean } {
	const list: Argument[] = [];
	let i = from;
	while (i < text.length) {
		const quote = text[i] ?? '';
		if (quote !== "'" && quote !== '"' && quote !== '`') return { list, complete: false };
		let close = i + 1;
		while (close < text.length && text[close] !== quote) close += text[close] === '\\' ? 2 : 1;
		if (close >= text.length) return { list, complete: false };
		const body = text.slice(i + 1, close);
		const dynamic = quote === '`' && body.includes('${');
		list.push({ quote, text: dynamic ? body.split('${')[0] ?? '' : body, start: i, end: close + 1, dynamic });
		if (dynamic) return { list, complete: false };
		i = close + 1;
		while (/\s/.test(text[i] ?? '')) i++;
		if (text[i] === ')') return { list, complete: true };
		if (text[i] !== ',') return { list, complete: false };
		i++;
		while (/\s/.test(text[i] ?? '')) i++;
	}
	return { list, complete: false };
}

export function unescaped(text: string): string {
	return text.replace(
		/\\(?:x([\da-fA-F]{2})|u\{([\da-fA-F]+)\}|u([\da-fA-F]{4})|(\r\n|[\s\S]))/g,
		(_: string, hex: string | undefined, point: string | undefined, unit: string | undefined, other = '') => {
			const digits = hex ?? point ?? unit;
			if (digits !== undefined) return String.fromCodePoint(Number.parseInt(digits, 16));
			if (/^[\r\n\u2028\u2029]/.test(other)) return '';
			return singleEscapes[other] ?? other;
		},
	);
}

export function escapedFor(text: string, quote: string): string {
	const escaped = text.replace(/[\\\n\r]/g, char => char === '\\' ? '\\\\' : char === '\n' ? '\\n' : '\\r')
		.replaceAll(quote, `\\${quote}`);
	return quote === '`' ? escaped.replaceAll('${', '\\${') : escaped;
}

function decodedPath(path: string): string | undefined {
	try {
		return decodeURIComponent(path);
	} catch {
		return undefined;
	}
}

export function encodedPath(path: string): string {
	return path.split('/').map(segment => encodeURIComponent(segment).replaceAll("'", '%27')).join('/');
}

export function pathReferences(path: string, source: string): PathReference[] {
	const found: PathReference[] = [];
	for (const region of scriptRegions(path, source)) {
		const text = region.text;
		const code = codeMask(text, isJsx(path));
		for (const match of text.matchAll(joinCall)) {
			if (!code[match.index]) continue;
			const { list, complete } = literalArguments(text, match.index + match[0].length);
			const [first] = list;
			const last = list.at(-1);
			if (!first || !last || (match[1] === 'resolve' && list.some(argument => argument.text.startsWith('/')))) continue;
			const single = list.length === 1;
			const joined = list.map(argument => unescaped(argument.text)).filter(Boolean);
			found.push({
				path: joined.length ? posix.join(...joined) : '',
				start: region.offset + (single ? first.start + 1 : first.start),
				end: region.offset + (single ? first.start + 1 + first.text.length : last.end),
				quote: single ? '' : first.quote,
				dynamic: last.dynamic || !complete,
				rewritable: single || !last.dynamic,
				encoded: false,
				literal: first.quote,
				line: lineOf(source, region.offset + match.index),
			});
		}
		for (const match of text.matchAll(urlCall)) {
			const [, single, double, template] = match;
			const quote = single !== undefined ? "'" : double !== undefined ? '"' : '`';
			const body = single ?? double ?? template;
			if (body === undefined || !code[match.index] || absolute.test(body)) continue;
			const dynamic = quote === '`' && body.includes('${');
			const prefix = dynamic ? body.split('${')[0] ?? '' : body;
			const [head] = splitQuery(prefix);
			const open = dynamic && !/[?#]/.test(prefix);
			if (head === '' && !open) continue;
			const decoded = decodedPath(unescaped(head));
			const start = region.offset + match.index + match[0].indexOf(body);
			found.push({
				path: decoded ?? unescaped(head),
				start,
				end: start + head.length,
				quote: '',
				dynamic: open,
				rewritable: true,
				encoded: decoded !== undefined,
				literal: quote,
				line: lineOf(source, start),
			});
		}
		for (const match of text.matchAll(dirTemplate)) {
			const [, body] = match;
			if (body === undefined || !code[match.index + 3]) continue;
			const dynamic = body.includes('${');
			const head = dynamic ? body.split('${')[0] ?? '' : body;
			const start = region.offset + match.index + match[0].indexOf(body);
			found.push({
				path: unescaped(head),
				start,
				end: start + head.length,
				quote: '',
				dynamic,
				rewritable: true,
				encoded: false,
				literal: '`',
				line: lineOf(source, start),
			});
		}
	}
	return found;
}

export function locationSensitiveLines(path: string, source: string): number[] {
	const lines = new Set<number>();
	for (const region of scriptRegions(path, source)) {
		const code = codeMask(region.text, isJsx(path));
		for (const match of region.text.matchAll(locationSensitive)) {
			if (!code[match.index]) continue;
			lines.add(lineOf(source, region.offset + match.index));
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

export function matchingAlias(
	aliases: readonly Alias[],
	specifier: string,
): { alias: Alias; rest: string } | undefined {
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

export function splitQuery(specifier: string): [string, string] {
	const index = specifier.search(/[?#]/);
	return index < 0 ? [specifier, ''] : [specifier.slice(0, index), specifier.slice(index)];
}

export function candidatePaths(base: string): string[] {
	const candidates = probes.map(extension => repositoryPath(`${base}${extension}`));
	for (const [from, targets] of javascriptExtensions) {
		if (!base.endsWith(from)) continue;
		for (const to of targets) candidates.push(repositoryPath(`${base.slice(0, -from.length)}${to}`));
	}
	return candidates;
}

export function specifierForms(path: string): string[] {
	const forms = new Set([path]);
	for (const probe of probes) {
		if (probe && path.endsWith(probe) && path.length > probe.length) forms.add(path.slice(0, -probe.length));
	}
	for (const [from, targets] of javascriptExtensions) {
		for (const to of targets) {
			if (path.endsWith(to) && path.length > to.length) forms.add(`${path.slice(0, -to.length)}${from}`);
		}
	}
	return [...forms];
}

export function aliasBases(aliases: readonly Alias[], specifier: string): string[] {
	const [path] = splitQuery(specifier);
	const matched = matchingAlias(aliases, path);
	return matched ? matched.alias.targets.map(target => target.replaceAll('*', matched.rest)) : [];
}

export function resolveReference(
	aliases: readonly Alias[],
	files: ReadonlySet<string>,
	importer: string,
	specifier: string,
): string | undefined {
	const [path] = splitQuery(specifier);
	const bases = isRelative(path) ? [join(dirname(importer), path)] : aliasBases(aliases, specifier);
	for (const base of bases) {
		const found = candidatePaths(base).find(candidate => files.has(candidate));
		if (found) return found;
	}
	return undefined;
}

export function relativeSpecifier(importer: string, path: string): string {
	const local = relative(dirname(importer), path);
	return local.startsWith('../') ? local : `./${local}`;
}

export function specifierCandidates(aliases: readonly Alias[], importer: string, target: string, query = ''): string[] {
	const path = target.endsWith('.d.ts') ? target.slice(0, -'.d.ts'.length) : target;
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
	return [
		...candidates.sort((left, right) => right.length - left.length).map(candidate => candidate.specifier),
		relativeSpecifier(importer, path),
	].map(specifier => `${specifier}${query}`);
}

export function queryOf(specifier: string): string {
	return splitQuery(specifier)[1];
}

export function packageOf(path: string): string | undefined {
	const [top, name] = path.split('/');
	return top === 'packages' && name ? name : undefined;
}
