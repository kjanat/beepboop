import type { CronExpression } from 'cron-parser';
import { CronExpressionParser } from 'cron-parser';
import { Effect, Result, Schema } from 'effect';
import { inputSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { parseReleaseIdentity } from '@/automation/package-identity';
import { presetReferencePattern } from '@/automation/preset';
import {
	defaultWinGetTagPrefix,
	jobKeyPattern,
	managerNames,
	refPattern,
	relativeWinGetConfig,
	tagPrefixPattern,
	validRef,
	validTagPrefix,
	winGetConfigPattern,
	winGetTagPrefixPattern,
	workflowFilePattern,
} from '@/contract/catalog';
import type { Diagnostic, DiagnosticCode } from '@/contract/diagnostics';
import { isDiagnosticCode } from '@/contract/diagnostics';
import { identifierPattern } from '@/contract/ids';
import { releaseStarts, versionBump } from '@/contract/release-start';
import { actionsRevisionPattern, workflowSetup } from '@/contract/setup';
import {
	approvalOfPublishWhen,
	bumpOfVersionLands,
	companionModulesSentence,
	mustPublishSentence,
	publishWhen,
	publishWhenDescription,
	versioningOfVersionScope,
	versionLands,
	versionLandsDescription,
	versionPrMerge,
	versionPrMergeDescription,
	versionScope,
	versionScopeDescription,
} from '@/contract/setup-terms';
import { versionFileSchema } from '@/contract/version-files';
import { dependencyOrder } from '@/dependency-order';
import {
	bindingValue,
	configurationValue,
	refPolicyValue,
	streamValue,
	subscriptionValue,
	wingetValue,
} from '@/domain/configuration-value';
import { textSchema as nonempty } from '@/model';
import { purl } from '@/package-url';
import type { Decoded, Encoded, ValidationContext } from '@/schema';
import {
	mapped,
	matchesPattern,
	mutableArray,
	mutableRecord,
	refined,
	safeDecode,
	schemaIssues,
	strictStruct,
	withValidation,
} from '@/schema';

export const reservedOperations = ['prepare', 'promote'] as const;
export type ReservedOperation = (typeof reservedOperations)[number];
const identifier = Schema.String.check(matchesPattern(identifierPattern));

function issue(ctx: ValidationContext, code: DiagnosticCode, message: string, path: (string | number)[]): void {
	ctx.addIssue({ code: 'custom', message, path, params: { diagnostic: code } });
}

export const packageReference = mapped(
	nonempty,
	refined(nonempty, value => {
		if (!value.startsWith('pkg:')) return true;
		const parsed = parseReleaseIdentity(value);
		return Result.isSuccess(parsed) && purl(parsed.success) === value;
	}),
	(value, ctx) => {
		if (!value.startsWith('pkg:')) return value;
		const identity = parseReleaseIdentity(value);
		if (Result.isSuccess(identity)) return purl(identity.success);
		ctx.addIssue({ code: 'custom', message: identity.failure.message });
		return undefined as never;
	},
	value => value,
).annotate({
	identifier: 'packageReference',
	description:
		'Package URL (versionless for release selection). Legacy manager:name references are accepted for compatibility.',
});
const packageReferences = mutableArray(packageReference);

export const utcCronMessage = 'Schedules use five-field UTC cron';
export function fiveFieldCron(value: string): boolean {
	return value.trim().split(/\s+/).length === 5;
}
export function parseUtcCron(value: string): CronExpression {
	return CronExpressionParser.parse(value, { tz: 'UTC' });
}
const cron = refined(
	nonempty,
	value => fiveFieldCron(value) && Result.isSuccess(Result.try(() => parseUtcCron(value))),
	utcCronMessage,
);

const refPolicy = mapped(
	strictStruct({
		phase: Schema.Literals(['version', 'aliases']),
		prefix: refined(Schema.String.check(matchesPattern(tagPrefixPattern)), validTagPrefix, 'Invalid tag prefix').pipe(
			Schema.withDecodingDefault(Effect.succeed('v')),
		),
		aliases: refined(
			mutableArray(Schema.Literals(['major', 'minor'])),
			aliases => new Set(aliases).size === aliases.length,
			'Invalid aliases',
		).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
		signed: Schema.optional(Schema.Boolean),
	}),
	Schema.toType(refPolicyValue),
	({ phase, prefix, aliases, signed }) => ({ phase, prefix, aliases, signed: signed === true }),
	value => value,
);

function bindingSchema() {
	const shape = strictStruct({
		file: Schema.String.check(matchesPattern(workflowFilePattern, { message: 'Workflow must be a filename' })),
		ref: Schema.optional(
			refined(
				Schema.String.check(matchesPattern(refPattern, { message: 'Invalid workflow ref' })),
				validRef,
				'Invalid workflow ref',
			),
		),
		inputs: Schema.optional(mutableRecord(Schema.String, Schema.Union([Schema.String, Schema.Boolean, Schema.Finite]))),
		required: Schema.optional(Schema.Boolean),
		needs: Schema.optional(mutableArray(nonempty)),
		needsJobs: Schema.optional(
			mutableRecord(
				identifier,
				mutableArray(Schema.String.check(matchesPattern(jobKeyPattern))).check(Schema.isMinLength(1)),
			),
		).annotate({
			description:
				'Jobs of an observed operation in needs that must succeed before this operation starts, keyed by that operation',
		}),
		schedule: Schema.optional(cron),
		publications: Schema.optional(packageReferences),
		mode: Schema.optional(Schema.Literals(['observe', 'dispatch'])),
		each: Schema.optional(Schema.Literal('package')),
		refs: Schema.optional(refPolicy),
		platform: Schema.optional(platformSchema),
		outputs: Schema.optional(mutableArray(outputSchema)),
		artifactInputs: Schema.optional(mutableArray(inputSchema)),
		setup: Schema.optional(workflowSetup),
	});
	const checked = withValidation(shape, (binding, ctx) => {
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
	return mapped(checked, Schema.toType(bindingValue), binding => ({
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
		...(binding.needsJobs === undefined ? {} : { needsJobs: binding.needsJobs }),
		...(binding.publications === undefined ? {} : { publications: binding.publications }),
		...(binding.schedule === undefined ? {} : { schedule: binding.schedule }),
		file: binding.file,
		...(binding.ref === undefined ? {} : { ref: binding.ref }),
		inputs: binding.inputs ?? {},
		required: binding.required !== false,
		...(binding.setup ? { setup: binding.setup } : {}),
	}), value => value).annotate({ identifier: 'workflow' });
}

function streamSchema() {
	const binding = bindingSchema();
	const workflows = mutableRecord(identifier, binding);
	const shape = strictStruct({
		versionScope: Schema.optional(versionScope).annotate({ description: versionScopeDescription }),
		versioning: Schema.optional(Schema.Literals(['workspace', 'independent', 'none'])).annotate({ deprecated: true }),
		versionFiles: Schema.optional(mutableArray(versionFileSchema)),
		versionSource: Schema.optional(strictStruct({
			kind: Schema.Literal('tags'),
			prefix: refined(Schema.String.check(matchesPattern(tagPrefixPattern)), validTagPrefix, 'Invalid tag prefix'),
		})),
		packages: Schema.optional(packageReferences),
		companionModules: Schema.optional(packageReferences).annotate({ description: companionModulesSentence }),
		prepare: strictStruct({
			version: Schema.optional(Schema.Literal('manual')),
			workflow: Schema.optional(binding),
			strategy: Schema.optional(Schema.Literals(['managed', 'workflow'])),
			versionLands: Schema.optional(versionLands).annotate({ description: versionLandsDescription }),
			bump: Schema.optional(versionBump).annotate({ deprecated: true }),
			versionPrMerge: Schema.optional(versionPrMerge).annotate({ description: versionPrMergeDescription }),
		}).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
		promote: strictStruct({
			publishWhen: Schema.optional(publishWhen).annotate({ description: publishWhenDescription }),
			approval: Schema.optional(Schema.Literals(['required', 'merge', 'push'])).annotate({ deprecated: true }),
			workflow: Schema.optional(binding),
		}).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
		startFrom: Schema.optional(releaseStarts),
		start: Schema.optional(releaseStarts).annotate({ deprecated: true }),
		workflows: withValidation(workflows, (value, ctx) => {
			for (const name of reservedOperations) {
				if (Object.hasOwn(value, name)) {
					issue(ctx, 'reserved-operation', `${name} is configured under ${name}.workflow`, [name]);
				}
			}
		}).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
		mustPublish: Schema.optional(packageReferences).annotate({ description: mustPublishSentence }),
		required: Schema.optional(packageReferences).annotate({ deprecated: true }),
		needs: Schema.optional(mutableRecord(nonempty, mutableArray(nonempty))).annotate({
			description: 'Publications that must finish before each listed publication, keyed by package reference',
		}),
		credentials: mutableArray(nonempty).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
		channels: strictStruct({
			stable: nonempty.pipe(Schema.withDecodingDefault(Effect.succeed('latest'))),
			prerelease: nonempty.pipe(Schema.withDecodingDefault(Effect.succeed('next'))),
		}).pipe(Schema.withDecodingDefault(Effect.succeed({
			stable: 'latest',
			prerelease: 'next',
		}))),
		concurrency: Schema.Literals(['queue', 'supersede-pending']).pipe(
			Schema.withDecodingDefault(Effect.succeed('queue')),
		),
	});
	const checked = withValidation(shape, (stream, ctx) => {
		if (stream.prepare.strategy === 'workflow' && !stream.prepare.workflow) {
			issue(ctx, 'binding-missing', 'The workflow preparation strategy needs prepare.workflow', [
				'prepare',
				'workflow',
			]);
		}
	});
	return mapped(checked, Schema.toType(streamValue), stream => ({
		...(stream.versionFiles === undefined ? {} : { versionFiles: stream.versionFiles }),
		...(stream.versionSource ? { versionSource: stream.versionSource } : {}),
		...(stream.packages === undefined ? {} : { packages: stream.packages }),
		...(stream.companionModules === undefined ? {} : { companionModules: stream.companionModules }),
		versioning: stream.versionScope ? versioningOfVersionScope[stream.versionScope] : stream.versioning ?? 'workspace',
		concurrency: stream.concurrency,
		prepare: {
			...(stream.prepare.strategy === undefined ? {} : { strategy: stream.prepare.strategy }),
			version: 'manual' as const,
			...(stream.prepare.workflow ? { workflow: stream.prepare.workflow } : {}),
			...(stream.prepare.versionLands
				? { bump: bumpOfVersionLands[stream.prepare.versionLands] }
				: stream.prepare.bump
				? { bump: stream.prepare.bump }
				: {}),
			...(stream.prepare.versionPrMerge ? { versionPrMerge: stream.prepare.versionPrMerge } : {}),
		},
		promote: {
			approval: stream.promote.publishWhen
				? approvalOfPublishWhen[stream.promote.publishWhen]
				: stream.promote.approval ?? 'required',
			...(stream.promote.workflow ? { workflow: stream.promote.workflow } : {}),
		},
		...(stream.startFrom ?? stream.start ? { start: stream.startFrom ?? stream.start } : {}),
		workflows: stream.workflows,
		required: stream.mustPublish ?? stream.required ?? [],
		...(stream.needs === undefined ? {} : { needs: stream.needs }),
		credentials: stream.credentials,
		channels: { stable: stream.channels.stable, prerelease: stream.channels.prerelease },
	}), value => value).annotate({ identifier: 'stream' });
}

const subscriptionCommon = { id: identifier, source: nonempty, stream: nonempty, operation: nonempty };
function subscriptionSchema() {
	const release = strictStruct({
		...subscriptionCommon,
		event: Schema.Literal('release'),
		sourceStream: Schema.optional(nonempty),
		sourceGroup: Schema.optional(nonempty),
		publication: Schema.optional(nonempty),
	});
	const packageChanged = strictStruct({ ...subscriptionCommon, event: Schema.Literal('package.version.changed') });
	const workflowRun = strictStruct({
		...subscriptionCommon,
		event: Schema.Literal('workflow_run'),
		workflow: Schema.String.check(
			matchesPattern(workflowFilePattern, { message: 'Workflow subscription requires an exact filename' }),
		),
	});
	return mapped(
		Schema.Union([release, packageChanged, workflowRun]),
		Schema.toType(subscriptionValue).check(
			Schema.makeFilter(value => value.event !== 'workflow_run' || typeof value.workflow === 'string'),
		),
		subscription => subscription,
		value =>
			value.event === 'workflow_run'
				? { ...value, event: 'workflow_run' as const, workflow: value.workflow ?? '' }
				: value.event === 'release'
				? { ...value, event: 'release' as const }
				: { ...value, event: 'package.version.changed' as const },
	).annotate({ identifier: 'subscription' });
}

const winget = mapped(
	strictStruct({
		config: refined(
			Schema.String.check(matchesPattern(winGetConfigPattern)),
			relativeWinGetConfig,
			'Invalid WinGet configuration path',
		).annotate({ description: 'Path to WinGet package JSON in the release commit' }),
		tagPrefix: Schema.String.check(matchesPattern(winGetTagPrefixPattern)).pipe(
			Schema.withDecodingDefault(Effect.succeed(defaultWinGetTagPrefix)),
		),
		automatic: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
	}),
	Schema.toType(wingetValue),
	({ config, tagPrefix, automatic }) => ({ config, tagPrefix, automatic }),
	value => value,
);

export type WorkflowBinding = Decoded<ReturnType<typeof bindingSchema>>;
export type Stream = Decoded<ReturnType<typeof streamSchema>>;
export type Subscription = Decoded<ReturnType<typeof subscriptionSchema>>;
export function operations(stream: Stream): ReadonlyMap<string, WorkflowBinding> {
	const result = new Map<string, WorkflowBinding>(Object.entries(stream.workflows));
	for (const name of reservedOperations) result.delete(name);
	if (stream.prepare.workflow) result.set('prepare', stream.prepare.workflow);
	if (stream.promote.workflow) result.set('promote', stream.promote.workflow);
	return result;
}

function graph(stream: Stream, path: (string | number)[], ctx: ValidationContext): void {
	const operationsOf = operations(stream);
	const where = (name: string): (string | number)[] =>
		reservedOperations.some(reserved => reserved === name) ? [...path, name, 'workflow'] : [...path, 'workflows', name];
	let cyclic = false;
	dependencyOrder(
		operationsOf.keys(),
		(name, dependent): Result.Result<readonly string[] | undefined> => {
			const operation = operationsOf.get(name);
			if (operation) return Result.succeed(operation.needs ?? []);
			if (dependent !== undefined) {
				issue(ctx, 'unknown-reference', `Unknown dependency ${name}`, [...where(dependent), 'needs']);
			}
			return Result.succeed(undefined);
		},
		name => {
			if (!cyclic) issue(ctx, 'cycle', 'Operation dependency cycle', where(name));
			cyclic = true;
			return Result.void;
		},
	);
	if (cyclic) return;
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
		for (const needed of Object.keys(operation.needsJobs ?? {})) {
			if (!operation.needs?.includes(needed) || operationsOf.get(needed)?.mode !== 'observe') {
				issue(ctx, 'unknown-reference', `needsJobs.${needed} must name an observed operation listed in needs`, [
					...where(name),
					'needsJobs',
					needed,
				]);
			}
		}
		if (operation.refs && !approved(name)) {
			issue(ctx, 'unknown-reference', 'Ref publication must run after the publishing workflow (promote)', [
				...where(name),
				'refs',
			]);
		}
	}
}

export const configurationSchema = mapped(
	withValidation(
		strictStruct({
			$schema: Schema.optional(Schema.String),
			extends: mutableArray(
				Schema.String.check(matchesPattern(presetReferencePattern, { message: 'Invalid preset reference' })),
			).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
			managers: mutableArray(Schema.Literals(managerNames)).pipe(
				Schema.withDecodingDefault(Effect.succeed([...managerNames])),
			),
			streams: mutableRecord(identifier, streamSchema()).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
			subscriptions: mutableArray(subscriptionSchema()).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
			winget: Schema.optional(winget),
			actionsRevision: Schema.optional(Schema.String.check(matchesPattern(actionsRevisionPattern))).annotate({
				description: 'Published Actions version or full commit that setup pins in generated workflows',
			}),
		}),
		(configuration, ctx) => {
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
		},
	),
	Schema.toType(configurationValue),
	configuration => ({
		...(configuration.winget === undefined ? {} : { winget: configuration.winget }),
		...(configuration.actionsRevision === undefined ? {} : { actionsRevision: configuration.actionsRevision }),
		extends: configuration.extends,
		managers: configuration.managers,
		streams: configuration.streams,
		subscriptions: configuration.subscriptions,
	}),
	value => value,
).annotate({ title: 'Repository release automation' });
export type ConfigurationInput = Encoded<typeof configurationSchema>;
export type Configuration = Decoded<typeof configurationSchema>;

export const configurationPath = '.github/beepboop.json';

function codeOf(issue: ReturnType<typeof schemaIssues>[number]): DiagnosticCode {
	if (issue.code !== 'custom') return 'invalid-configuration';
	const code = issue.params?.diagnostic;
	return typeof code === 'string' && isDiagnosticCode(code) ? code : 'invalid-configuration';
}

export function issueMessage(issue: ReturnType<typeof schemaIssues>[number]): string {
	return issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message;
}

export function configurationProblem(message: string, code: DiagnosticCode = 'invalid-configuration'): Diagnostic {
	return { code, severity: 'blocking', subject: { kind: 'file', path: configurationPath }, message };
}

export function configurationDiagnostics(error: Schema.SchemaError): Diagnostic[] {
	return schemaIssues(error).map(issue => configurationProblem(issueMessage(issue), codeOf(issue)));
}

export function configurationDrift(value: unknown, legacy: Configuration): Diagnostic[] {
	const parsed = safeDecode(configurationSchema, value);
	const drift = (message: string): Diagnostic => ({
		code: 'configuration-drift',
		severity: 'warning',
		subject: { kind: 'file', path: configurationPath },
		message,
	});
	if (!parsed.success) {
		return schemaIssues(parsed.error).map(issue => drift(`The configuration schema rejects ${issueMessage(issue)}`));
	}
	return JSON.stringify(parsed.data) === JSON.stringify(legacy)
		? []
		: [drift('The configuration schema reads this file differently from the current parser')];
}
