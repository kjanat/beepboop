import { z } from 'zod';
import type { Channel, ChannelOutcome, RegistryOutcome } from '@/automation/destinations';
import { versionFileSchema } from '@/automation/editors';
import { inputSchema, outputSchema, platformSchema, type ResolvedInput } from '@/automation/outputs';
import {
	identifyExecution,
	identifyRepository,
	normalizePublication,
	type StoredInventory,
	type StoredPackage,
	type StoredRepository,
} from '@/automation/package-identity';
import { exclusionReasons, type PackagePublication } from '@/automation/package-publication';
import type { ReleaseSetPlan } from '@/automation/planning';
import type { RefPlan, RefPolicy } from '@/automation/refs';
import { type SetupEdit, setupChoicesSchema } from '@/automation/setup-types';
import type {
	Artifact,
	AutomationEvent,
	Configuration,
	DiscoveredWorkflow,
	Edit,
	Execution,
	Package,
	Publication,
	ReleasePlan,
	ReleaseReference,
	RepositoryRecord,
	Stream,
	Subscription,
	SubscriptionDelivery,
	WorkflowBinding,
} from '@/automation/types';
import type { WinGetPolicy } from '@/automation/winget';
import { managerDestinationIds, managerNames } from '@/contract/catalog';
import type { PackageIdentity } from '@/package-url';

const managerName = z.enum(managerNames);
const strings = z.array(z.string());
const shas = z.record(z.string(), z.string());

const refPolicy: z.ZodType<RefPolicy> = z.object({
	phase: z.enum(['version', 'aliases']),
	prefix: z.string(),
	aliases: z.array(z.enum(['major', 'minor'])),
	signed: z.boolean(),
});
const binding = {
	outputs: z.array(outputSchema).optional(),
	artifactInputs: z.array(inputSchema).optional(),
	platform: platformSchema.optional(),
	refs: refPolicy.optional(),
	mode: z.enum(['observe', 'dispatch']).optional(),
	each: z.literal('package').optional(),
	needs: strings.optional(),
	publications: strings.optional(),
	schedule: z.string().optional(),
	file: z.string(),
	ref: z.string().optional(),
	inputs: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
	required: z.boolean().optional(),
};
const workflowBinding: z.ZodType<WorkflowBinding> = z.object(binding);
const stream: z.ZodType<Stream> = z.object({
	versionFiles: z.array(versionFileSchema).optional(),
	versionSource: z.object({ kind: z.literal('tags'), prefix: z.string() }).optional(),
	packages: strings.optional(),
	versioning: z.enum(['workspace', 'independent', 'none']),
	concurrency: z.enum(['queue', 'supersede-pending']),
	prepare: z.object({
		strategy: z.enum(['managed', 'workflow']).optional(),
		version: z.literal('manual'),
		workflow: workflowBinding.optional(),
	}),
	promote: z.object({ approval: z.enum(['required', 'merge', 'push']), workflow: workflowBinding.optional() }),
	workflows: z.record(z.string(), workflowBinding),
	required: strings,
	credentials: strings,
	channels: z.object({ stable: z.string(), prerelease: z.string() }),
});
const subscription: z.ZodType<Subscription> = z.object({
	id: z.string(),
	sourceStream: z.string().optional(),
	sourceGroup: z.string().optional(),
	publication: z.string().optional(),
	source: z.string(),
	event: z.enum(['release', 'package.version.changed', 'workflow_run']),
	stream: z.string(),
	operation: z.string(),
	workflow: z.string().optional(),
});
const winget: z.ZodType<WinGetPolicy> = z.object({
	config: z.string(),
	tagPrefix: z.string(),
	automatic: z.boolean(),
});
const configuration: z.ZodType<Configuration> = z.object({
	winget: winget.optional(),
	extends: strings,
	managers: z.array(managerName),
	streams: z.record(z.string(), stream),
	subscriptions: z.array(subscription),
});

const identity: z.ZodType<PackageIdentity> = z.object({
	type: z.string(),
	name: z.string(),
	namespace: z.string().optional(),
	version: z.string().optional(),
	qualifiers: z.record(z.string(), z.string()).optional(),
	subpath: z.string().optional(),
});
const publication: z.ZodType<PackagePublication> = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('registry') }),
	z.object({ kind: z.literal('excluded'), reason: z.enum(exclusionReasons) }),
]);
const registryState = z.discriminatedUnion('state', [
	z.object({ state: z.literal('published'), version: z.string() }),
	z.object({ state: z.literal('missing') }),
	z.object({ state: z.literal('failed'), reason: z.string() }),
	z.object({ state: z.literal('unchecked') }),
]);
const channel: z.ZodType<Channel> = z.discriminatedUnion('destination', [
	z.object({
		destination: z.literal('homebrew'),
		kind: z.enum(['cask', 'formula']),
		repository: z.string(),
		directory: z.string(),
		name: z.string(),
		manifest: z.string(),
	}),
	z.object({
		destination: z.literal('scoop'),
		repository: z.string(),
		directory: z.string(),
		name: z.string(),
		manifest: z.string(),
	}),
	z.object({ destination: z.literal('aur'), name: z.string(), manifest: z.string() }),
]);
const channelOutcome: z.ZodType<ChannelOutcome> = z.intersection(
	channel,
	z.union([registryState, z.object({ state: z.literal('tracking') })]),
);
const registryOutcome: z.ZodType<RegistryOutcome> = z.union([
	z.intersection(z.object({ destination: z.enum(managerDestinationIds) }), registryState),
	channelOutcome,
]);
const storedPackage: z.ZodType<StoredPackage> = z.object({
	identity: identity.optional(),
	previousModule: z.object({ name: z.string(), version: z.string() }).optional(),
	publicationStatus: z.enum(['published', 'missing', 'failed', 'unchecked']).optional(),
	destinations: z.array(registryOutcome).optional(),
	channels: z.array(channel).optional(),
	generated: z.boolean().optional(),
	optional: z.boolean().optional(),
	manager: managerName,
	name: z.string(),
	version: z.string().optional(),
	published: z.string().optional(),
	manifest: z.string(),
	versionSource: z.string(),
	publication: publication.optional(),
	publish: z.boolean().optional(),
	dependencies: strings,
});
const pkg: z.ZodType<Package> = storedPackage.transform(normalizePublication);
const discoveredWorkflow: z.ZodType<DiscoveredWorkflow> = z.object({
	tagPatterns: strings.optional(),
	branchPatterns: strings.optional(),
	createsRelease: z.boolean().optional(),
	file: z.string(),
	name: z.string(),
	events: strings,
	jobs: strings,
	localActions: strings,
	dispatchInputs: strings,
	publication: z.boolean(),
});
const inventory: z.ZodType<StoredInventory> = z.object({
	references: z.array(z.object({ repository: z.string(), path: z.string(), ref: z.string() })).optional(),
	channels: z.array(channel).optional(),
	destinations: z.array(channelOutcome).optional(),
	packages: z.array(storedPackage),
	workflows: z.array(discoveredWorkflow),
	managers: z.array(managerName),
	diagnostics: strings,
	publicationOrder: strings,
});
const repositorySchema: z.ZodType<StoredRepository> = z.object({
	suspended: z.boolean().optional(),
	id: z.number(),
	name: z.string(),
	defaultBranch: z.string(),
	sha: z.string(),
	configuration: configuration.optional(),
	presetShas: shas,
	inventory,
	diagnostics: strings,
	updatedAt: z.number(),
});

const edit: z.ZodType<Edit> = z.object({ path: z.string(), before: z.string(), after: z.string() });
const releasePlan: z.ZodType<ReleasePlan> = z.object({
	lockfiles: strings.optional(),
	version: z.string(),
	sourceSha: z.string(),
	edits: z.array(edit),
	packages: z.array(pkg),
	diagnostics: strings,
	requiresPreparation: z.boolean(),
});
const releaseSetPlan: z.ZodType<ReleaseSetPlan> = z.object({
	lockfiles: strings,
	sourceSha: z.string(),
	groups: z.array(z.object({ id: z.string(), packages: strings, version: z.string() })),
	operations: z.array(z.object({
		id: z.string(),
		group: z.string(),
		needs: strings,
		platform: platformSchema.optional(),
		inputs: z.array(inputSchema),
		outputs: z.array(outputSchema),
		version: z.string(),
	})),
	publicationOrder: strings,
	edits: z.array(edit),
	diagnostics: strings,
	requiresPreparation: z.boolean(),
});
const plan = z.union([releasePlan, releaseSetPlan]);
const outcome = z.enum(['pending', 'succeeded', 'failed', 'uncertain', 'skipped']);
const publicationFields = z.object({
	identity: identity.optional(),
	id: z.string(),
	manager: managerName,
	name: z.string(),
	version: z.string(),
	digest: z.string().optional(),
	url: z.string().optional(),
	channel: z.string().optional(),
	required: z.boolean(),
});
const packagePublication: z.ZodType<Publication> = z.union([
	publicationFields.extend({ outcome }),
	publicationFields.extend({ outcome: z.literal('rate-limited'), retryAfter: z.iso.datetime({ offset: true }) }),
]);
const artifact: z.ZodType<Artifact> = z.object({
	id: z.number(),
	runId: z.number(),
	name: z.string(),
	digest: z.string(),
	expiresAt: z.string(),
});
const releaseReference: z.ZodType<ReleaseReference> = z.object({
	id: z.string(),
	group: z.string().optional(),
	repository: z.object({ id: z.number(), name: z.string() }),
	stream: z.string(),
	commit: z.string(),
	version: z.string(),
	tag: z.string().optional(),
	releaseId: z.number().optional(),
	publications: z.array(packagePublication),
	artifacts: z.array(artifact),
});
const resolvedInput: z.ZodType<ResolvedInput> = z.object({
	...inputSchema.shape,
	executionId: z.string(),
	sourceSha: z.string(),
	version: z.string().optional(),
	platform: platformSchema.optional(),
	kind: outputSchema.shape.kind,
	artifact,
});
const refPlan: z.ZodType<RefPlan> = z.object({
	repository: z.string(),
	executionId: z.string(),
	version: z.string(),
	changes: z.array(z.object({
		name: z.string(),
		expected: z.string().nullable(),
		commit: z.string(),
		annotated: z.boolean(),
		signed: z.boolean(),
	})),
});
const pullResult = z.object({ url: z.string(), head: z.string() });
const executionSchema: z.ZodType<Execution> = z.object({
	prepared: z.object({ edits: z.array(edit), head: z.string().optional(), result: pullResult.optional() }).optional(),
	releaseSet: z.object({
		preparationId: z.string(),
		group: z.string(),
		required: strings,
		workflowId: z.string().optional(),
		operationCount: z.number().optional(),
		workflowError: z.string().optional(),
	}).optional(),
	managed: z.object({
		kind: z.literal('prepare'),
		plan,
		branch: z.string(),
		title: z.string(),
		body: z.string(),
		head: z.string().optional(),
		result: pullResult.optional(),
	}).optional(),
	resolvedInputs: z.array(resolvedInput).optional(),
	refPlan: refPlan.optional(),
	upstreamRelease: releaseReference.optional(),
	release: releaseReference.optional(),
	plan: plan.optional(),
	id: z.string(),
	repositoryId: z.number(),
	repository: z.string(),
	stream: z.string(),
	operation: z.string(),
	eventId: z.string(),
	configuration,
	configurationSha: z.string(),
	presetShas: shas,
	sourceSha: z.string(),
	workflowSha: z.string().optional(),
	helperShas: strings.optional(),
	version: z.string().optional(),
	state: z.enum([
		'pending',
		'blocked',
		'ready',
		'dispatching',
		'running',
		'succeeded',
		'failed',
		'cancelled',
		'uncertain',
	]),
	dependencies: strings,
	workflow: z.object({ ...binding, ref: z.string() }).optional(),
	runId: z.number().optional(),
	runAttempt: z.number().optional(),
	attempts: z.number(),
	package: z.object({ id: z.string(), manager: managerName }).optional(),
	reservation: z.enum(['new', 'update']).optional(),
	notBefore: z.number().optional(),
	supersededRuns: z.array(z.number()).optional(),
	draftRelease: z.object({ id: z.number(), tag: z.string() }).optional(),
	titled: z.boolean().optional(),
	dispatchedAt: z.number().optional(),
	approvedBy: z.literal('merge').optional(),
	approvedAt: z.number().optional(),
	publications: z.array(packagePublication),
	artifacts: z.array(artifact),
	createdAt: z.number(),
	updatedAt: z.number(),
	reason: z.string().optional(),
});
const automationEventSchema: z.ZodType<AutomationEvent> = z.object({
	id: z.string(),
	source: z.string(),
	event: z.enum(['release', 'workflow_run', 'package.version.changed']),
	version: z.string().optional(),
	workflow: z.string().optional(),
	release: releaseReference.optional(),
});
const deliverySchema: z.ZodType<SubscriptionDelivery> = z.object({
	id: z.string(),
	eventId: z.string(),
	repositoryId: z.number(),
	execution: executionSchema,
});
const setupEditSchema: z.ZodType<SetupEdit> = z.object({
	repositoryId: z.number(),
	number: z.number(),
	head: z.string(),
	body: z.string(),
	choices: setupChoicesSchema,
	due: z.number(),
});

export function decodeRepositoryV1(value: unknown): RepositoryRecord {
	return identifyRepository(repositorySchema.parse(value));
}
export function decodeExecutionV1(value: unknown): Execution {
	return identifyExecution(executionSchema.parse(value));
}
export function decodeEventV1(value: unknown): AutomationEvent {
	return automationEventSchema.parse(value);
}
export function decodeDeliveryV1(value: unknown): SubscriptionDelivery {
	const delivery = deliverySchema.parse(value);
	return { ...delivery, execution: identifyExecution(delivery.execution) };
}
export function decodeSetupEditV1(value: unknown): SetupEdit {
	return setupEditSchema.parse(value);
}
