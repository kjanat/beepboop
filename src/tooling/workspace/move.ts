import { lstat, mkdir } from 'node:fs/promises';
import { basename, dirname, join, posix, relative } from 'node:path';
import { Effect } from 'effect';
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import type { ToolFailure } from '@/tooling/runtime';
import { attemptPromise, capture, checkArguments, main, refuse, run } from '@/tooling/runtime';
import type { Workspace } from '@/tooling/workspace/manifests';
import { exported, exportSpecifiers, readWorkspaces, workspaceOf } from '@/tooling/workspace/manifests';
import type { Alias } from '@/tooling/workspace/modules';
import {
	isCode,
	isRelative,
	locationSensitiveLines,
	looseReferences,
	packageOf,
	pathReferences,
	queryOf,
	readAliases,
	references,
	relativeSpecifier,
	repositoryPath,
	resolveReference,
	shebangLength,
	specifierCandidates,
	splitQuery,
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
	readonly workspaces: readonly Workspace[];
}

function resolve(layout: Layout, importer: string, specifier: string): string | undefined {
	const local = resolveReference(layout.aliases, layout.files, importer, specifier);
	if (local !== undefined) return local;
	const workspace = workspaceOf(layout.workspaces, specifier);
	return workspace ? exported(workspace, layout.files, specifier) : undefined;
}

function candidates(layout: Layout, importer: string, specifier: string, expected: string): string[] {
	const query = queryOf(specifier);
	const workspace = workspaceOf(layout.workspaces, specifier);
	return workspace
		? exportSpecifiers(workspace, expected, query)
		: specifierCandidates(layout.aliases, importer, expected, query);
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
			for (const file of inside) moves.set(file, repositoryPath(posix.join(to, file.slice(from.length + 1))));
		} else return yield* refuse(`Not a tracked file or directory: ${rawFrom}`);
	}
	const targets = [...moves.values()];
	const outside = targets.find(target =>
		target === '' || target === '..' || target.startsWith('../') || target.startsWith('/')
	);
	if (outside !== undefined) return yield* refuse(`Move target leaves the repository: ${outside || '.'}`);
	const clash = targets.find((target, index) => targets.indexOf(target) !== index || files.includes(target));
	if (clash) return yield* refuse(`Move target already exists or repeats: ${clash}`);
	return { files: moves, directories };
});

const preflight = Effect.fn('preflight')(function*(root: string, plan: Plan) {
	const problems: string[] = [];
	const kind = (path: string) =>
		attemptPromise(() =>
			lstat(join(root, path)).then(stats => stats.isDirectory() ? 'directory' : 'file', () => 'none')
		);
	const targets = new Set(plan.files.values());
	for (const [source, target] of plan.files) {
		if ((yield* kind(source)) !== 'file') problems.push(`${source} is tracked but missing from the worktree`);
		if ((yield* kind(target)) !== 'none') problems.push(`${target} already exists on disk`);
		for (let parent = dirname(target); parent !== '.' && parent !== '/'; parent = dirname(parent)) {
			if (targets.has(parent)) problems.push(`${target} would sit under the planned file ${parent}`);
			else if ((yield* kind(parent)) === 'file') problems.push(`${target} would sit under the file ${parent}`);
		}
	}
	return problems;
});

function packageAliases(aliases: readonly Alias[], moves: ReadonlyMap<string, string>) {
	const added = new Map<string, Alias>();
	const problems: string[] = [];
	for (const target of moves.values()) {
		const name = packageOf(target);
		if (!name || !target.startsWith(`packages/${name}/src/`) || added.has(name)) continue;
		const source = `./packages/${name}/src/*`;
		if (aliases.some(alias => alias.targets.includes(source))) continue;
		const pattern = `@/${name}/*`;
		const taken = aliases.find(alias => alias.pattern === pattern);
		if (taken) problems.push(`tsconfig.json already maps ${pattern} to ${taken.targets.join(', ')}`);
		else added.set(name, { pattern, targets: [source] });
	}
	return { added: [...added.values()], problems };
}

function isDirectory(files: ReadonlySet<string>, path: string): boolean {
	if (path === '') return true;
	for (const file of files) if (file.startsWith(`${path}/`)) return true;
	return false;
}

function mapDirectory(plan: Plan, files: ReadonlySet<string>, path: string, dynamic: boolean): string | undefined {
	const prefix = path === '' ? '' : `${path}/`;
	const inside = [...files].filter(candidate => candidate.startsWith(prefix));
	const follows = (mapped: string) =>
		inside.every(candidate => plan.files.get(candidate) === `${mapped}/${candidate.slice(prefix.length)}`);
	for (const [from, to] of plan.directories) {
		if (path !== from && !path.startsWith(`${from}/`)) continue;
		const mapped = repositoryPath(posix.join(to, path.slice(from.length)));
		if (follows(mapped)) return mapped;
	}
	const moved = inside.filter(candidate => plan.files.has(candidate));
	if (!moved.length || (!dynamic && moved.length < inside.length)) return path;
	const [first] = moved;
	const target = first === undefined ? undefined : plan.files.get(first);
	if (first === undefined || target === undefined) return undefined;
	const suffix = first.slice(prefix.length);
	if (!target.endsWith(`/${suffix}`)) return undefined;
	const mapped = target.slice(0, target.length - suffix.length - 1);
	const consistent = inside.every(candidate =>
		(plan.files.get(candidate) ?? candidate) === `${mapped}/${candidate.slice(prefix.length)}`
	);
	return consistent ? mapped : undefined;
}

function mapLocation(plan: Plan, files: ReadonlySet<string>, path: string, dynamic: boolean): string | undefined {
	const file = plan.files.get(path);
	if (file !== undefined) return file;
	if (files.has(path)) return path;
	if (isDirectory(files, path)) return mapDirectory(plan, files, path, dynamic);
	if (!dynamic) return path;
	const parent = repositoryPath(dirname(path));
	const mapped = isDirectory(files, parent) ? mapDirectory(plan, files, parent, true) : parent;
	return mapped === undefined ? undefined : posix.join(mapped, basename(path));
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
	const review: string[] = [];
	const moved = destination !== importer;
	for (const reference of references(importer, source)) {
		const target = resolve(before, importer, reference.specifier);
		const [path, query] = splitQuery(reference.specifier);
		if (target === undefined) {
			if (!moved || !isRelative(path)) continue;
			const text = `${relativeSpecifier(destination, repositoryPath(join(dirname(importer), path)))}${query}`;
			if (text !== reference.specifier) edits.push({ start: reference.start, end: reference.end, text });
			continue;
		}
		const expected = plan.files.get(target) ?? target;
		if (resolve(after, destination, reference.specifier) === expected) continue;
		const replacement = candidates(after, destination, reference.specifier, expected).find(candidate =>
			resolve(after, destination, candidate) === expected
		);
		if (replacement === undefined) problems.push(`${importer}: no specifier reaches ${expected} from ${destination}`);
		else edits.push({ start: reference.start, end: reference.end, text: replacement });
	}
	const handled = new Set<number>();
	for (const reference of pathReferences(importer, source)) {
		handled.add(reference.line);
		const trailing = reference.path.endsWith('/') ? '/' : '';
		const old = repositoryPath(join(dirname(importer), reference.path));
		const mapped = mapLocation(plan, before.files, old, reference.dynamic);
		if (mapped === undefined) {
			review.push(`${destination}:${reference.line} ${reference.path} names files that move to different places`);
			continue;
		}
		if (repositoryPath(join(dirname(destination), reference.path)) === mapped) continue;
		if (!reference.rewritable) {
			review.push(`${destination}:${reference.line} ${reference.path} needs a manual rewrite to reach ${mapped}`);
			continue;
		}
		const path = `${relativePath(dirname(destination), mapped, reference.path)}${trailing}`;
		edits.push({
			start: reference.start,
			end: reference.end,
			text: reference.quote ? `${reference.quote}${path}${reference.quote}` : path,
		});
	}
	if (moved) {
		for (const line of locationSensitiveLines(importer, source)) {
			if (!handled.has(line)) review.push(`${destination}:${line} uses import.meta in a way the move cannot rewrite`);
		}
	}
	let text = source;
	for (const edit of edits.sort((left, right) => right.start - left.start)) {
		text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
	}
	return { text, count: edits.length, problems, review };
}

const transpilers = {
	ts: new Bun.Transpiler({ loader: 'ts' }),
	tsx: new Bun.Transpiler({ loader: 'tsx' }),
	js: new Bun.Transpiler({ loader: 'js' }),
};

function scannedImports(path: string, source: string): string[] {
	const loader = path.endsWith('.js') || path.endsWith('.mjs')
		? transpilers.js
		: path.endsWith('.tsx')
		? transpilers.tsx
		: transpilers.ts;
	const body = path.endsWith('.astro') ? /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '' : source;
	return loader.scanImports(body.slice(shebangLength(body))).map(entry => entry.path);
}

export const verify = Effect.fn('verify')(function*(
	importer: string,
	destination: string,
	source: string,
	text: string,
	before: Layout,
	after: Layout,
	plan: Plan,
) {
	const problems: string[] = [];
	const scan = (path: string, body: string) =>
		Effect.try({
			try: () => scannedImports(path, body),
			catch: error => `${importer}: Bun cannot scan its imports (${String(error)})`,
		}).pipe(Effect.catch(problem => Effect.sync(() => problems.push(problem)).pipe(Effect.as([]))));
	const expected = new Map<string, string>();
	const original = [
		...looseReferences(importer, source).map(reference => reference.specifier),
		...(yield* scan(importer, source)),
	];
	for (const specifier of original) {
		const target = resolve(before, importer, specifier);
		if (target !== undefined) expected.set(specifier, plan.files.get(target) ?? target);
	}
	const specifiers = new Set([
		...looseReferences(destination, text).map(reference => reference.specifier),
		...(yield* scan(destination, text)),
	]);
	for (const specifier of specifiers) {
		const want = expected.get(specifier);
		if (want === undefined) continue;
		if (resolve(after, destination, specifier) !== want) {
			problems.push(`${importer}: the move would break ${specifier}`);
		}
	}
	return problems;
});

const aliasEdit = Effect.fn('aliasEdit')(function*(root: string, aliases: readonly Alias[]) {
	const path = join(root, 'tsconfig.json');
	const text = yield* attemptPromise(() => Bun.file(path).text());
	if (!aliases.length) return { path, text, problem: undefined };
	const tree = parseTree(text);
	const last = tree && findNodeAtLocation(tree, ['compilerOptions', 'paths'])?.children?.at(-1);
	if (!last) return { path, text, problem: 'tsconfig.json has no compilerOptions.paths entries' };
	const end = last.offset + last.length;
	const indent = /[\t ]*$/.exec(text.slice(0, last.offset))?.[0] ?? '';
	const lines = aliases.map(alias => `,\n${indent}${JSON.stringify(alias.pattern)}: ${JSON.stringify(alias.targets)}`);
	return { path, text: `${text.slice(0, end)}${lines.join('')}${text.slice(end)}`, problem: undefined };
});

export const move = Effect.fn('move')(function*(
	root: string,
	pairs: readonly (readonly [string, string])[],
): Effect.fn.Return<MoveReport, ToolFailure> {
	const files = yield* trackedFiles(root);
	const plan = yield* expandPairs(files, pairs);
	const aliases = yield* readAliases(root);
	const { added: addedAliases, problems: aliasProblems } = packageAliases(aliases, plan.files);
	const workspaces = [...(yield* readWorkspaces(root, files)).values()];
	const before: Layout = { aliases, files: new Set(files), workspaces };
	const after: Layout = {
		aliases: [...aliases, ...addedAliases],
		files: new Set(files.map(file => plan.files.get(file) ?? file)),
		workspaces: workspaces.map(workspace => {
			const manifest = plan.files.get(`${workspace.base}/package.json`);
			return manifest ? { ...workspace, base: dirname(manifest) } : workspace;
		}),
	};
	const problems = [...aliasProblems, ...(yield* preflight(root, plan))];
	const tsconfig = yield* aliasEdit(root, addedAliases);
	if (tsconfig.problem) problems.push(tsconfig.problem);
	const writes = new Map<string, string>();
	const review: string[] = [];
	let rewritten = 0;
	for (const file of files.filter(isCode)) {
		if (problems.some(problem => problem.startsWith(`${file} is tracked but missing`))) continue;
		const destination = plan.files.get(file) ?? file;
		const source = yield* attemptPromise(() => Bun.file(join(root, file)).text());
		const result = rewrite(source, file, destination, before, after, plan);
		problems.push(...result.problems, ...(yield* verify(file, destination, source, result.text, before, after, plan)));
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
	if (addedAliases.length) yield* attemptPromise(() => Bun.write(tsconfig.path, tsconfig.text));
	const mentions = new Set<string>();
	for (const from of new Set([...plan.files.keys(), ...plan.directories.map(([from]) => from)])) {
		const found = yield* capture(['git', 'grep', '-n', '-F', '-e', from, '--', ':!bun.lock'], { cwd: root }).pipe(
			Effect.orElseSucceed(() => ''),
		);
		const boundary = new RegExp(`(?<![\\w./-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
		for (const line of found.split('\n')) {
			const content = /^[^:]*:\d+:(.*)$/.exec(line)?.[1];
			if (content !== undefined && boundary.test(content)) mentions.add(line);
		}
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
