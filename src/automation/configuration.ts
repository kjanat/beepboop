import { CronExpressionParser } from 'cron-parser';
import { array, record, text } from '#model';
import { validRef } from './policy.ts';
import type { Configuration, ManagerName, Stream, WorkflowBinding } from './types.ts';

export const managerNames: ManagerName[] = [
	'cargo',
	'npm',
	'github-release',
	'oci',
	'goreleaser',
	'manifest',
	'workflow',
];
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
function keys(data: Record<string, unknown>, allowed: string[], context: string): void {
	for (const key of Object.keys(data)) {
		if (!allowed.includes(key)) throw new Error(`${context}: unknown field ${key}`);
	}
}
function strings(value: unknown): string[] {
	return array(value).map(text);
}
function binding(value: unknown): WorkflowBinding {
	const data = record(value);
	keys(
		data,
		['file', 'ref', 'inputs', 'required', 'needs', 'schedule', 'publications', 'mode'],
		'workflow',
	);
	if (data.schedule !== undefined) {
		const schedule = text(data.schedule);
		if (schedule.trim().split(/\s+/).length !== 5) {
			throw new Error('Schedules use five-field UTC cron');
		}
		CronExpressionParser.parse(schedule, { tz: 'UTC' });
	}
	if (data.mode !== undefined && !['observe', 'dispatch'].includes(String(data.mode))) {
		throw new Error('Invalid workflow mode');
	}
	const file = text(data.file);
	if (data.ref !== undefined && !validRef(text(data.ref))) throw new Error('Invalid workflow ref');
	if (!/^[A-Za-z0-9_-]+\.ya?ml$/.test(file)) throw new Error('Workflow must be a filename');
	const inputs = data.inputs === undefined ? {} : record(data.inputs);
	for (const [key, value] of Object.entries(inputs)) {
		if (
			key === 'beepboop_execution_id'
			|| !['string', 'boolean', 'number'].includes(typeof value)
		) {
			throw new Error('Invalid workflow input');
		}
	}
	if (data.required !== undefined && typeof data.required !== 'boolean') {
		throw new Error('Invalid required flag');
	}
	return {
		...(data.mode === undefined ? {} : { mode: data.mode as WorkflowBinding['mode'] }),
		...(data.needs === undefined ? {} : { needs: strings(data.needs) }),
		...(data.publications === undefined ? {} : { publications: strings(data.publications) }),
		...(data.schedule === undefined ? {} : { schedule: text(data.schedule) }),
		file,
		...(data.ref === undefined ? {} : { ref: text(data.ref) }),
		inputs: inputs as WorkflowBinding['inputs'],
		required: data.required !== false,
	};
}
export function parseRepositoryConfiguration(value: unknown): Configuration {
	const data = record(value);
	keys(data, ['$schema', 'extends', 'managers', 'streams', 'subscriptions'], 'configuration');
	const managers = data.managers === undefined ? [...managerNames] : strings(data.managers);
	if (managers.some((name) => !managerNames.includes(name as ManagerName))) {
		throw new Error('Unknown manager');
	}
	const streams: Record<string, Stream> = {};
	for (const [name, raw] of Object.entries(record(data.streams ?? {}))) {
		if (!identifier.test(name)) throw new Error('Invalid stream name');
		const row = record(raw);
		keys(
			row,
			[
				'versioning',
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
		const prepare = record(row.prepare ?? {}),
			promote = record(row.promote ?? {}),
			channels = record(row.channels ?? {});
		keys(prepare, ['version', 'workflow', 'strategy'], 'prepare');
		if (
			prepare.strategy !== undefined
			&& !['managed', 'workflow'].includes(String(prepare.strategy))
		) {
			throw new Error('Invalid preparation strategy');
		}
		keys(promote, ['approval', 'workflow'], 'promote');
		keys(channels, ['stable', 'prerelease'], 'channels');
		if (prepare.version !== undefined && prepare.version !== 'manual') {
			throw new Error('Only manual version selection is supported');
		}
		if (promote.approval !== undefined && promote.approval !== 'required') {
			throw new Error('Promotion requires approval');
		}
		const versioning = row.versioning ?? 'workspace',
			concurrency = row.concurrency ?? 'queue';
		if (!['workspace', 'independent', 'none'].includes(String(versioning))) {
			throw new Error('Invalid versioning');
		}
		if (!['queue', 'supersede-pending'].includes(String(concurrency))) {
			throw new Error('Invalid concurrency');
		}
		const workflows: Record<string, WorkflowBinding> = {};
		for (const [operation, value] of Object.entries(record(row.workflows ?? {}))) {
			if (!identifier.test(operation)) throw new Error('Invalid operation name');
			workflows[operation] = binding(value);
		}
		streams[name] = {
			...(row.packages === undefined ? {} : { packages: strings(row.packages) }),
			versioning: versioning as Stream['versioning'],
			concurrency: concurrency as Stream['concurrency'],
			prepare: {
				...(prepare.strategy === undefined
					? {}
					: { strategy: prepare.strategy as 'managed' | 'workflow' }),
				version: 'manual',
				...(prepare.workflow ? { workflow: binding(prepare.workflow) } : {}),
			},
			promote: {
				approval: 'required',
				...(promote.workflow ? { workflow: binding(promote.workflow) } : {}),
			},
			workflows,
			required: strings(row.required ?? []),
			credentials: strings(row.credentials ?? []),
			channels: {
				stable: text(channels.stable ?? 'latest'),
				prerelease: text(channels.prerelease ?? 'next'),
			},
		};
	}
	for (const stream of Object.values(streams)) {
		const operations: Record<string, WorkflowBinding | undefined> = {
			...stream.workflows,
			prepare: stream.prepare.workflow,
			promote: stream.promote.workflow,
		};
		const done = new Set<string>(),
			visiting = new Set<string>();
		const visit = (name: string): void => {
			if (done.has(name)) return;
			if (visiting.has(name)) throw new Error('Operation dependency cycle');
			const operation = operations[name];
			if (!operation) throw new Error(`Unknown dependency ${name}`);
			visiting.add(name);
			for (const dependency of operation.needs ?? []) visit(dependency);
			visiting.delete(name);
			done.add(name);
		};
		for (const [name, operation] of Object.entries(operations)) if (operation) visit(name);
	}
	const subscriptions = array(data.subscriptions ?? []).map((raw) => {
		const row = record(raw);
		keys(row, ['id', 'source', 'event', 'stream', 'operation', 'workflow'], 'subscription');
		const id = text(row.id),
			event = text(row.event),
			stream = text(row.stream),
			operation = text(row.operation);
		if (
			!identifier.test(id)
			|| !['release', 'package.version.changed', 'workflow_run'].includes(event)
		) {
			throw new Error('Invalid subscription');
		}
		if (!streams[stream]?.workflows[operation]) {
			throw new Error('Subscription references an unknown operation');
		}
		if (
			event === 'workflow_run'
			&& (typeof row.workflow !== 'string' || !/^[\w-]+\.ya?ml$/.test(row.workflow))
		) {
			throw new Error('Workflow subscription requires an exact filename');
		}
		return {
			id,
			source: text(row.source),
			event: event as Configuration['subscriptions'][number]['event'],
			stream,
			operation,
			...(row.workflow === undefined ? {} : { workflow: text(row.workflow) }),
		};
	});
	if (new Set(subscriptions.map((s) => s.id)).size !== subscriptions.length) {
		throw new Error('Duplicate subscription');
	}
	return {
		extends: strings(data.extends ?? []),
		managers: managers as ManagerName[],
		streams,
		subscriptions,
	};
}
export function mergeConfiguration(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (['__proto__', 'constructor', 'prototype'].includes(key)) {
			throw new Error('Invalid configuration key');
		}
		const prior = result[key];
		result[key] = value
				&& typeof value === 'object'
				&& !Array.isArray(value)
				&& prior
				&& typeof prior === 'object'
				&& !Array.isArray(prior)
			? mergeConfiguration(record(prior), record(value))
			: value;
	}
	return result;
}
export type PresetLoader = (reference: string) => Promise<{ value: unknown; sha: string }>;
export async function resolveConfiguration(
	value: unknown,
	load: PresetLoader,
): Promise<{ configuration: Configuration; presetShas: Record<string, string> }> {
	const presetShas: Record<string, string> = {};
	const cache = new Map<string, { value: unknown; sha: string }>();
	async function visit(raw: unknown, stack: string[]): Promise<Record<string, unknown>> {
		if (stack.length > 16) throw new Error('Preset nesting limit exceeded');
		const data = record(raw);
		let resolved: Record<string, unknown> = {};
		for (const reference of strings(data.extends ?? [])) {
			if (!/^github>[\w.-]+\/[\w.-]+:[\w-]+(?:#[\w./-]+)?$/.test(reference)) {
				throw new Error('Invalid preset reference');
			}
			if (stack.includes(reference)) {
				throw new Error(`Preset cycle: ${[...stack, reference].join(' -> ')}`);
			}
			let loaded = cache.get(reference);
			if (!loaded) {
				loaded = await load(reference);
				cache.set(reference, loaded);
			}
			if (!/^[a-f0-9]{40}$/.test(loaded.sha)) throw new Error('Preset must resolve to a commit');
			presetShas[reference] = loaded.sha;
			resolved = mergeConfiguration(resolved, await visit(loaded.value, [...stack, reference]));
		}
		return mergeConfiguration(resolved, data);
	}
	return { configuration: parseRepositoryConfiguration(await visit(value, [])), presetShas };
}
