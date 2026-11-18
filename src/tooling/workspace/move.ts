import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Effect } from 'effect';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, capture, checkArguments, main, refuse, run } from '@/tooling/runtime';
import type { Alias } from '@/tooling/workspace/modules';
import {
	isCode,
	isLocal,
	locationSensitiveLines,
	packageOf,
	pathReferences,
	queryOf,
	readAliases,
	references,
	repositoryPath,
	resolveReference,
	shebangLength,
	specifierCandidates,
	trackedFiles,
} from '@/tooling/workspace/modules';

export interface MoveReport {
	readonly moved: number;
	readonly rewritten: number;
	readonly files: number;
	readonly addedAliases: readonly string[];
	readonly mentions: readonly string[];
	readonly review: readonly string[];
}

interface Layout {
	readonly aliases: readonly Alias[];
	readonly files: ReadonlySet<string>;
}

interface Plan {
	readonly files: ReadonlyMap<string, string>;
	readonly directories: readonly (readonly [string, string])[];
}

interface Edit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

const expandPairs = Effect.fn('expandPairs')(function*(
	files: readonly string[],
	pairs: readonly (readonly [string, string])[],
): Effect.fn.Return<Plan, ToolFailure> {
	const moves = new Map<string, string>();
	const directories: [string, string][] = [];
	for (const [rawFrom, rawTo] of pairs) {
		const from = repositoryPath(rawFrom), to = repositoryPath(rawTo);
		const inside = files.filter(file => file.startsWith(`${from}/`));
		if (files.includes(from)) moves.set(from, to);
		else if (inside.length) {
			directories.push([from, to]);
			for (const file of inside) moves.set(file, `${to}/${file.slice(from.length + 1)}`);
		} else return yield* refuse(`Not a tracked file or directory: ${rawFrom}`);
	}
	const targets = [...moves.values()];
	const clash = targets.find((target, index) => targets.indexOf(target) !== index || files.includes(target));
	if (clash) return yield* refuse(`Move target already exists or repeats: ${clash}`);
	return { files: moves, directories };
});

const occupied = Effect.fn('occupied')(function*(root: string, targets: Iterable<string>) {
	const problems: string[] = [];
	const exists = (path: string) =>
		attemptPromise(() =>
			lstat(join(root, path)).then(stats => stats.isDirectory() ? 'directory' : 'file', () => 'none')
		);
	for (const target of targets) {
		if ((yield* exists(target)) !== 'none') problems.push(`${target} already exists on disk`);
		for (let parent = dirname(target); parent !== '.'; parent = dirname(parent)) {
			if ((yield* exists(parent)) === 'file') problems.push(`${target} would sit under the file ${parent}`);
		}
	}
	return problems;
});

function packageAliases(aliases: readonly Alias[], moves: ReadonlyMap<string, string>): Alias[] {
	const added = new Map<string, Alias>();
	for (const target of moves.values()) {
		const name = packageOf(target);
		if (!name || !target.startsWith(`packages/${name}/src/`)) continue;
		const source = `./packages/${name}/src/*`;
		if (aliases.some(alias => alias.targets.includes(source))) continue;
		added.set(name, { pattern: `@/${name}/*`, targets: [source] });
	}
	return [...added.values()];
}

function isDirectory(files: ReadonlySet<string>, path: string): boolean {
	if (path === '') return true;
	for (const file of files) if (file.startsWith(`${path}/`)) return true;
	return false;
}

function mapPath(plan: Plan, files: ReadonlySet<string>, path: string, dynamic: boolean): string | undefined {
	const file = plan.files.get(path);
	if (file !== undefined) return file;
	if (files.has(path)) return path;
	for (const [from, to] of plan.directories) {
		if (path === from || path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
	}
	const inside = [...files].filter(candidate => path === '' || candidate.startsWith(`${path}/`));
	const moved = inside.filter(candidate => plan.files.has(candidate));
	if (!moved.length || (!dynamic && moved.length < inside.length)) return path;
	const [first] = moved;
	const target = first === undefined ? undefined : plan.files.get(first);
	if (target === undefined || first === undefined) return undefined;
	const suffix = path === '' ? first : first.slice(path.length);
	if (!target.endsWith(suffix)) return undefined;
	const mapped = target.slice(0, target.length - suffix.length);
	const consistent = inside.every(candidate =>
		(plan.files.get(candidate) ?? candidate) === `${mapped}${path === '' ? candidate : candidate.slice(path.length)}`
	);
	return consistent ? repositoryPath(mapped) : undefined;
}

function relativePath(from: string, to: string, original: string): string {
	const result = relative(from, to) || '.';
	return original.startsWith('./') && !result.startsWith('.') ? `./${result}` : result;
}

interface Rewritten {
	readonly text: string;
	readonly count: number;
	readonly problems: readonly string[];
	readonly review: readonly string[];
}

function rewrite(
	source: string,
	importer: string,
	destination: string,
	before: Layout,
	after: Layout,
	plan: Plan,
): Rewritten {
	const edits: Edit[] = [];
	const problems: string[] = [];
	for (const reference of references(importer, source)) {
		const target = resolveReference(before.aliases, before.files, importer, reference.specifier);
		if (target === undefined) continue;
		const expected = plan.files.get(target) ?? target;
		if (resolveReference(after.aliases, after.files, destination, reference.specifier) === expected) continue;
		const query = queryOf(reference.specifier);
		const replacement = specifierCandidates(after.aliases, destination, expected, query).find(candidate =>
			resolveReference(after.aliases, after.files, destination, candidate) === expected
		);
		if (replacement === undefined) problems.push(`${importer}: no specifier reaches ${expected} from ${destination}`);
		else edits.push({ start: reference.start, end: reference.end, text: replacement });
	}
	const handled = new Set<number>();
	for (const reference of pathReferences(importer, source)) {
		const line = source.slice(0, reference.start).split('\n').length;
		handled.add(line);
		const trailing = reference.specifier.endsWith('/');
		const old = repositoryPath(join(dirname(importer), reference.specifier));
		if (!before.files.has(old) && !isDirectory(before.files, old)) continue;
		const mapped = mapPath(plan, before.files, old, reference.dynamic);
		if (mapped === undefined) {
			problems.push(
				`${importer}:${line}: ${reference.specifier} names a directory whose files move to different places`,
			);
			continue;
		}
		if (repositoryPath(join(dirname(destination), reference.specifier)) === mapped) continue;
		const text = `${relativePath(dirname(destination), mapped, reference.specifier)}${trailing ? '/' : ''}`;
		edits.push({ start: reference.start, end: reference.end, text });
	}
	const review = dirname(importer) === dirname(destination)
		? []
		: locationSensitiveLines(importer, source).filter(line => !handled.has(line)).map(line =>
			`${destination}:${line} uses import.meta in a way the move cannot rewrite`
		);
	let text = source;
	for (const edit of edits.sort((left, right) => right.start - left.start)) {
		text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
	}
	return { text, count: edits.length, problems, review };
}

const transpilers = { ts: new Bun.Transpiler({ loader: 'ts' }), js: new Bun.Transpiler({ loader: 'js' }) };

function scannedImports(path: string, source: string): string[] {
	const loader = path.endsWith('.js') || path.endsWith('.mjs') ? transpilers.js : transpilers.ts;
	const body = path.endsWith('.astro') ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '' : source;
	const text = body.slice(shebangLength(body));
	return loader.scanImports(text).map(entry => entry.path);
}

const verify = Effect.fn('verify')(function*(
	importer: string,
	destination: string,
	source: string,
	text: string,
	before: Layout,
	after: Layout,
) {
	const problems: string[] = [];
	const scanned = yield* Effect.try({
		try: () => scannedImports(destination, text),
		catch: error => `${importer}: Bun cannot scan its imports (${String(error)})`,
	}).pipe(Effect.catch(problem => Effect.sync(() => problems.push(problem)).pipe(Effect.as([]))));
	for (const specifier of scanned) {
		if (!isLocal(before.aliases, specifier) && !isLocal(after.aliases, specifier)) continue;
		if (resolveReference(after.aliases, after.files, destination, specifier) !== undefined) continue;
		if (
			!source.includes(specifier) || resolveReference(before.aliases, before.files, importer, specifier) === undefined
		) {
			continue;
		}
		problems.push(`${importer}: the move would break ${specifier}`);
	}
	return problems;
});

const addAliases = Effect.fn('addAliases')(function*(root: string, aliases: readonly Alias[]) {
	if (!aliases.length) return;
	const path = join(root, 'tsconfig.json');
	const text = yield* attemptPromise(() => Bun.file(path).text());
	const tree = parseTree(text);
	const last = tree && findNodeAtLocation(tree, ['compilerOptions', 'paths'])?.children?.at(-1);
	if (!last) return yield* refuse('tsconfig.json has no compilerOptions.paths entries');
	const end = last.offset + last.length;
	const indent = /[\t ]*$/.exec(text.slice(0, last.offset))?.[0] ?? '';
	const lines = aliases.map(alias => `,\n${indent}${JSON.stringify(alias.pattern)}: ${JSON.stringify(alias.targets)}`);
	yield* attemptPromise(() => Bun.write(path, `${text.slice(0, end)}${lines.join('')}${text.slice(end)}`));
});

export const move = Effect.fn('move')(function*(
	root: string,
	pairs: readonly (readonly [string, string])[],
): Effect.fn.Return<MoveReport, ToolFailure> {
	const files = yield* trackedFiles(root);
	const plan = yield* expandPairs(files, pairs);
	const aliases = yield* readAliases(root);
	const addedAliases = packageAliases(aliases, plan.files);
	const before: Layout = { aliases, files: new Set(files) };
	const after: Layout = {
		aliases: [...aliases, ...addedAliases],
		files: new Set(files.map(file => plan.files.get(file) ?? file)),
	};
	const problems = yield* occupied(root, plan.files.values());
	const writes = new Map<string, string>();
	const review: string[] = [];
	let rewritten = 0;
	for (const file of files.filter(isCode)) {
		const destination = plan.files.get(file) ?? file;
		const source = yield* attemptPromise(() => Bun.file(join(root, file)).text());
		const result = rewrite(source, file, destination, before, after, plan);
		problems.push(...result.problems, ...(yield* verify(file, destination, source, result.text, before, after)));
		review.push(...result.review);
		if (result.count === 0) continue;
		rewritten += result.count;
		writes.set(destination, result.text);
	}
	if (problems.length) return yield* refuse(`Nothing moved:\n${problems.join('\n')}`);
	for (const [from, to] of plan.files) {
		yield* attemptPromise(() => mkdir(dirname(join(root, to)), { recursive: true }));
		yield* run(['git', 'mv', from, to], { cwd: root });
	}
	for (const [path, text] of writes) yield* attemptPromise(() => Bun.write(join(root, path), text));
	yield* addAliases(root, addedAliases);
	const mentions = new Set<string>();
	for (const from of new Set([...plan.files.keys(), ...plan.directories.map(([from]) => from)])) {
		const found = yield* capture(['git', 'grep', '-n', '-F', '-e', from, '--', ':!bun.lock'], { cwd: root }).pipe(
			Effect.orElseSucceed(() => ''),
		);
		for (const line of found.split('\n')) if (line) mentions.add(line);
	}
	return {
		moved: plan.files.size,
		rewritten,
		files: writes.size,
		addedAliases: addedAliases.map(alias => alias.pattern),
		mentions: [...mentions].sort(),
		review,
	};
});

export const moveCommand = Effect.fn('moveCommand')(function*(root: string, positionals: readonly string[]) {
	if (!positionals.length || positionals.length % 2) return yield* refuse('Usage: move <from> <to> [<from> <to>...]');
	const pairs = positionals.flatMap((value, index) => {
		const to = positionals[index + 1];
		return index % 2 === 0 && to !== undefined ? [[value, to] as const] : [];
	});
	const report = yield* move(root, pairs);
	const lines = [
		`Moved ${report.moved} files; rewrote ${report.rewritten} references in ${report.files} files`,
		...report.addedAliases.map(alias => `Added tsconfig path ${alias}`),
		...report.mentions.map(mention => `Still mentions the old path: ${mention}`),
		...report.review.map(line => `Review: ${line}`),
	];
	return lines.join('\n');
});

if (import.meta.main) {
	await main(Effect.gen(function*() {
		const { positionals } = yield* checkArguments(true);
		console.log(yield* moveCommand(process.cwd(), positionals));
	}));
}
