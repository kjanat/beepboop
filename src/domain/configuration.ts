import { CronExpressionParser } from 'cron-parser';
import { Result } from 'effect';
import { z } from 'zod';
import { versionFileSchema } from '@/automation/editors';
import { inputSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { parseReleaseIdentity } from '@/automation/package-identity';
import { refPattern, validRef } from '@/automation/policy';
import { presetReferencePattern } from '@/automation/preset';
import { managerNames } from '@/contract/catalog';
import { type Diagnostic, type DiagnosticCode, isDiagnosticCode } from '@/contract/diagnostics';
import { purl } from '@/package-url';

export const identifierPattern = /^[a-z][a-z0-9-]{0,63}$/;
export const workflowFilePattern = /^[A-Za-z0-9_-]+\.ya?ml$/;
export const reservedOperations = ['prepare', 'promote'] as const;
export type ReservedOperation = (typeof reservedOperations)[number];
const tagPrefix = /^[A-Za-z0-9._-]*$/;
const nonempty = z.string().min(1);
const identifier = z.string().regex(identifierPattern);

function issue(ctx: z.RefinementCtx, code: DiagnosticCode, message: string, path: (string | number)[]): void {
	ctx.addIssue({ code: 'custom', message, path, params: { diagnostic: code } });
}

export const packageReference = nonempty.transform((value, ctx) => {
	if (!value.startsWith('pkg:')) return value;
	const identity = parseReleaseIdentity(value);
	if (Result.isSuccess(identity)) return purl(identity.success);
	ctx.addIssue({ code: 'custom', message: identity.failure.message });
	return z.NEVER;
}).meta({
	id: 'packageReference',
	description:
		'Package URL (versionless for release selection). Legacy manager:name references are accepted for compatibility.',
});
const packageReferences = z.array(packageReference);

const cron = nonempty.refine(value => {
	if (value.trim().split(/\s+/).length !== 5) return false;
	return Result.isSuccess(Result.try(() => CronExpressionParser.parse(value, { tz: 'UTC' })));
}, 'Schedules use five-field UTC cron');

const refPolicy = z.strictObject({
	phase: z.enum(['version', 'aliases']),
	prefix: z.string().regex(tagPrefix).refine(value => !value.includes('..'), 'Invalid tag prefix').default('v'),
	aliases: z.array(z.enum(['major', 'minor'])).refine(
		aliases => new Set(aliases).size === aliases.length,
		'Invalid aliases',
	).default([]),
	signed: z.boolean().optional(),
}).transform(({ phase, prefix, aliases, signed }) => ({ phase, prefix, aliases, signed: signed === true }));

function bindingSchema() {
	const shape = z.strictObject({
		file: z.string().regex(workflowFilePattern, 'Workflow must be a filename'),
		ref: z.string().regex(refPattern, 'Invalid workflow ref').refine(validRef, 'Invalid workflow ref').optional(),
		inputs: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
		required: z.boolean().optional(),
		needs: z.array(nonempty).optional(),
		schedule: cron.optional(),
		publications: packageReferences.optional(),
		mode: z.enum(['observe', 'dispatch']).optional(),
		each: z.literal('package').optional(),
		refs: refPolicy.optional(),
		platform: platformSchema.optional(),
		outputs: z.array(outputSchema).optional(),
		artifactInputs: z.array(inputSchema).optional(),
	});
	const checked = shape.superRefine((binding, ctx) => {
		if (
			binding.each
			&& (binding.outputs !== undefined || binding.artifactInputs !== undefined || binding.refs !== undefined)
		) {
			issue(ctx, 'each-package-input', 'Per-package workflows cannot declare outputs, artifact inputs or refs', [
				'each',
			]);
		}
		for (const key of Object.keys(binding.inputs ?? {})) {
			if (key === 'beepboop_execution_id' || (binding.each && key === 'package')) {
				issue(ctx, 'reserved-operation', `Input ${key} is set by Beepboop`, ['inputs', key]);
			}
		}
		const ids = (binding.outputs ?? []).map(output => output.id);
		if (new Set(ids).size !== ids.length) issue(ctx, 'duplicate-identity', 'Duplicate output', ['outputs']);
	});
	return checked.transform(binding => ({
		...(binding.outputs ? { outputs: binding.outputs } : {}),
		...(binding.artifactInputs ? { artifactInputs: binding.artifactInputs } : {}),
		...(binding.platform ? { platform: binding.platform } : {}),
		...(binding.refs ? { refs: binding.refs } : {}),
		...(binding.mode === undefined ? {} : { mode: binding.mode }),
		...(binding.each === undefined ? {} : { each: binding.each }),
		...(binding.needs === undefined && !binding.artifactInputs
			? {}
			: {
				needs: [
					...new Set([...(binding.needs ?? []), ...(binding.artifactInputs ?? []).map(input => input.operation)]),
				],
			}),
		...(binding.publications === undefined ? {} : { publications: binding.publications }),
		...(binding.schedule === undefined ? {} : { schedule: binding.schedule }),
		file: binding.file,
		...(binding.ref === undefined ? {} : { ref: binding.ref }),
		inputs: binding.inputs ?? {},
		required: binding.required !== false,
	})).meta({ id: 'workflow' });
}

function streamSchema() {
	const binding = bindingSchema();
	const workflows = z.record(identifier, binding);
	const shape = z.strictObject({
		versioning: z.enum(['workspace', 'independent', 'none']).default('workspace'),
		versionFiles: z.array(versionFileSchema).optional(),
		versionSource: z.strictObject({ kind: z.literal('tags'), prefix: z.string().regex(tagPrefix) }).optional(),
		packages: packageReferences.optional(),
		prepare: z.strictObject({
			version: z.literal('manual').optional(),
			workflow: binding.optional(),
			strategy: z.enum(['managed', 'workflow']).optional(),
		}).default({}),
		promote: z.strictObject({
			approval: z.enum(['required', 'merge', 'push']).default('required'),
			workflow: binding.optional(),
		}).default({ approval: 'required' }),
		workflows: workflows.superRefine((value, ctx) => {
			for (const name of reservedOperations) {
				if (Object.hasOwn(value, name)) {
					issue(ctx, 'reserved-operation', `${name} is configured under ${name}.workflow`, [name]);
				}
			}
		}).default({}),
		required: packageReferences.default([]),
		credentials: z.array(nonempty).default([]),
		channels: z.strictObject({ stable: nonempty.default('latest'), prerelease: nonempty.default('next') }).default({
			stable: 'latest',
			prerelease: 'next',
		}),
		concurrency: z.enum(['queue', 'supersede-pending']).default('queue'),
	});
	const checked = shape.superRefine((stream, ctx) => {
		if (stream.prepare.strategy === 'workflow' && !stream.prepare.workflow) {
			issue(ctx, 'binding-missing', 'The workflow preparation strategy needs prepare.workflow', [
				'prepare',
				'workflow',
			]);
		}
	});
	return checked.transform(stream => ({
		...(stream.versionFiles === undefined ? {} : { versionFiles: stream.versionFiles }),
		...(stream.versionSource ? { versionSource: stream.versionSource } : {}),
		...(stream.packages === undefined ? {} : { packages: stream.packages }),
		versioning: stream.versioning,
		concurrency: stream.concurrency,
		prepare: {
			...(stream.prepare.strategy === undefined ? {} : { strategy: stream.prepare.strategy }),
			version: 'manual' as const,
			...(stream.prepare.workflow ? { workflow: stream.prepare.workflow } : {}),
		},
		promote: {
			approval: stream.promote.approval,
			...(stream.promote.workflow ? { workflow: stream.promote.workflow } : {}),
		},
		workflows: stream.workflows,
		required: stream.required,
		credentials: stream.credentials,
		channels: { stable: stream.channels.stable, prerelease: stream.channels.prerelease },
	})).meta({ id: 'stream' });
}

const subscriptionCommon = { id: identifier, source: nonempty, stream: nonempty, operation: nonempty };
function subscriptionSchema() {
	const release = z.strictObject({
		...subscriptionCommon,
		event: z.literal('release'),
		sourceStream: nonempty.optional(),
		sourceGroup: nonempty.optional(),
		publication: nonempty.optional(),
	});
	const packageChanged = z.strictObject({ ...subscriptionCommon, event: z.literal('package.version.changed') });
	const workflowRun = z.strictObject({
		...subscriptionCommon,
		event: z.literal('workflow_run'),
		workflow: z.string().regex(/^[\w-]+\.ya?ml$/, 'Workflow subscription requires an exact filename'),
	});
	return z.discriminatedUnion('event', [release, packageChanged, workflowRun]).transform(subscription => ({
		id: subscription.id,
		...('sourceStream' in subscription && subscription.sourceStream !== undefined
			? { sourceStream: subscription.sourceStream }
			: {}),
		...('sourceGroup' in subscription && subscription.sourceGroup !== undefined
			? { sourceGroup: subscription.sourceGroup }
			: {}),
		...('publication' in subscription && subscription.publication !== undefined
			? { publication: subscription.publication }
			: {}),
		source: subscription.source,
		event: subscription.event,
		stream: subscription.stream,
		operation: subscription.operation,
		...('workflow' in subscription && subscription.workflow !== undefined ? { workflow: subscription.workflow } : {}),
	})).meta({ id: 'subscription' });
}

const winget = z.strictObject({
	config: z.string().regex(/^[\w./-]+\.json$/).refine(
		value => !value.startsWith('/') && !value.split('/').includes('..'),
		'Invalid WinGet configuration path',
	).meta({ description: 'Path to WinGet package JSON in the release commit' }),
	tagPrefix: z.string().regex(/^[\w.-]*$/).default('v'),
	automatic: z.boolean().default(false),
}).transform(({ config, tagPrefix, automatic }) => ({ config, tagPrefix, automatic }));

export type WorkflowBinding = z.output<ReturnType<typeof bindingSchema>>;
export type Stream = z.output<ReturnType<typeof streamSchema>>;
export type Subscription = z.output<ReturnType<typeof subscriptionSchema>>;
export function operations(stream: Stream): ReadonlyMap<string, WorkflowBinding> {
	const result = new Map<string, WorkflowBinding>(Object.entries(stream.workflows));
	for (const name of reservedOperations) result.delete(name);
	if (stream.prepare.workflow) result.set('prepare', stream.prepare.workflow);
	if (stream.promote.workflow) result.set('promote', stream.promote.workflow);
	return result;
}

function graph(stream: Stream, path: (string | number)[], ctx: z.RefinementCtx): void {
	const operationsOf = operations(stream);
	const where = (name: string): (string | number)[] =>
		reservedOperations.some(reserved => reserved === name) ? [...path, name, 'workflow'] : [...path, 'workflows', name];
	const done = new Set<string>(), visiting = new Set<string>(), reported = new Set<string>();
	const visit = (name: string): void => {
		if (done.has(name)) return;
		if (visiting.has(name)) {
			if (!reported.has('cycle')) issue(ctx, 'cycle', 'Operation dependency cycle', where(name));
			reported.add('cycle');
			return;
		}
		const operation = operationsOf.get(name);
		if (!operation) return;
		visiting.add(name);
		for (const dependency of operation.needs ?? []) {
			if (!operationsOf.has(dependency)) {
				issue(ctx, 'unknown-reference', `Unknown dependency ${dependency}`, [...where(name), 'needs']);
			} else visit(dependency);
		}
		visiting.delete(name);
		done.add(name);
	};
	for (const name of operationsOf.keys()) visit(name);
	if (reported.has('cycle')) return;
	const approved = (name: string): boolean =>
		name === 'promote' || (operationsOf.get(name)?.needs ?? []).some(approved);
	for (const [name, operation] of operationsOf) {
		for (const input of operation.artifactInputs ?? []) {
			if (!operationsOf.get(input.operation)?.outputs?.some(output => output.id === input.output)) {
				issue(
					ctx,
					'unknown-reference',
					`Unknown output: ${input.operation}/${input.output}`,
					[...where(name), 'artifactInputs'],
				);
			}
		}
		if (operation.refs && !approved(name)) {
			issue(ctx, 'unknown-reference', 'Ref publication requires promotion approval in its dependencies', [
				...where(name),
				'refs',
			]);
		}
	}
}

export const configurationSchema = z.strictObject({
	$schema: z.string().optional(),
	extends: z.array(z.string().regex(presetReferencePattern, 'Invalid preset reference')).default([]),
	managers: z.array(z.enum(managerNames)).default([...managerNames]),
	streams: z.record(identifier, streamSchema()).default({}),
	subscriptions: z.array(subscriptionSchema()).default([]),
	winget: winget.optional(),
}).superRefine((configuration, ctx) => {
	for (const [name, stream] of Object.entries(configuration.streams)) graph(stream, ['streams', name], ctx);
	const ids = new Set<string>();
	configuration.subscriptions.forEach((subscription, index) => {
		if (ids.has(subscription.id)) {
			issue(ctx, 'duplicate-identity', 'Duplicate subscription', ['subscriptions', index, 'id']);
		}
		ids.add(subscription.id);
		const stream = configuration.streams[subscription.stream];
		if (!stream || !Object.hasOwn(stream.workflows, subscription.operation)) {
			issue(ctx, 'unknown-reference', 'Subscription references an unknown operation', [
				'subscriptions',
				index,
				'operation',
			]);
		}
	});
}).transform(configuration => ({
	...(configuration.winget === undefined ? {} : { winget: configuration.winget }),
	extends: configuration.extends,
	managers: configuration.managers,
	streams: configuration.streams,
	subscriptions: configuration.subscriptions,
})).meta({ title: 'Repository release automation' });
export type ConfigurationInput = z.input<typeof configurationSchema>;
export type Configuration = z.output<typeof configurationSchema>;

export const configurationPath = '.github/beepboop.json';

function codeOf(issue: z.core.$ZodIssue): DiagnosticCode {
	if (issue.code !== 'custom') return 'invalid-configuration';
	const code = issue.params?.diagnostic;
	return typeof code === 'string' && isDiagnosticCode(code) ? code : 'invalid-configuration';
}

export function issueMessage(issue: z.core.$ZodIssue): string {
	return issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message;
}

export function configurationProblem(message: string, code: DiagnosticCode = 'invalid-configuration'): Diagnostic {
	return { code, severity: 'blocking', subject: { kind: 'file', path: configurationPath }, message };
}

export function configurationDiagnostics(error: z.ZodError): Diagnostic[] {
	return error.issues.map(issue => configurationProblem(issueMessage(issue), codeOf(issue)));
}

export function configurationDrift(value: unknown, legacy: Configuration): Diagnostic[] {
	const parsed = configurationSchema.safeParse(value);
	const drift = (message: string): Diagnostic => ({
		code: 'configuration-drift',
		severity: 'warning',
		subject: { kind: 'file', path: configurationPath },
		message,
	});
	if (!parsed.success) {
		return parsed.error.issues.map(issue => drift(`The configuration schema rejects ${issueMessage(issue)}`));
	}
	return JSON.stringify(parsed.data) === JSON.stringify(legacy)
		? []
		: [drift('The configuration schema reads this file differently from the current parser')];
}
