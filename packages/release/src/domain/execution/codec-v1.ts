import { Schema } from 'effect';
import { approvalRequest, executionStates } from '@/contract/views';
import { githubRunState } from '@/domain/github-run-state.ts';
import type { Edit } from '@/domain/inventory.ts';
import { inputSchema, outputSchema, platformSchema } from '@/domain/outputs.ts';
import { identityOf, packageId } from '@/domain/package-identity.ts';
import type { RefPlan, RefState } from '@/domain/refs.ts';
import { gateSkip } from '@/domain/release-gates.ts';
import { startChannel } from '@/domain/release-start.ts';
import { autoMergeMethods, versionPrMerge } from '@/domain/setup-terms.ts';
import { stringsSchema as strings } from '@/kernel/schema/result.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import { storedBinding, storedConfiguration } from '@/persistence/codecs/configuration';
import { identity, managerName, pkg, shas } from '@/persistence/codecs/v1';
import type { Publication } from '@/publication/publication.ts';
import { completion } from '@/release/domain/execution/execution.ts';
import type { ResolvedInput } from '@/release/domain/execution/outputs.ts';
import type {
	Artifact,
	AutomationEvent,
	Execution,
	PreparedRelease,
	ReleasePlan,
	ReleaseReference,
} from '@/release/domain/execution/types.ts';
import type { ReleaseSetPlan } from '@/release/domain/planning/plan.ts';

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
export const refPlanSchema: Schema.Codec<RefPlan, unknown> = mutableStruct({
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
export const preparationResultSchema = mutableStruct({
	url: Schema.String,
	head: Schema.String,
	kind: Schema.optional(Schema.Literal('commit')),
	autoMerge: Schema.optional(Schema.Union([
		mutableStruct({ method: autoMergeMethod, state: Schema.Literal('enabled') }),
		mutableStruct({ method: autoMergeMethod, state: Schema.Literal('refused'), note: Schema.String }),
	])),
});
const releaseStarted = mutableStruct({
	via: startChannel,
	actor: Schema.String,
	force: Schema.optional(Schema.Literal(true)),
});
export const preparedReleaseSchema: Schema.Codec<PreparedRelease, unknown> = mutableStruct({
	...preparationResultSchema.fields,
	started: Schema.optional(releaseStarted),
});
export const refStatesSchema: Schema.Codec<RefState[], unknown> = mutableArray(
	mutableStruct({ name: Schema.String, oid: Schema.String, commit: Schema.String }),
);
export const executionSchema: Schema.Codec<Execution, unknown> = mutableStruct({
	prepared: Schema.optional(
		mutableStruct({
			edits: mutableArray(edit),
			head: Schema.optional(Schema.String),
			result: Schema.optional(preparationResultSchema),
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
		result: Schema.optional(preparationResultSchema),
	})),
	resolvedInputs: Schema.optional(mutableArray(resolvedInput)),
	refPlan: Schema.optional(refPlanSchema),
	confirmedTagOid: Schema.optional(Schema.String),
	reclaims: Schema.optional(refStatesSchema),
	discoveredPublicationIds: Schema.optional(mutableArray(Schema.String)),
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
	started: Schema.optional(releaseStarted),
	skippedGates: Schema.optional(mutableArray(gateSkip)),
	reruns: Schema.optional(mutableArray(mutableStruct({ id: Schema.Finite, attempt: Schema.Finite }))),
	versionPrMerge: Schema.optional(versionPrMerge),
	approvedAt: Schema.optional(Schema.Finite),
	approvalRequest: Schema.optional(approvalRequest),
	publications: mutableArray(packagePublication),
	artifacts: mutableArray(artifact),
	createdAt: Schema.Finite,
	updatedAt: Schema.Finite,
	reason: Schema.optional(Schema.String),
});
export const automationEventSchema: Schema.Codec<AutomationEvent, unknown> = mutableStruct({
	occurredAt: Schema.optional(Schema.Finite),
	id: Schema.String,
	source: Schema.String,
	event: Schema.Literals(['release', 'workflow_run', 'package.version.changed']),
	version: Schema.optional(Schema.String),
	workflow: Schema.optional(Schema.String),
	release: Schema.optional(releaseReference),
});

export function identifyExecution(execution: Execution): Execution {
	return {
		...execution,
		publications: execution.publications.map(publication => {
			const identified = { ...publication, identity: identityOf(publication, execution.repository) };
			return {
				...identified,
				id: publication.id === `${publication.manager}:${publication.name}` || publication.id.startsWith('pkg:')
					? packageId(identified)
					: publication.id,
			};
		}),
	};
}
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
