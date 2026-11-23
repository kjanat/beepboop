import { Schema, Struct } from 'effect';
import { completion } from '@/automation/execution';
import type { ResolvedInput } from '@/automation/execution-outputs';
import type { ReleaseSetPlan } from '@/automation/planning';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	Publication,
	ReleasePlan,
	ReleaseReference,
} from '@/automation/types';
import { executionStates } from '@/contract/views';
import { managerDestinationIds, managerNames } from '@/domain/catalog.ts';
import type { ChannelOutcome, RegistryOutcome } from '@/domain/destinations.ts';
import { githubRunState } from '@/domain/github-run-state.ts';
import type { Edit, Package } from '@/domain/inventory.ts';
import { inputSchema, outputSchema, platformSchema } from '@/domain/outputs.ts';
import { publicationSchema } from '@/domain/package-publication.ts';
import type { RefPlan } from '@/domain/refs.ts';
import { gateSkip } from '@/domain/release-gates.ts';
import { startChannel } from '@/domain/release-start.ts';
import { autoMergeMethods, versionPrMerge } from '@/domain/setup-terms.ts';
import { diagnostic, isDiagnosticCode } from '@/kernel/errors/diagnostics.ts';
import { stringsSchema as strings } from '@/kernel/schema/result.ts';
import { decodeSync, mapped, mutableArray, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';
import type { PackageIdentity } from '@/package-url';
import { storedBinding, storedConfiguration } from '@/persistence/codecs/configuration';
import { identifyExecution, normalizePublication } from '@/persistence/codecs/stored';

export const managerName = Schema.Literals(managerNames);
export const shas = mutableRecord(Schema.String, Schema.String);
export const storedDiagnostic = mutableStruct({
	...diagnostic.fields,
	...{
		code: mapped(Schema.String, diagnostic.fields.code, code => isDiagnosticCode(code) ? code : 'legacy', code => code),
	},
});

const identity: Schema.Codec<PackageIdentity, unknown> = mutableStruct({
	type: Schema.String,
	name: Schema.String,
	namespace: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	qualifiers: Schema.optional(mutableRecord(Schema.String, Schema.String)),
	subpath: Schema.optional(Schema.String),
});
const publication = publicationSchema();
const _registryState = Schema.Union([
	mutableStruct({ state: Schema.Literal('published'), version: Schema.String }),
	mutableStruct({ state: Schema.Literal('missing') }),
	mutableStruct({ state: Schema.Literal('failed'), reason: Schema.String }),
	mutableStruct({ state: Schema.Literal('unchecked') }),
]);
export const channel = Schema.Union([
	mutableStruct({
		destination: Schema.Literal('homebrew'),
		kind: Schema.Literals(['cask', 'formula']),
		repository: Schema.String,
		directory: Schema.String,
		name: Schema.String,
		manifest: Schema.String,
	}),
	mutableStruct({
		destination: Schema.Literal('scoop'),
		repository: Schema.String,
		directory: Schema.String,
		name: Schema.String,
		manifest: Schema.String,
	}),
	mutableStruct({ destination: Schema.Literal('aur'), name: Schema.String, manifest: Schema.String }),
]);
function outcomeSchema<S extends Schema.Struct.Fields>(fields: S) {
	return Schema.Union([
		mutableStruct({ ...fields, state: Schema.Literal('published'), version: Schema.String }),
		mutableStruct({ ...fields, state: Schema.Literal('missing') }),
		mutableStruct({ ...fields, state: Schema.Literal('failed'), reason: Schema.String }),
		mutableStruct({ ...fields, state: Schema.Literal('unchecked') }),
	]);
}
export const channelOutcome: Schema.Codec<ChannelOutcome, unknown> = Schema.Union([
	outcomeSchema(channel.members[0].fields),
	outcomeSchema(channel.members[1].fields),
	outcomeSchema(channel.members[2].fields),
	mutableStruct({ ...channel.members[0].fields, state: Schema.Literal('tracking') }),
	mutableStruct({ ...channel.members[1].fields, state: Schema.Literal('tracking') }),
	mutableStruct({ ...channel.members[2].fields, state: Schema.Literal('tracking') }),
]);
const registryOutcome: Schema.Codec<RegistryOutcome, unknown> = Schema.Union([
	outcomeSchema({ destination: Schema.Literals(managerDestinationIds) }),
	channelOutcome,
]);
export const storedPackage = mutableStruct({
	identity: Schema.optional(identity),
	previousModule: Schema.optional(mutableStruct({ name: Schema.String, version: Schema.String })),
	publicationStatus: Schema.optional(Schema.Literals(['published', 'missing', 'failed', 'unchecked'])),
	destinations: Schema.optional(mutableArray(registryOutcome)),
	channels: Schema.optional(mutableArray(channel)),
	generated: Schema.optional(Schema.Boolean),
	optional: Schema.optional(Schema.Boolean),
	manager: managerName,
	name: Schema.String,
	version: Schema.optional(Schema.String),
	published: Schema.optional(Schema.String),
	manifest: Schema.String,
	versionSource: Schema.String,
	publication: Schema.optional(publication),
	publish: Schema.optional(Schema.Boolean),
	dependencies: strings,
});
const pkg: Schema.Codec<Package, unknown> = mapped(
	storedPackage,
	Schema.toType(mutableStruct({ ...Struct.omit(storedPackage.fields, ['publish']), publication })),
	normalizePublication,
	value => value,
);

const edit: Schema.Codec<Edit, unknown> = mutableStruct({
	path: Schema.String,
	before: Schema.String,
	after: Schema.String,
});
const releasePlan: Schema.Codec<ReleasePlan, unknown> = mutableStruct({
	lockfiles: Schema.optional(strings),
	version: Schema.String,
	sourceSha: Schema.String,
	edits: mutableArray(edit),
	packages: mutableArray(pkg),
	diagnostics: strings,
	requiresPreparation: Schema.Boolean,
});
const releaseSetPlan: Schema.Codec<ReleaseSetPlan, unknown> = mutableStruct({
	lockfiles: strings,
	sourceSha: Schema.String,
	groups: mutableArray(mutableStruct({ id: Schema.String, packages: strings, version: Schema.String })),
	operations: mutableArray(mutableStruct({
		id: Schema.String,
		group: Schema.String,
		needs: strings,
		platform: Schema.optional(platformSchema),
		inputs: mutableArray(inputSchema),
		outputs: mutableArray(outputSchema),
		version: Schema.String,
	})),
	publicationOrder: strings,
	edits: mutableArray(edit),
	diagnostics: strings,
	requiresPreparation: Schema.Boolean,
});
const plan = Schema.Union([releasePlan, releaseSetPlan]);
const outcome = Schema.Literals(['pending', 'succeeded', 'failed', 'cancelled', 'uncertain', 'skipped']);
const publicationFields = mutableStruct({
	identity: Schema.optional(identity),
	id: Schema.String,
	manager: managerName,
	name: Schema.String,
	version: Schema.String,
	digest: Schema.optional(Schema.String),
	url: Schema.optional(Schema.String),
	channel: Schema.optional(Schema.String),
	required: Schema.Boolean,
});
const packagePublication: Schema.Codec<Publication, unknown> = Schema.Union([
	mutableStruct({ ...publicationFields.fields, ...{ outcome } }),
	mutableStruct({
		...publicationFields.fields,
		...{
			outcome: Schema.Literal('rate-limited'),
			retryAfter: Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value)))),
		},
	}),
]);
const artifact: Schema.Codec<Artifact, unknown> = mutableStruct({
	id: Schema.Finite,
	runId: Schema.Finite,
	name: Schema.String,
	digest: Schema.String,
	expiresAt: Schema.String,
});
const releaseReference: Schema.Codec<ReleaseReference, unknown> = mutableStruct({
	id: Schema.String,
	group: Schema.optional(Schema.String),
	repository: mutableStruct({ id: Schema.Finite, name: Schema.String }),
	stream: Schema.String,
	commit: Schema.String,
	version: Schema.String,
	tag: Schema.optional(Schema.String),
	releaseId: Schema.optional(Schema.Finite),
	publications: mutableArray(packagePublication),
	artifacts: mutableArray(artifact),
});
const resolvedInput: Schema.Codec<ResolvedInput, unknown> = mutableStruct({
	...inputSchema.fields,
	executionId: Schema.String,
	sourceSha: Schema.String,
	version: Schema.optional(Schema.String),
	platform: Schema.optional(platformSchema),
	kind: outputSchema.fields.kind,
	artifact,
});
const refPlan: Schema.Codec<RefPlan, unknown> = mutableStruct({
	distribution: Schema.optional(mutableStruct({
		sourceSha: Schema.String,
		commit: Schema.String,
		tree: Schema.String,
		ancestryCommit: Schema.String,
		branch: Schema.String,
		expected: Schema.String,
	})),
	repository: Schema.String,
	executionId: Schema.String,
	version: Schema.String,
	changes: mutableArray(mutableStruct({
		name: Schema.String,
		expected: Schema.NullOr(Schema.String),
		commit: Schema.String,
		annotated: Schema.Boolean,
		signed: Schema.Boolean,
		object: Schema.optional(Schema.String),
		replaces: Schema.optional(Schema.Boolean),
	})),
	publicKey: Schema.optional(Schema.String),
});
const autoMergeMethod = Schema.Literals(autoMergeMethods);
const pullResult = mutableStruct({
	url: Schema.String,
	head: Schema.String,
	kind: Schema.optional(Schema.Literal('commit')),
	autoMerge: Schema.optional(Schema.Union([
		mutableStruct({ method: autoMergeMethod, state: Schema.Literal('enabled') }),
		mutableStruct({ method: autoMergeMethod, state: Schema.Literal('refused'), note: Schema.String }),
	])),
});
export const executionSchema: Schema.Codec<Execution, unknown> = mutableStruct({
	prepared: Schema.optional(
		mutableStruct({
			edits: mutableArray(edit),
			head: Schema.optional(Schema.String),
			result: Schema.optional(pullResult),
		}),
	),
	releaseSet: Schema.optional(mutableStruct({
		preparationId: Schema.String,
		group: Schema.String,
		required: strings,
		workflowId: Schema.optional(Schema.String),
		operationCount: Schema.optional(Schema.Finite),
		workflowError: Schema.optional(Schema.String),
	})),
	managed: Schema.optional(mutableStruct({
		kind: Schema.Literal('prepare'),
		plan,
		branch: Schema.String,
		title: Schema.String,
		body: Schema.String,
		head: Schema.optional(Schema.String),
		result: Schema.optional(pullResult),
	})),
	resolvedInputs: Schema.optional(mutableArray(resolvedInput)),
	refPlan: Schema.optional(refPlan),
	reclaims: Schema.optional(
		mutableArray(mutableStruct({ name: Schema.String, oid: Schema.String, commit: Schema.String })),
	),
	moduleTags: Schema.optional(mutableArray(mutableStruct({ id: Schema.String, prefix: Schema.String }))),
	packageTags: Schema.optional(
		mutableArray(mutableStruct({
			prefix: Schema.String,
			probes: mutableArray(mutableStruct({ reference: Schema.String, publication: packagePublication })),
		})),
	),
	refNamespace: Schema.optional(Schema.Literals(['heads', 'tags'])),
	upstreamRelease: Schema.optional(releaseReference),
	release: Schema.optional(releaseReference),
	plan: Schema.optional(plan),
	id: Schema.String,
	repositoryId: Schema.Finite,
	repository: Schema.String,
	stream: Schema.String,
	operation: Schema.String,
	eventId: Schema.String,
	configuration: storedConfiguration,
	configurationSha: Schema.String,
	presetShas: shas,
	sourceSha: Schema.String,
	workflowSha: Schema.optional(Schema.String),
	helperShas: Schema.optional(strings),
	version: Schema.optional(Schema.String),
	state: Schema.Literals(executionStates),
	dependencies: strings,
	workflow: Schema.optional(mutableStruct({ ...storedBinding.fields, ...{ ref: Schema.String } })),
	runId: Schema.optional(Schema.Finite),
	runAttempt: Schema.optional(Schema.Finite),
	github: Schema.optional(githubRunState),
	attempts: Schema.Finite,
	initiatedBy: Schema.optional(Schema.String),
	cancelledBy: Schema.optional(Schema.String),
	package: Schema.optional(mutableStruct({ id: Schema.String, manager: managerName })),
	reservation: Schema.optional(Schema.Literals(['new', 'update'])),
	notBefore: Schema.optional(Schema.Finite),
	supersededRuns: Schema.optional(mutableArray(Schema.Finite)),
	currentWorkflow: Schema.optional(Schema.Boolean),
	draftRelease: Schema.optional(mutableStruct({ id: Schema.Finite, tag: Schema.String })),
	titled: Schema.optional(Schema.Boolean),
	dispatchedAt: Schema.optional(Schema.Finite),
	approvedBy: Schema.optional(Schema.Literals(['merge', 'start'])),
	started: Schema.optional(
		mutableStruct({ via: startChannel, actor: Schema.String, force: Schema.optional(Schema.Literal(true)) }),
	),
	skippedGates: Schema.optional(mutableArray(gateSkip)),
	reruns: Schema.optional(mutableArray(mutableStruct({ id: Schema.Finite, attempt: Schema.Finite }))),
	versionPrMerge: Schema.optional(versionPrMerge),
	approvedAt: Schema.optional(Schema.Finite),
	publications: mutableArray(packagePublication),
	artifacts: mutableArray(artifact),
	createdAt: Schema.Finite,
	updatedAt: Schema.Finite,
	reason: Schema.optional(Schema.String),
});
const automationEventSchema: Schema.Codec<AutomationEvent, unknown> = mutableStruct({
	occurredAt: Schema.optional(Schema.Finite),
	id: Schema.String,
	source: Schema.String,
	event: Schema.Literals(['release', 'workflow_run', 'package.version.changed']),
	version: Schema.optional(Schema.String),
	workflow: Schema.optional(Schema.String),
	release: Schema.optional(releaseReference),
});

export function currentState(execution: Execution): Execution {
	const actor = execution.reason?.match(/^Cancelled by (.+)$/)?.[1];
	if (execution.state === 'cancelled' && execution.cancelledBy === undefined && actor !== undefined) {
		return { ...execution, cancelledBy: actor };
	}
	if (execution.state !== 'blocked' || execution.github?.kind === 'action-required') return execution;
	if (execution.operation === 'promote' && execution.attempts === 0 && execution.approvedAt === undefined) {
		return { ...execution, state: 'awaiting-approval' };
	}
	if (execution.runId !== undefined && completion(execution, true) === 'verifying') {
		return { ...execution, state: 'verifying' };
	}
	return execution;
}
export function decodeExecutionV1(value: unknown): Execution {
	return currentState(identifyExecution(decodeSync(executionSchema, value)));
}
export function decodeEventV1(value: unknown): AutomationEvent {
	return decodeSync(automationEventSchema, value);
}
