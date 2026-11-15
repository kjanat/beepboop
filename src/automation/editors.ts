import { Effect, Result } from 'effect';
import { parse as parseToml, TomlError } from 'smol-toml';
import { isScalar } from 'yaml';
import { validYaml, yamlData, yamlDocument } from '@/automation/managers/helpers';
import type { Edit, ReleasePlan, Snapshot } from '@/automation/types';
import { isLockfile } from '@/contract/catalog';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import type { VersionFile } from '@/contract/version-files';
import { textVersionPattern } from '@/contract/version-files';
import { fromSync } from '@/failure';
import { semver } from '@/model';

function toml(source: string) {
	return Effect.suspend(() => Result.match(Result.try(() => parseToml(source)), {
		onSuccess: Effect.succeed,
		onFailure: error => error instanceof TomlError ? Effect.fail(precondition(error.message)) : Effect.die(error),
	}));
}

function valueAt(data: unknown, key: (string | number)[]): Effect.Effect<unknown, DomainError> {
	return Effect.gen(function*() {
		for (const part of key) {
			if (!data || typeof data !== 'object' || !Object.hasOwn(data, part)) {
				return yield* precondition('Version field is missing');
			}
			data = Reflect.get(data, part);
		}
		return data;
	});
}

function textMatches(source: string, rule: Extract<VersionFile, { format: 'text' }>) {
	return Result.gen(function*() {
		const spans: { from: number; to: number; value: string }[] = [];
		if ('pattern' in rule) {
			const pattern = yield* textVersionPattern(rule.pattern).pipe(
				Result.mapError(() => precondition('Invalid text version pattern')),
			);
			for (const match of source.matchAll(pattern)) {
				const span = match.indices?.groups?.version;
				if (!span || span[0] === span[1]) {
					return yield* Result.fail(
						precondition('Text pattern must capture a nonempty named version group in every match'),
					);
				}
				const previous = spans.at(-1);
				if (previous && span[0] < previous.to) return yield* Result.fail(precondition('Text version captures overlap'));
				spans.push({ from: span[0], to: span[1], value: source.slice(...span) });
			}
		} else {
			let cursor = 0;
			while (cursor < source.length) {
				const start = source.indexOf(rule.prefix, cursor);
				if (start < 0) break;
				const from = start + rule.prefix.length;
				const to = source.indexOf(rule.suffix, from);
				if (to < 0) return yield* Result.fail(precondition('Text suffix is missing'));
				const next = source.indexOf(rule.prefix, from);
				if (next >= 0 && next < to) {
					return yield* Result.fail(precondition('Text prefix appears before the preceding suffix'));
				}
				spans.push({ from, to, value: source.slice(from, to) });
				cursor = to + rule.suffix.length;
			}
		}
		if (!spans.length) return yield* Result.fail(precondition('Text version rule must match at least once'));
		return spans;
	});
}

type StructuredVersionFile = Exclude<VersionFile, { format: 'text' }>;

function edit(source: string, rule: StructuredVersionFile, version: string): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const value = rule.template.replaceAll('{version}', version);
		if (rule.format === 'toml') {
			const prior = yield* valueAt(yield* toml(source), rule.key);
			if (typeof prior !== 'string') return yield* precondition('TOML version field must be a string');
			let section: string[] = [], count = 0;
			const result = source.split('\n').map(line => {
				const heading = line.match(/^\s*\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/);
				if (heading) section = (heading[1] ?? '').split('.');
				else if (/^\s*\[/.test(line)) section = ['<unsupported table>'];
				const match = line.match(/^(\s*)([A-Za-z0-9_.-]+)(\s*=\s*)("(?:[^"\\]|\\.)*"|'[^']*')(\s*(?:#.*)?\r?)$/);
				if (!match || JSON.stringify([...section, ...(match[2] ?? '').split('.')]) !== JSON.stringify(rule.key)) {
					return line;
				}
				count++;
				return `${match[1]}${match[2]}${match[3]}${JSON.stringify(value)}${match[5]}`;
			}).join('\n');
			if (count !== 1 || (yield* valueAt(yield* toml(result), rule.key)) !== value) {
				return yield* precondition('Cannot safely locate TOML version field');
			}
			return result;
		}
		if (rule.format === 'json') yield* fromSync((): unknown => JSON.parse(source));
		const document = yield* Effect.fromResult(validYaml(source, 'Invalid version document'));
		const node = document.getIn(rule.key, true);
		if (!isScalar(node) || typeof node.value !== 'string' || !node.range) {
			return yield* precondition('Version field must be a scalar string');
		}
		if (node.anchor || node.tag || node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') {
			return yield* precondition('Version field cannot use anchors, tags, or block scalars');
		}
		const result = source.slice(0, node.range[0]) + JSON.stringify(value) + source.slice(node.range[1]);
		const updated = yield* Effect.fromResult(validYaml(result, 'Version edit produced invalid syntax'));
		const data = yield* fromSync((): unknown => rule.format === 'json' ? JSON.parse(result) : yamlData(updated));
		if ((yield* valueAt(data, rule.key)) !== value) {
			return yield* precondition('Version edit did not update the selected field');
		}
		return result;
	});
}

function currentValue(source: string, rule: StructuredVersionFile): Effect.Effect<unknown, DomainError> {
	const data = rule.format === 'toml'
		? toml(source)
		: fromSync((): unknown => rule.format === 'json' ? JSON.parse(source) : yamlData(yamlDocument(source)));
	return data.pipe(Effect.flatMap(data => valueAt(data, rule.key)));
}

/** Compose version fields without overwriting a different adapter's chosen version. */
export const applyVersionFiles = Effect.fn('applyVersionFiles')(function*(
	snapshot: Snapshot,
	files: Record<string, string>,
	rules: VersionFile[],
	versions: Record<string, string>,
): Effect.fn.Return<void, DomainError> {
	const selected = new Set<string>();
	for (const rule of rules) {
		const group = rule.group ?? (Object.keys(versions).length === 1 ? Object.keys(versions)[0] : undefined);
		const version = group && Object.hasOwn(versions, group) ? versions[group] : undefined;
		if (!version) return yield* precondition(`Version file needs a known release group: ${rule.path}`);
		const selector = rule.format === 'text'
			? 'pattern' in rule ? rule.pattern : [rule.prefix, rule.suffix]
			: rule.key;
		const identity = JSON.stringify([rule.path, selector]);
		if (selected.has(identity)) return yield* precondition(`Duplicate version field: ${rule.path}`);
		selected.add(identity);
		const original = snapshot.files[rule.path];
		const current = files[rule.path];
		if (original === undefined || current === undefined) {
			return yield* precondition(`Version file is missing: ${rule.path}`);
		}
		const target = rule.template.replaceAll('{version}', version);
		if (rule.format === 'text') {
			const prior = yield* Effect.fromResult(textMatches(original, rule));
			const existing = original === current ? prior : yield* Effect.fromResult(textMatches(current, rule));
			if (
				prior.length !== existing.length
				|| existing.some((match, index) => match.value !== prior[index]?.value && match.value !== target)
			) {
				return yield* precondition(`Conflicting version edit: ${rule.path}`);
			}
			let result = '', cursor = 0;
			for (const { from, to } of existing) {
				result += current.slice(cursor, from) + target;
				cursor = to;
			}
			files[rule.path] = result + current.slice(cursor);
			continue;
		}
		yield* edit(original, rule, version);
		const prior = yield* currentValue(original, rule), existing = yield* currentValue(current, rule);
		if (prior !== existing && existing !== target) {
			return yield* precondition(`Conflicting version edit: ${rule.path}`);
		}
		files[rule.path] = yield* edit(current, rule, version);
	}
});

export function fileEdits(
	original: Readonly<Record<string, string>>,
	files: Iterable<readonly [string, string]>,
): Effect.Effect<Edit[], DomainError> {
	return Effect.gen(function*() {
		const edits: Edit[] = [];
		for (const [path, after] of files) {
			const before = original[path];
			if (before === undefined) return yield* precondition('Missing planned manifest');
			if (before !== after) edits.push({ path, before, after });
		}
		return edits;
	});
}

export const planVersionFiles = Effect.fn('planVersionFiles')(function*(
	snapshot: Snapshot,
	target: unknown,
	rules: VersionFile[],
): Effect.fn.Return<ReleasePlan, DomainError> {
	const version = (yield* Effect.fromResult(semver(target))).replace(/^v/, '');
	const files = { ...snapshot.files };
	yield* applyVersionFiles(snapshot, files, rules, { release: version });
	const edits = yield* fileEdits(snapshot.files, Object.entries(files));
	const requiresPreparation = edits.length > 0
		&& Object.keys(files).some(isLockfile);
	return planned(snapshot, version, edits, requiresPreparation);
});
function planned(
	snapshot: Snapshot,
	version: string,
	edits: ReleasePlan['edits'],
	requiresPreparation: boolean,
): ReleasePlan {
	return {
		lockfiles: Object.keys(snapshot.files).filter(isLockfile),
		version,
		sourceSha: snapshot.sha,
		packages: [],
		requiresPreparation,
		diagnostics: requiresPreparation
			? ['Preparation workflow must regenerate lockfiles before promotion']
			: edits.length
			? []
			: [alreadyPrepared(version, snapshot.sha)],
		edits,
	};
}
export function alreadyPrepared(version: string, commit: string): string {
	return `Commit ${
		commit.slice(0, 12)
	} already carries ${version}. Preparing creates its promotion without a pull request.`;
}
