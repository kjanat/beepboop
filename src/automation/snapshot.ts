import { Effect, Result } from 'effect';
import { safeVersionPath } from '@/automation/editors';
import { pkgbuildFile } from '@/automation/managers/channels';
import { object, yaml } from '@/automation/managers/helpers';
import { tagQueries } from '@/automation/managers/tags';
import {
	bindInputs,
	escapeRegExp,
	inputDefaults,
	literalBindings,
	literalPrefix,
	matrixCombinations,
	substitute,
	within,
} from '@/automation/release-graph/workflows';
import type { Snapshot } from '@/automation/types';
import { isLockfile, managerNames, managerSpec } from '@/contract/catalog';
import { type DomainError, precondition } from '@/contract/errors';

export interface TreeEntry {
	path: string;
	type: string;
	mode: string;
}
export interface SnapshotSource {
	repository: Snapshot['repository'];
	sha: string;
	entries: readonly TreeEntry[];
	read(path: string): Effect.Effect<string | null, DomainError>;
	tags(prefixes: readonly string[]): Effect.Effect<string[], DomainError>;
}

const excluded = /(?:^|\/)(?:node_modules|vendor|target|testdata|fixtures|\.git)\//;
export const releaseEvidence: readonly RegExp[] = [
	/^\.github\/actions\/.+\.(?:ya?ml|[cm]?[jt]s|sh|py)$/,
	/^\.github\/(?!workflows\/)[^/]+\/.+\.(?:py|sh|bash|ps1|[cm]?[jt]s|rb)$/,
	/^\.github\/workflows\/[^/]+\.[cm]?[jt]s$/,
	/(?:^|\/)\.?nfpm[^/]*\.ya?ml$/,
	/^(?:[^/]+\/)?(?:Makefile|GNUmakefile|[Jj]ustfile|\.justfile)$/,
	/(?:^|\/)pyproject\.toml$/,
	/(?:^|\/)extension\.toml$/,
	/(?:^|\/)\.vscodeignore$/,
	/(?:^|\/)(?:Dockerfile|Containerfile)(?:\.[^/]+)?$/,
	/(?:^|\/)targets\.json$/,
	/(?:^|\/)\.cargo\/config(?:\.toml)?$/,
	/^README\.md$/,
	/(?:^|\/)\.?mise(?:\.[\w-]+)?\.toml$/,
	/^(?:\.mise\/tasks|mise-tasks|\.config\/mise\/tasks)\/[^/]+$/,
];
const contents: readonly RegExp[] = [
	/^\.github\/beepboop\.json$/,
	/^pnpm-workspace\.ya?ml$/,
	/^actions\/(?:begin|prepare|report)\/action\.ya?ml$/,
	pkgbuildFile,
	...managerNames.flatMap(name => managerSpec(name).manifests),
	...releaseEvidence,
];
const markers: readonly RegExp[] = managerNames.flatMap(name => managerSpec(name).markers);

function marker(path: string): boolean {
	return isLockfile(path) || markers.some(pattern => pattern.test(path));
}
function content(path: string): boolean {
	return contents.some(pattern => pattern.test(path));
}

function workflowTagPrefixes(files: ReadonlyMap<string, string>): string[] {
	return [...files].flatMap(([path, source]) => {
		if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return [];
		const parsed = yaml(source);
		if (Result.isFailure(parsed)) return [];
		const tags = object(object(parsed.success.on).push).tags;
		const patterns: unknown[] = Array.isArray(tags) ? tags : [tags];
		return patterns.flatMap(pattern =>
			typeof pattern === 'string' && !pattern.startsWith('!') ? [literalPrefix(pattern)] : []
		);
	});
}

const script = /\.(?:sh|bash|ps1|py|[cm]?[jt]s|rb)$/;
const actionManifest = /(?:^|\/)action\.ya?ml$/;
const taskFile = /\/(?:Makefile|GNUmakefile|[Jj]ustfile|\.justfile|deno\.jsonc?|\.?mise(?:\.local)?\.toml)$/;
const recipe =
	/(?:^|\/)(?:Makefile|GNUmakefile|[Jj]ustfile|\.justfile|package\.json|deno\.jsonc?|\.?mise(?:\.local)?\.toml|\.config\/mise\.toml|(?:\.mise\/tasks|mise-tasks|\.config\/mise\/tasks)\/[^/]+)$/;
function workflowDirectories(read: ReadonlyMap<string, string>, repository: string): string[] {
	const documents = [...read].flatMap(([path, source]) => {
		if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return [];
		const parsed = yaml(source);
		return Result.isFailure(parsed)
			? []
			: [{ file: path.slice('.github/workflows/'.length), document: parsed.success }];
	});
	const ownWorkflow = new RegExp(`^(?:\\./|${escapeRegExp(repository)}/)\\.github/workflows/([^@]+?)(?:@.+)?$`, 'i');
	const calls = new Map<string, Record<string, string>[]>();
	for (const { document } of documents) {
		for (const entry of Object.values(object(document.jobs))) {
			const job = object(entry);
			const file = typeof job.uses === 'string' ? ownWorkflow.exec(job.uses)?.[1] : undefined;
			const callee = documents.find(candidate => candidate.file === file);
			if (!file || !callee) continue;
			const declared = object(object(callee.document.on).workflow_call).inputs;
			for (const assignment of matrixCombinations(object(object(job.strategy).matrix)).concat([{}])) {
				const supplied = Object.fromEntries(
					Object.entries(object(job.with)).map((
						[key, value],
					) => [key, typeof value === 'string' ? substitute(value, assignment) : value]),
				);
				calls.set(file, [
					...calls.get(file) ?? [],
					{ ...inputDefaults(declared, Object.keys(supplied)), ...literalBindings(supplied) },
				]);
			}
		}
	}
	return documents.flatMap(({ file, document }) =>
		Object.values(object(document.jobs)).flatMap(entry => {
			const job = object(entry);
			const combinations = matrixCombinations(object(object(job.strategy).matrix)).concat([{}]);
			const bindings = calls.get(file) ?? [{}];
			const declared = [
				object(object(job.defaults).run)['working-directory'],
				...(Array.isArray(job.steps) ? job.steps.map(step => object(step)['working-directory']) : []),
			].filter((value): value is string => typeof value === 'string' && value.includes('${{'));
			return declared.flatMap(value =>
				combinations.flatMap(combination =>
					bindings.map(binding =>
						bindInputs(substitute(value, combination), binding).replace(/^\.\//, '').replace(/\/$/, '')
					)
				)
			).filter(value => value && !value.includes('${{'));
		})
	);
}

function referencedScripts(
	repository: string,
	blobs: readonly string[],
	read: ReadonlyMap<string, string>,
	requested: ReadonlySet<string>,
): string[] {
	const text = [...read].filter(([path]) =>
		path.startsWith('.github/') || recipe.test(path) || script.test(path) || actionManifest.test(path)
	).map(([, source]) => source).join('\n');
	const qualified = new RegExp(
		`\\buses:\\s*["']?${escapeRegExp(repository)}/([\\w./-]+?)/?@[^\\s"']+["']?\\s*$`,
		'gim',
	);
	const actions = [
		...new Set(
			[
				...text.matchAll(/\buses:\s*["']?(?:\.|\$)\/([\w./-]+?)\/?["']?\s*$/gm),
				...text.matchAll(qualified),
			].flatMap(match => match[1] ?? []),
		),
	];
	const matrixDirectories = workflowDirectories(read, repository);
	const directories = [
		...new Set(
			[
				...text.matchAll(/working-directory:\s*["']?(?:\.\/)?([\w./-]+?)\/?["']?\s*$/gm),
				...text.matchAll(/(?:^|[;&|(]|&&|\brun:)\s*cd\s+["']?(?:\.\/)?([\w.-][\w./-]*?)\/?["']?(?=\s|$|[;&|)])/gm),
				...text.matchAll(
					/(?:^|\s)(?:-C|--prefix|--cwd|--dir|-w|--workspace|--filter|-F)[= ]["']?(?:\.\/)?([\w.-][\w./-]*?)\/?["']?(?=\s|$|[;&|)"'])/gm,
				),
			].flatMap(match => match[1] ?? []).concat(matrixDirectories),
		),
	];
	const parents = new Set(
		[...text.matchAll(/(?<![\w./-])((?:\.\.\/)+[\w./-]*\w)/g)].flatMap(match =>
			['', ...directories].map(directory => within(directory, match[1] ?? ''))
		),
	);
	const modules = [...text.matchAll(/\bpython3?\s+-m\s+([A-Za-z_][\w.]*)/g)].flatMap(match => {
		const relative = (match[1] ?? '').replaceAll('.', '/');
		return ['', 'src', ...directories].flatMap(directory => {
			const base = directory ? `${directory}/${relative}` : relative;
			return [`${base}.py`, `${base}/__main__.py`];
		});
	});
	return blobs.filter(path =>
		!requested.has(path) && !excluded.test(path)
		&& (actions.some(action =>
			path.startsWith(`${action}/`)
			&& (script.test(path) || /^(?:action\.ya?ml|Dockerfile)$/.test(path.slice(action.length + 1)))
		)
			|| taskFile.test(path) && directories.includes(path.split('/').slice(0, -1).join('/'))
			|| modules.includes(path)
			|| script.test(path) && parents.has(path)
			|| script.test(path)
				&& (text.includes(path)
					|| directories.some(directory =>
						path.startsWith(`${directory}/`) && text.includes(path.slice(directory.length + 1))
					)))
	);
}

export function buildSnapshot(
	source: SnapshotSource,
	extraPaths: readonly string[] = [],
): Effect.Effect<Snapshot, DomainError> {
	return Effect.gen(function*() {
		if (extraPaths.some(path => !safeVersionPath(path))) return yield* precondition('Unsafe version file path');
		const blobs = source.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000').map(entry =>
			entry.path
		);
		if (extraPaths.some(path => !blobs.includes(path))) {
			return yield* precondition('Version file missing or not a regular file');
		}
		const included = blobs.filter(path => !excluded.test(path) && (marker(path) || content(path)));
		const blank = new Set(included.filter(path => marker(path) && !extraPaths.includes(path)));
		const fetched = [...new Set([...extraPaths, ...included.filter(path => !blank.has(path))])];
		if (fetched.length > 400) return yield* precondition('Discovery file limit exceeded');
		const read = new Map<string, string>();
		const readAll = (paths: readonly string[]) =>
			Effect.forEach(paths, path =>
				source.read(path).pipe(Effect.tap(text =>
					Effect.sync(() => {
						if (text !== null) read.set(path, text);
					})
				)), { concurrency: 8, discard: true });
		yield* readAll(fetched);
		const requested = new Set(fetched);
		for (
			let referenced = referencedScripts(source.repository.name, blobs, read, requested);
			referenced.length;
			referenced = referencedScripts(source.repository.name, blobs, read, requested)
		) {
			const batch = referenced.slice(0, Math.max(0, 400 - requested.size));
			if (!batch.length) break;
			for (const path of batch) requested.add(path);
			yield* readAll(batch);
		}
		const files: Record<string, string> = {};
		for (const path of blobs) {
			const text = blank.has(path) ? '' : read.get(path);
			if (text !== undefined) files[path] = text;
		}
		const prefixes = [
			...new Set([...tagQueries([...new Set([...extraPaths, ...included])]), ...workflowTagPrefixes(read)]),
		].filter((prefix, _, all) => !all.some(other => other !== prefix && prefix.startsWith(other))).sort();
		const tags = prefixes.length ? [...new Set(yield* source.tags(prefixes))].sort() : undefined;
		return { repository: source.repository, sha: source.sha, files, paths: blobs, ...(tags ? { tags } : {}) };
	});
}
