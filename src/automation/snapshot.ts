import { Effect, Result } from 'effect';
import { pkgbuildFile } from '@/automation/managers/channels';
import { object, yaml } from '@/automation/managers/helpers';
import { tagQueries } from '@/automation/managers/tags';
import { workspaceMembers } from '@/automation/managers/workspaces';
import { bindInputs, matrixCombinations, substitute } from '@/automation/release-graph/bindings';
import {
	actionBindings,
	liveJobs,
	localAction,
	workflowCalls,
	workflowDocuments,
	workflowEvents,
} from '@/automation/release-graph/calls';
import { directoryFlagPattern, selectorFlagPattern } from '@/automation/release-graph/package-managers';
import { escapeRegExp, within } from '@/automation/release-graph/shell';
import { literalPrefix } from '@/automation/release-graph/workflows';
import type { Snapshot } from '@/automation/types';
import { isLockfile, managerNames, managerSpec } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { safeVersionPath } from '@/contract/version-files';
import { parentDirectory } from '@/relative-path';

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
	/^\.tool-versions$/,
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
	const documents = workflowDocuments(read);
	const { calls } = workflowCalls(documents, repository);
	const composite = (action: string, supplied: Record<string, unknown>, trail: readonly string[]): string[] => {
		if (trail.includes(action)) return [];
		const { definition, bindings } = actionBindings(
			read.get(`${action}/action.yml`) ?? read.get(`${action}/action.yaml`),
			supplied,
		);
		const steps = definition.steps;
		return (Array.isArray(steps) ? steps : []).flatMap(entry => {
			const step = object(entry);
			const nested = typeof step.uses === 'string' ? localAction(step.uses) : undefined;
			return [
				...(typeof step['working-directory'] === 'string' ? [bindInputs(step['working-directory'], bindings)] : []),
				...(nested
					? composite(
						nested,
						Object.fromEntries(
							Object.entries(object(step.with)).map((
								[key, value],
							) => [key, typeof value === 'string' ? bindInputs(value, bindings) : value]),
						),
						[...trail, action],
					)
					: []),
			];
		});
	};
	return documents.flatMap(({ file, document }) =>
		liveJobs(document).flatMap(([, job]) => {
			const combinations = matrixCombinations(object(object(job.strategy).matrix)).concat([{}]);
			const incoming = calls.filter(call => call.callee.file === file).map(call => call.bindings);
			const bindings = incoming.length ? incoming : [{}];
			const steps = (Array.isArray(job.steps) ? job.steps : []).map(object);
			const declared = [
				object(object(job.defaults).run)['working-directory'],
				...steps.map(step => step['working-directory']),
			].filter((value): value is string => typeof value === 'string' && value.includes('${{'));
			const applied = steps.flatMap(step => {
				const action = typeof step.uses === 'string' ? localAction(step.uses) : undefined;
				return action ? [{ action, supplied: object(step.with) }] : [];
			});
			return combinations.flatMap(combination =>
				bindings.flatMap(binding => {
					const bind = (value: string) => bindInputs(substitute(value, combination), binding);
					return [
						...declared.map(bind),
						...applied.flatMap(({ action, supplied }) =>
							composite(
								action,
								Object.fromEntries(
									Object.entries(supplied).map((
										[key, value],
									) => [key, typeof value === 'string' ? bind(value) : value]),
								),
								[],
							)
						),
					].map(value => value.replace(/^\.\//, '').replace(/\/$/, ''));
				})
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
	const taskDirectories = [...read].flatMap(([path, source]) =>
		/(?:^|\/)\.?mise(?:\.[\w-]+)?\.toml$/.test(path)
			? [...source.matchAll(/^\s*dir\s*=\s*["']([^"']+)["']/gm)].flatMap(match =>
				within(
					path.replace(/\/?(?:\.config\/)?[^/]*$/, ''),
					(match[1] ?? '').replace(/^\{\{\s*config_root\s*\}\}\/?/, '').replace(/^\.\//, '').replace(/\/$/, ''),
				)
			)
			: []
	);
	const changes = /(?:^|[;&|(]|&&|\brun:)\s*cd\s+["']?(?:\.\/)?([\w.-][\w./-]*?)\/?["']?(?=\s|$|[;&|)])/g;
	const chained: string[] = [];
	let current = '';
	for (const line of text.split('\n')) {
		if (/^\s*-\s|\brun:/.test(line)) current = '';
		for (const change of line.matchAll(changes)) {
			current = within(current, change[1] ?? '');
			if (current) chained.push(current);
		}
	}
	const configured = [...text.matchAll(/working-directory:\s*["']?(?:\.\/)?([\w./-]+?)\/?["']?\s*$/gm)].flatMap(
		match => match[1] ?? [],
	);
	const crossed = configured.flatMap(directory =>
		[...text.matchAll(changes)].map(change => within(directory, change[1] ?? ''))
	);
	const directories = [
		...new Set(
			[
				...text.matchAll(/working-directory:\s*["']?(?:\.\/)?([\w./-]+?)\/?["']?\s*$/gm),
				...text.matchAll(/(?:^|[;&|(]|&&|\brun:)\s*cd\s+["']?(?:\.\/)?([\w.-][\w./-]*?)\/?["']?(?=\s|$|[;&|)])/gm),
				...text.matchAll(
					new RegExp(
						`(?:^|\\s)(?:${directoryFlagPattern}|${selectorFlagPattern})[= ]["']?(?:\\./)?([\\w.-][\\w./-]*?)/?["']?(?=\\s|$|[;&|)"'])`,
						'gm',
					),
				),
			].flatMap(match => match[1] ?? []).concat(matrixDirectories, taskDirectories, chained, crossed),
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
			|| taskFile.test(path) && directories.includes(parentDirectory(path))
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
		for (;;) {
			const member = workspaceMembers(path => read.get(path), [...read.keys()]);
			const claimed = blobs.filter(path =>
				!requested.has(path) && excluded.test(path) && (marker(path) || content(path))
				&& member(parentDirectory(path))
			);
			if (!claimed.length) break;
			if (requested.size + claimed.length > 400) return yield* precondition('Discovery file limit exceeded');
			for (const path of claimed) {
				requested.add(path);
				included.push(path);
				if (marker(path)) blank.add(path);
			}
			yield* readAll(claimed.filter(path => !blank.has(path)));
		}
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
		const releaseEvents = workflowDocuments(read).some(({ document }) => workflowEvents(document).includes('release'));
		const queries = releaseEvents ? [...prefixes, ''] : prefixes;
		const tags = queries.length ? [...new Set(yield* source.tags(queries))].sort() : undefined;
		const links = source.entries.filter(entry => entry.type === 'blob' && entry.mode === '120000').map(entry =>
			entry.path
		);
		return {
			repository: source.repository,
			sha: source.sha,
			files,
			paths: blobs,
			...(links.length ? { links } : {}),
			...(tags ? { tags } : {}),
		};
	});
}
