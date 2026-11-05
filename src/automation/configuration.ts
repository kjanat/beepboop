import { CronExpressionParser } from 'cron-parser';
import { Effect, Result } from 'effect';
import { z } from 'zod';
import { versionFileSchema } from '@/automation/editors';
import { inputSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { releaseIdentity } from '@/automation/package-identity';
import { validRef } from '@/automation/policy';
import { parsePresetReference } from '@/automation/preset';
import type { Configuration, Stream, WorkflowBinding } from '@/automation/types';
import { managerNames } from '@/contract/catalog';
import type { Diagnostic } from '@/contract/diagnostics';
import { type DomainError, precondition } from '@/contract/errors';
import { configurationDrift, configurationSchema } from '@/domain/configuration';
import { fromSync, toDomainError } from '@/failure';
import { array, oneOf, record, text } from '@/model';
import { purl } from '@/package-url';

type Invalid = DomainError | z.ZodError;
type Parsed<A> = Result.Result<A, Invalid>;

function lift<A>(run: () => A): Parsed<A> {
	return Result.try({ try: run, catch: error => error instanceof z.ZodError ? error : toDomainError(error) });
}
function reject(message: string): Parsed<never> {
	return Result.fail(precondition(message));
}
function packageReferences(value: unknown): Parsed<string[]> {
	return lift(() =>
		array(value).map(text).map(reference => reference.startsWith('pkg:') ? purl(releaseIdentity(reference)) : reference)
	);
}
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
function keys(data: Record<string, unknown>, allowed: string[], context: string): Parsed<void> {
	const unknown = Object.keys(data).find(key => !allowed.includes(key));
	return unknown === undefined ? Result.void : reject(`${context}: unknown field ${unknown}`);
}
function strings(value: unknown): Parsed<string[]> {
	return lift(() => array(value).map(text));
}
function winGetPolicy(value: unknown): Parsed<NonNullable<Configuration['winget']>> {
	return Result.gen(function*() {
		const row = yield* lift(() => record(value));
		if (Object.keys(row).some(key => !['config', 'tagPrefix', 'automatic'].includes(key))) {
			return yield* reject('Unknown WinGet setting');
		}
		const config = yield* lift(() => text(row.config));
		if (!/^[\w./-]+\.json$/.test(config) || config.startsWith('/') || config.split('/').includes('..')) {
			return yield* reject('Invalid WinGet configuration path');
		}
		const tagPrefix = row.tagPrefix === undefined ? 'v' : String(row.tagPrefix);
		if (!/^[\w.-]*$/.test(tagPrefix)) return yield* reject('Invalid WinGet tag prefix');
		if (row.automatic !== undefined && typeof row.automatic !== 'boolean') {
			return yield* reject('Invalid WinGet automatic setting');
		}
		return { config, tagPrefix, automatic: row.automatic === true };
	});
}
function workflowInput(value: unknown): Parsed<string | boolean | number> {
	return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
		? Result.succeed(value)
		: reject('Invalid workflow input');
}
function binding(value: unknown): Parsed<WorkflowBinding> {
	return Result.gen(function*() {
		const data = yield* lift(() => record(value));
		yield* keys(
			data,
			[
				'file',
				'ref',
				'inputs',
				'required',
				'needs',
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
		const schedule = data.schedule === undefined ? undefined : yield* lift(() => text(data.schedule));
		if (schedule !== undefined) {
			if (schedule.trim().split(/\s+/).length !== 5) return yield* reject('Schedules use five-field UTC cron');
			yield* lift(() => CronExpressionParser.parse(schedule, { tz: 'UTC' }));
		}
		const mode = data.mode === undefined
			? undefined
			: yield* lift(() => oneOf(data.mode, ['observe', 'dispatch'], 'Invalid workflow mode'));
		const each = data.each === undefined
			? undefined
			: yield* lift(() => oneOf(data.each, ['package'], 'Invalid workflow each'));
		if (each && (data.outputs !== undefined || data.artifactInputs !== undefined || data.refs !== undefined)) {
			return yield* reject('Per-package workflows cannot declare outputs, artifact inputs or refs');
		}
		let refs: WorkflowBinding['refs'];
		if (data.refs !== undefined) {
			const policy = yield* lift(() => record(data.refs));
			yield* keys(policy, ['phase', 'prefix', 'aliases', 'signed'], 'refs');
			const phase = yield* lift(() => oneOf(policy.phase, ['version', 'aliases'], 'Invalid ref phase'));
			const prefix = policy.prefix === undefined ? 'v' : String(policy.prefix);
			if (!/^[A-Za-z0-9._-]*$/.test(prefix) || prefix.includes('..')) return yield* reject('Invalid tag prefix');
			const aliases = yield* lift(() =>
				array(policy.aliases ?? []).map(text).map(alias => oneOf(alias, ['major', 'minor'], 'Invalid aliases'))
			);
			if (new Set(aliases).size !== aliases.length) return yield* reject('Invalid aliases');
			if (policy.signed !== undefined && typeof policy.signed !== 'boolean') {
				return yield* reject('Invalid signed policy');
			}
			refs = { phase, prefix, aliases, signed: policy.signed === true };
		}
		const file = yield* lift(() => text(data.file));
		const ref = data.ref === undefined ? undefined : yield* lift(() => text(data.ref));
		if (ref !== undefined && !validRef(ref)) return yield* reject('Invalid workflow ref');
		if (!/^[A-Za-z0-9_-]+\.ya?ml$/.test(file)) return yield* reject('Workflow must be a filename');
		const inputs: Record<string, string | boolean | number> = {};
		for (
			const [key, input] of Object.entries(data.inputs === undefined ? {} : yield* lift(() => record(data.inputs)))
		) {
			if (key === 'beepboop_execution_id' || (each && key === 'package')) {
				return yield* reject('Invalid workflow input');
			}
			inputs[key] = yield* workflowInput(input);
		}
		if (data.required !== undefined && typeof data.required !== 'boolean') {
			return yield* reject('Invalid required flag');
		}
		const outputs = data.outputs === undefined
			? undefined
			: yield* lift(() => array(data.outputs).map(output => outputSchema.parse(output)));
		if (outputs && new Set(outputs.map(output => output.id)).size !== outputs.length) {
			return yield* reject('Duplicate output');
		}
		const artifactInputs = data.artifactInputs === undefined
			? undefined
			: yield* lift(() => array(data.artifactInputs).map(input => inputSchema.parse(input)));
		const platform = data.platform === undefined ? undefined : yield* lift(() => platformSchema.parse(data.platform));
		const needs = data.needs === undefined && !artifactInputs ? undefined : yield* strings(data.needs ?? []);
		const publications = data.publications === undefined ? undefined : yield* packageReferences(data.publications);
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
		if (!identifier.test(name)) return yield* reject('Invalid stream name');
		const row = yield* lift(() => record(raw));
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
				'credentials',
				'channels',
				'concurrency',
			],
			`stream ${name}`,
		);
		const prepare = yield* lift(() => record(row.prepare ?? {})),
			promote = yield* lift(() => record(row.promote ?? {})),
			channels = yield* lift(() => record(row.channels ?? {}));
		yield* keys(prepare, ['version', 'workflow', 'strategy'], 'prepare');
		const strategy = prepare.strategy === undefined
			? undefined
			: yield* lift(() => oneOf(prepare.strategy, ['managed', 'workflow'], 'Invalid preparation strategy'));
		yield* keys(promote, ['approval', 'workflow'], 'promote');
		yield* keys(channels, ['stable', 'prerelease'], 'channels');
		if (prepare.version !== undefined && prepare.version !== 'manual') {
			return yield* reject('Only manual version selection is supported');
		}
		const versioning = yield* lift(() =>
			oneOf(row.versioning ?? 'workspace', ['workspace', 'independent', 'none'], 'Invalid versioning')
		);
		const concurrency = yield* lift(() =>
			oneOf(row.concurrency ?? 'queue', ['queue', 'supersede-pending'], 'Invalid concurrency')
		);
		const workflows: Record<string, WorkflowBinding> = {};
		for (const [operation, value] of Object.entries(yield* lift(() => record(row.workflows ?? {})))) {
			if (!identifier.test(operation)) return yield* reject('Invalid operation name');
			workflows[operation] = yield* binding(value);
		}
		let versionSource: Stream['versionSource'];
		if (row.versionSource !== undefined) {
			const source = yield* lift(() => record(row.versionSource));
			yield* keys(source, ['kind', 'prefix'], 'versionSource');
			if (source.kind !== 'tags' || typeof source.prefix !== 'string' || !/^[A-Za-z0-9._-]*$/.test(source.prefix)) {
				return yield* reject('Invalid tag version source');
			}
			versionSource = { kind: 'tags', prefix: source.prefix };
		}
		const versionFiles = row.versionFiles === undefined
			? undefined
			: yield* lift(() => array(row.versionFiles).map(file => versionFileSchema.parse(file)));
		const packages = row.packages === undefined ? undefined : yield* packageReferences(row.packages);
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
				approval: yield* lift(() =>
					oneOf(promote.approval ?? 'required', ['required', 'merge', 'push'], 'Invalid promotion approval')
				),
				...(promote.workflow ? { workflow: yield* binding(promote.workflow) } : {}),
			},
			workflows,
			required: yield* packageReferences(row.required ?? []),
			credentials: yield* strings(row.credentials ?? []),
			channels: {
				stable: yield* lift(() => text(channels.stable ?? 'latest')),
				prerelease: yield* lift(() => text(channels.prerelease ?? 'next')),
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
				if (visiting.has(name)) return yield* reject('Operation dependency cycle');
				const operation = operations[name];
				if (!operation) return yield* reject(`Unknown dependency ${name}`);
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
					return yield* reject(`Unknown output: ${input.operation}/${input.output}`);
				}
			}
			if (operation?.refs && !approved(name)) {
				return yield* reject('Ref publication requires promotion approval in its dependencies');
			}
		}
	});
}
function subscription(raw: unknown, streams: Record<string, Stream>): Parsed<Configuration['subscriptions'][number]> {
	return Result.gen(function*() {
		const row = yield* lift(() => record(raw));
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
		const field = (value: unknown) => lift(() => text(value));
		const id = yield* field(row.id),
			kind = yield* field(row.event),
			stream = yield* field(row.stream),
			operation = yield* field(row.operation);
		if (!identifier.test(id)) return yield* reject('Invalid subscription');
		const event = yield* lift(() =>
			oneOf(kind, ['release', 'package.version.changed', 'workflow_run'], 'Invalid subscription')
		);
		if (!streams[stream]?.workflows[operation]) return yield* reject('Subscription references an unknown operation');
		if (event === 'workflow_run' && (typeof row.workflow !== 'string' || !/^[\w-]+\.ya?ml$/.test(row.workflow))) {
			return yield* reject('Workflow subscription requires an exact filename');
		}
		return {
			id,
			...(row.sourceStream === undefined ? {} : { sourceStream: yield* field(row.sourceStream) }),
			...(row.sourceGroup === undefined ? {} : { sourceGroup: yield* field(row.sourceGroup) }),
			...(row.publication === undefined ? {} : { publication: yield* field(row.publication) }),
			source: yield* field(row.source),
			event,
			stream,
			operation,
			...(row.workflow === undefined ? {} : { workflow: yield* field(row.workflow) }),
		};
	});
}
export function parseRepositoryConfiguration(value: unknown): Parsed<Configuration> {
	return Result.gen(function*() {
		const data = yield* lift(() => record(value));
		yield* keys(data, ['$schema', 'extends', 'managers', 'streams', 'subscriptions', 'winget'], 'configuration');
		const managers = data.managers === undefined
			? [...managerNames]
			: yield* lift(() => array(data.managers).map(text).map(name => oneOf(name, managerNames, 'Unknown manager')));
		const streams: Record<string, Stream> = {};
		for (const [name, raw] of Object.entries(yield* lift(() => record(data.streams ?? {})))) {
			streams[name] = yield* stream(name, raw);
		}
		for (const parsed of Object.values(streams)) yield* operationGraph(parsed);
		const subscriptions: Configuration['subscriptions'] = [];
		for (const raw of yield* lift(() => array(data.subscriptions ?? []))) {
			subscriptions.push(yield* subscription(raw, streams));
		}
		if (new Set(subscriptions.map((s) => s.id)).size !== subscriptions.length) {
			return yield* reject('Duplicate subscription');
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
		for (const [key, value] of Object.entries(override)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) {
				return yield* Result.fail(precondition('Invalid configuration key'));
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
			const data = yield* fromSync(() => record(raw));
			let resolved: Record<string, unknown> = {};
			for (const reference of yield* fromSync(() => array(data.extends ?? []).map(text))) {
				if (!parsePresetReference(reference)) return yield* precondition('Invalid preset reference');
				if (stack.includes(reference)) {
					return yield* precondition(`Preset cycle: ${[...stack, reference].join(' -> ')}`);
				}
				const loaded = cache.get(reference) ?? (yield* load(reference));
				cache.set(reference, loaded);
				if (!/^[a-f0-9]{40}$/.test(loaded.sha)) return yield* precondition('Preset must resolve to a commit');
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
