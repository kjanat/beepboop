import { CronExpressionParser } from 'cron-parser';
import { Effect, Result } from 'effect';
import { z } from 'zod';
import { inputSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { parseReleaseIdentity } from '@/automation/package-identity';
import { parsePresetReference } from '@/automation/preset';
import type { Configuration, Stream, WorkflowBinding } from '@/automation/types';
import { jobKeyPattern, managerNames, validRef, validTagPrefix, workflowFilePattern } from '@/contract/catalog';
import type { Diagnostic } from '@/contract/diagnostics';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { identifierPattern, shaPattern } from '@/contract/ids';
import { versionFileSchema } from '@/contract/version-files';
import { configurationDrift, configurationSchema } from '@/domain/configuration';
import { toDomainError } from '@/failure';
import { array, invalid, oneOf, record, strings, text } from '@/model';
import { purl } from '@/package-url';

type Invalid = DomainError | z.ZodError;
type Parsed<A> = Result.Result<A, Invalid>;

function lift<A>(run: () => A): Parsed<A> {
	return Result.try({ try: run, catch: error => error instanceof z.ZodError ? error : toDomainError(error) });
}
function packageReferences(value: unknown): Parsed<string[]> {
	return Result.gen(function*() {
		const references = yield* strings(value);
		return yield* Result.all(references.map(reference =>
			reference.startsWith('pkg:')
				? parseReleaseIdentity(reference).pipe(Result.map(purl), Result.mapError(toDomainError))
				: Result.succeed(reference)
		));
	});
}
function keys(data: Record<string, unknown>, allowed: string[], context: string): Parsed<void> {
	const unknown = Object.keys(data).find(key => !allowed.includes(key));
	return unknown === undefined ? Result.void : invalid(`${context}: unknown field ${unknown}`);
}
function parsedItems<A>(value: unknown, schema: z.ZodType<A>): Parsed<A[]> {
	return Result.gen(function*() {
		const items = yield* array(value);
		return yield* lift(() => items.map(item => schema.parse(item)));
	});
}
function winGetPolicy(value: unknown): Parsed<NonNullable<Configuration['winget']>> {
	return Result.gen(function*() {
		const row = yield* record(value);
		if (Object.keys(row).some(key => !['config', 'tagPrefix', 'automatic'].includes(key))) {
			return yield* invalid('Unknown WinGet setting');
		}
		const config = yield* text(row.config);
		if (!/^[\w./-]+\.json$/.test(config) || config.startsWith('/') || config.split('/').includes('..')) {
			return yield* invalid('Invalid WinGet configuration path');
		}
		const tagPrefix = row.tagPrefix === undefined ? 'v' : String(row.tagPrefix);
		if (!/^[\w.-]*$/.test(tagPrefix)) return yield* invalid('Invalid WinGet tag prefix');
		if (row.automatic !== undefined && typeof row.automatic !== 'boolean') {
			return yield* invalid('Invalid WinGet automatic setting');
		}
		return { config, tagPrefix, automatic: row.automatic === true };
	});
}
function workflowInput(value: unknown): Parsed<string | boolean | number> {
	return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
		? Result.succeed(value)
		: invalid('Invalid workflow input');
}
function binding(value: unknown): Parsed<WorkflowBinding> {
	return Result.gen(function*() {
		const data = yield* record(value);
		yield* keys(
			data,
			[
				'file',
				'ref',
				'inputs',
				'required',
				'needs',
				'needsJobs',
				'schedule',
				'publications',
				'mode',
				'each',
				'refs',
				'platform',
				'outputs',
				'artifactInputs',
			],
			'workflow',
		);
		const schedule = data.schedule === undefined ? undefined : yield* text(data.schedule);
		if (schedule !== undefined) {
			if (schedule.trim().split(/\s+/).length !== 5) return yield* invalid('Schedules use five-field UTC cron');
			yield* lift(() => CronExpressionParser.parse(schedule, { tz: 'UTC' }));
		}
		const mode = data.mode === undefined
			? undefined
			: yield* oneOf(data.mode, ['observe', 'dispatch'], 'Invalid workflow mode');
		const each = data.each === undefined ? undefined : yield* oneOf(data.each, ['package'], 'Invalid workflow each');
		if (each && (data.outputs !== undefined || data.artifactInputs !== undefined || data.refs !== undefined)) {
			return yield* invalid('Per-package workflows cannot declare outputs, artifact inputs or refs');
		}
		let refs: WorkflowBinding['refs'];
		if (data.refs !== undefined) {
			const policy = yield* record(data.refs);
			yield* keys(policy, ['phase', 'prefix', 'aliases', 'signed'], 'refs');
			const phase = yield* oneOf(policy.phase, ['version', 'aliases'], 'Invalid ref phase');
			const prefix = policy.prefix === undefined ? 'v' : String(policy.prefix);
			if (!validTagPrefix(prefix)) return yield* invalid('Invalid tag prefix');
			const aliases = yield* Result.all(
				(yield* strings(policy.aliases ?? [])).map(alias => oneOf(alias, ['major', 'minor'], 'Invalid aliases')),
			);
			if (new Set(aliases).size !== aliases.length) return yield* invalid('Invalid aliases');
			if (policy.signed !== undefined && typeof policy.signed !== 'boolean') {
				return yield* invalid('Invalid signed policy');
			}
			refs = { phase, prefix, aliases, signed: policy.signed === true };
		}
		const file = yield* text(data.file);
		const ref = data.ref === undefined ? undefined : yield* text(data.ref);
		if (ref !== undefined && !validRef(ref)) return yield* invalid('Invalid workflow ref');
		if (!workflowFilePattern.test(file)) return yield* invalid('Workflow must be a filename');
		const inputs: Record<string, string | boolean | number> = {};
		for (
			const [key, input] of Object.entries(data.inputs === undefined ? {} : yield* record(data.inputs))
		) {
			if (key === 'beepboop_execution_id' || (each && key === 'package')) {
				return yield* invalid('Invalid workflow input');
			}
			inputs[key] = yield* workflowInput(input);
		}
		if (data.required !== undefined && typeof data.required !== 'boolean') {
			return yield* invalid('Invalid required flag');
		}
		const outputs = data.outputs === undefined ? undefined : yield* parsedItems(data.outputs, outputSchema);
		if (outputs && new Set(outputs.map(output => output.id)).size !== outputs.length) {
			return yield* invalid('Duplicate output');
		}
		const artifactInputs = data.artifactInputs === undefined
			? undefined
			: yield* parsedItems(data.artifactInputs, inputSchema);
		const platform = data.platform === undefined ? undefined : yield* lift(() => platformSchema.parse(data.platform));
		const needs = data.needs === undefined && !artifactInputs ? undefined : yield* strings(data.needs ?? []);
		const publications = data.publications === undefined ? undefined : yield* packageReferences(data.publications);
		let needsJobs: Record<string, string[]> | undefined;
		if (data.needsJobs !== undefined) {
			needsJobs = {};
			for (const [operation, jobs] of Object.entries(yield* record(data.needsJobs))) {
				const names = yield* strings(jobs);
				if (!identifierPattern.test(operation) || !names.length || names.some(name => !jobKeyPattern.test(name))) {
					return yield* invalid('Invalid needsJobs');
				}
				needsJobs[operation] = names;
			}
		}
		return {
			...(outputs ? { outputs } : {}),
			...(artifactInputs ? { artifactInputs } : {}),
			...(platform === undefined ? {} : { platform }),
			...(refs ? { refs } : {}),
			...(mode === undefined ? {} : { mode }),
			...(each === undefined ? {} : { each }),
			...(needs === undefined
				? {}
				: { needs: [...new Set([...needs, ...(artifactInputs ?? []).map(input => input.operation)])] }),
			...(needsJobs === undefined ? {} : { needsJobs }),
			...(publications === undefined ? {} : { publications }),
			...(schedule === undefined ? {} : { schedule }),
			file,
			...(ref === undefined ? {} : { ref }),
			inputs,
			required: data.required !== false,
		};
	});
}
function stream(name: string, raw: unknown): Parsed<Stream> {
	return Result.gen(function*() {
		if (!identifierPattern.test(name)) return yield* invalid('Invalid stream name');
		const row = yield* record(raw);
		yield* keys(
			row,
			[
				'versioning',
				'versionFiles',
				'versionSource',
				'packages',
				'prepare',
				'promote',
				'workflows',
				'required',
				'needs',
				'credentials',
				'channels',
				'concurrency',
			],
			`stream ${name}`,
		);
		const prepare = yield* record(row.prepare ?? {}),
			promote = yield* record(row.promote ?? {}),
			channels = yield* record(row.channels ?? {});
		yield* keys(prepare, ['version', 'workflow', 'strategy'], 'prepare');
		const strategy = prepare.strategy === undefined
			? undefined
			: yield* oneOf(prepare.strategy, ['managed', 'workflow'], 'Invalid preparation strategy');
		yield* keys(promote, ['approval', 'workflow'], 'promote');
		yield* keys(channels, ['stable', 'prerelease'], 'channels');
		if (prepare.version !== undefined && prepare.version !== 'manual') {
			return yield* invalid('Only manual version selection is supported');
		}
		const versioning = yield* oneOf(
			row.versioning ?? 'workspace',
			['workspace', 'independent', 'none'],
			'Invalid versioning',
		);
		const concurrency = yield* oneOf(row.concurrency ?? 'queue', ['queue', 'supersede-pending'], 'Invalid concurrency');
		const workflows: Record<string, WorkflowBinding> = {};
		for (const [operation, value] of Object.entries(yield* record(row.workflows ?? {}))) {
			if (!identifierPattern.test(operation)) return yield* invalid('Invalid operation name');
			workflows[operation] = yield* binding(value);
		}
		let versionSource: Stream['versionSource'];
		if (row.versionSource !== undefined) {
			const source = yield* record(row.versionSource);
			yield* keys(source, ['kind', 'prefix'], 'versionSource');
			if (source.kind !== 'tags' || typeof source.prefix !== 'string' || !validTagPrefix(source.prefix)) {
				return yield* invalid('Invalid tag version source');
			}
			versionSource = { kind: 'tags', prefix: source.prefix };
		}
		const versionFiles = row.versionFiles === undefined
			? undefined
			: yield* parsedItems(row.versionFiles, versionFileSchema);
		const packages = row.packages === undefined ? undefined : yield* packageReferences(row.packages);
		let needs: Record<string, string[]> | undefined;
		if (row.needs !== undefined) {
			needs = {};
			for (const [publication, dependencies] of Object.entries(yield* record(row.needs))) {
				needs[publication] = yield* strings(dependencies);
			}
		}
		return {
			...(versionFiles === undefined ? {} : { versionFiles }),
			...(versionSource ? { versionSource } : {}),
			...(packages === undefined ? {} : { packages }),
			versioning,
			concurrency,
			prepare: {
				...(strategy === undefined ? {} : { strategy }),
				version: 'manual',
				...(prepare.workflow ? { workflow: yield* binding(prepare.workflow) } : {}),
			},
			promote: {
				approval: yield* oneOf(
					promote.approval ?? 'required',
					['required', 'merge', 'push'],
					'Invalid promotion approval',
				),
				...(promote.workflow ? { workflow: yield* binding(promote.workflow) } : {}),
			},
			workflows,
			required: yield* packageReferences(row.required ?? []),
			...(needs === undefined ? {} : { needs }),
			credentials: yield* strings(row.credentials ?? []),
			channels: {
				stable: yield* text(channels.stable ?? 'latest'),
				prerelease: yield* text(channels.prerelease ?? 'next'),
			},
		};
	});
}
function operationGraph(stream: Stream): Parsed<void> {
	return Result.gen(function*() {
		const operations: Record<string, WorkflowBinding | undefined> = {
			...stream.workflows,
			prepare: stream.prepare.workflow,
			promote: stream.promote.workflow,
		};
		const done = new Set<string>(),
			visiting = new Set<string>();
		const visit = (name: string): Parsed<void> =>
			Result.gen(function*() {
				if (done.has(name)) return;
				if (visiting.has(name)) return yield* invalid('Operation dependency cycle');
				const operation = operations[name];
				if (!operation) return yield* invalid(`Unknown dependency ${name}`);
				visiting.add(name);
				for (const dependency of operation.needs ?? []) yield* visit(dependency);
				visiting.delete(name);
				done.add(name);
			});
		for (const [name, operation] of Object.entries(operations)) if (operation) yield* visit(name);
		const approved = (name: string): boolean => name === 'promote' || (operations[name]?.needs ?? []).some(approved);
		for (const [name, operation] of Object.entries(operations)) {
			for (const input of operation?.artifactInputs ?? []) {
				if (!operations[input.operation]?.outputs?.some(output => output.id === input.output)) {
					return yield* invalid(`Unknown output: ${input.operation}/${input.output}`);
				}
			}
			for (const needed of Object.keys(operation?.needsJobs ?? {})) {
				if (!operation?.needs?.includes(needed) || operations[needed]?.mode !== 'observe') {
					return yield* invalid(`needsJobs.${needed} must name an observed operation listed in needs`);
				}
			}
			if (operation?.refs && !approved(name)) {
				return yield* invalid('Ref publication requires promotion approval in its dependencies');
			}
		}
	});
}
function subscription(raw: unknown, streams: Record<string, Stream>): Parsed<Configuration['subscriptions'][number]> {
	return Result.gen(function*() {
		const row = yield* record(raw);
		yield* keys(row, [
			'id',
			'source',
			'event',
			'stream',
			'operation',
			'workflow',
			'sourceStream',
			'sourceGroup',
			'publication',
		], 'subscription');
		const id = yield* text(row.id),
			kind = yield* text(row.event),
			stream = yield* text(row.stream),
			operation = yield* text(row.operation);
		if (!identifierPattern.test(id)) return yield* invalid('Invalid subscription');
		const event = yield* oneOf(kind, ['release', 'package.version.changed', 'workflow_run'], 'Invalid subscription');
		if (!streams[stream]?.workflows[operation]) return yield* invalid('Subscription references an unknown operation');
		if (event === 'workflow_run' && (typeof row.workflow !== 'string' || !workflowFilePattern.test(row.workflow))) {
			return yield* invalid('Workflow subscription requires an exact filename');
		}
		return {
			id,
			...(row.sourceStream === undefined ? {} : { sourceStream: yield* text(row.sourceStream) }),
			...(row.sourceGroup === undefined ? {} : { sourceGroup: yield* text(row.sourceGroup) }),
			...(row.publication === undefined ? {} : { publication: yield* text(row.publication) }),
			source: yield* text(row.source),
			event,
			stream,
			operation,
			...(row.workflow === undefined ? {} : { workflow: yield* text(row.workflow) }),
		};
	});
}
export function parseRepositoryConfiguration(value: unknown): Parsed<Configuration> {
	return Result.gen(function*() {
		const data = yield* record(value);
		yield* keys(data, ['$schema', 'extends', 'managers', 'streams', 'subscriptions', 'winget'], 'configuration');
		const managers = data.managers === undefined
			? [...managerNames]
			: yield* Result.all((yield* strings(data.managers)).map(name => oneOf(name, managerNames, 'Unknown manager')));
		const streams: Record<string, Stream> = {};
		for (const [name, raw] of Object.entries(yield* record(data.streams ?? {}))) {
			streams[name] = yield* stream(name, raw);
		}
		for (const parsed of Object.values(streams)) yield* operationGraph(parsed);
		const subscriptions: Configuration['subscriptions'] = [];
		for (const raw of yield* array(data.subscriptions ?? [])) {
			subscriptions.push(yield* subscription(raw, streams));
		}
		if (new Set(subscriptions.map((s) => s.id)).size !== subscriptions.length) {
			return yield* invalid('Duplicate subscription');
		}
		return {
			...(data.winget === undefined ? {} : { winget: yield* winGetPolicy(data.winget) }),
			extends: yield* strings(data.extends ?? []),
			managers,
			streams,
			subscriptions,
		};
	});
}
export function mergeConfiguration(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Result.Result<Record<string, unknown>, DomainError> {
	return Result.gen(function*() {
		const result = { ...base };
		if (typeof base.file === 'string' && typeof override.file === 'string' && base.file !== override.file) {
			// Generated phase inputs belong to the old shared workflow, including when inherited from a preset.
			// Keep other inherited inputs and allow an explicitly supplied phase input to override this cleanup.
			const inputs = record(base.inputs);
			if (Result.isSuccess(inputs) && Object.hasOwn(inputs.success, 'beepboop_operation')) {
				const { beepboop_operation: _phase, ...userInputs } = inputs.success;
				result.inputs = userInputs;
			}
		}
		for (const [key, value] of Object.entries(override)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) {
				return yield* invalid('Invalid configuration key');
			}
			const prior = result[key];
			result[key] = value
					&& typeof value === 'object'
					&& !Array.isArray(value)
					&& prior
					&& typeof prior === 'object'
					&& !Array.isArray(prior)
				? yield* mergeConfiguration(
					Object.fromEntries(Object.entries(prior)),
					Object.fromEntries(Object.entries(value)),
				)
				: value;
		}
		return result;
	});
}
export type PresetLoader = (reference: string) => Effect.Effect<{ value: unknown; sha: string }, DomainError>;
export interface ResolvedConfiguration {
	configuration: Configuration;
	presetShas: Record<string, string>;
	drift: Diagnostic[];
}
export function resolveConfiguration(
	value: unknown,
	load: PresetLoader,
): Effect.Effect<ResolvedConfiguration, Invalid> {
	const presetShas: Record<string, string> = {};
	const cache = new Map<string, { value: unknown; sha: string }>();
	const visit = (raw: unknown, stack: string[]): Effect.Effect<Record<string, unknown>, DomainError> =>
		Effect.gen(function*() {
			if (stack.length > 16) return yield* precondition('Preset nesting limit exceeded');
			const data = yield* Effect.fromResult(record(raw));
			let resolved: Record<string, unknown> = {};
			for (const reference of yield* Effect.fromResult(strings(data.extends ?? []))) {
				if (!parsePresetReference(reference)) return yield* precondition('Invalid preset reference');
				if (stack.includes(reference)) {
					return yield* precondition(`Preset cycle: ${[...stack, reference].join(' -> ')}`);
				}
				const loaded = cache.get(reference) ?? (yield* load(reference));
				cache.set(reference, loaded);
				if (!shaPattern.test(loaded.sha)) return yield* precondition('Preset must resolve to a commit');
				presetShas[reference] = loaded.sha;
				const nested = yield* visit(loaded.value, [...stack, reference]);
				resolved = yield* Effect.fromResult(mergeConfiguration(resolved, nested));
			}
			return yield* Effect.fromResult(mergeConfiguration(resolved, data));
		});
	return Effect.gen(function*() {
		const merged = yield* visit(value, []);
		const configuration = yield* Effect.fromResult(parseRepositoryConfiguration(merged)).pipe(
			Effect.mapError((error): Invalid => {
				const schema = configurationSchema.safeParse(merged);
				return schema.success ? error : schema.error;
			}),
		);
		return { configuration, presetShas, drift: configurationDrift(merged, configuration) };
	});
}
