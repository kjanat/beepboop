import { z } from 'zod';
import { changesResponse } from '@/contract/changes';
import {
	claimStep,
	nextStep,
	publishClaimRequest,
	publishNextRequest,
	publishReportRequest,
	reportStep,
} from '@/contract/ledger';
import { destinationInput, subscriptionInput, watchInput } from '@/contract/notifications';
import {
	acknowledged,
	approvalReadiness,
	binaryProgress,
	credentialsView,
	executionView,
	notificationsView,
	planReview,
	repositoryView,
	securityChallenge,
	securityProof,
} from '@/contract/views';
import { shaSchema as sha, textSchema as text } from '@/model';

export type Method = 'GET' | 'POST';
export type Auth = 'admin' | 'elevated' | 'workflow' | 'workflow-token';

export interface Route<Q extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> {
	method: Method;
	path: `/api/${string}`;
	auth: Auth;
	idempotent: boolean;
	request: Q;
	response: R;
}

function route<const Q extends z.ZodType, const R extends z.ZodType>(definition: Route<Q, R>): Route<Q, R> {
	return definition;
}

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const proof = text.optional();
const none = z.object({});
const executionRef = z.object({ id: text, repositoryId: id.optional() });

export const routes = {
	wingetList: route({
		method: 'GET',
		path: '/api/winget',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: z.unknown(),
	}),
	repositoriesList: route({
		method: 'GET',
		path: '/api/repositories',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: z.array(repositoryView),
	}),
	executionsList: route({
		method: 'GET',
		path: '/api/executions',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: z.array(executionView),
	}),
	notificationsList: route({
		method: 'GET',
		path: '/api/notifications',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: notificationsView,
	}),
	credentialsList: route({
		method: 'GET',
		path: '/api/credentials',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: credentialsView,
	}),
	wingetRefresh: route({
		method: 'POST',
		path: '/api/winget/refresh',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: acknowledged,
	}),
	wingetReleases: route({
		method: 'POST',
		path: '/api/winget/releases',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repositoryId: id }),
		response: z.array(z.looseObject({ id: z.number(), tag: z.string(), name: z.string() })),
	}),
	wingetPreview: route({
		method: 'POST',
		path: '/api/winget/preview',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repositoryId: id, releaseId: id }),
		response: z.looseObject({ digest: z.string(), sourceSha: z.string(), files: z.record(z.string(), z.string()) }),
	}),
	wingetSubmit: route({
		method: 'POST',
		path: '/api/winget/submit',
		auth: 'admin',
		idempotent: false,
		request: z.object({ repositoryId: id, releaseId: id, digest: text }),
		response: z.unknown(),
	}),
	repositoriesResolve: route({
		method: 'POST',
		path: '/api/repositories/resolve',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repository: text }),
		response: repositoryView,
	}),
	repositoriesDiscover: route({
		method: 'POST',
		path: '/api/repositories/discover',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repository: text, repositoryId: id.optional() }),
		response: repositoryView,
	}),
	setupPreview: route({
		method: 'POST',
		path: '/api/repositories/setup/preview',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repository: text, choices: z.unknown().optional() }),
		response: z.unknown(),
	}),
	setupApply: route({
		method: 'POST',
		path: '/api/repositories/setup/apply',
		auth: 'admin',
		idempotent: false,
		request: z.object({
			repository: text,
			choices: z.unknown().optional(),
			planId: z.string(),
			sourceSha: z.string(),
			setupHead: z.string().nullable(),
			takeOver: z.boolean().optional(),
		}),
		response: z.looseObject({ url: z.string() }),
	}),
	hooksUpdate: route({
		method: 'POST',
		path: '/api/releases/update-references',
		auth: 'admin',
		idempotent: false,
		request: z.object({ repositoryId: id, releaseEventId: text, preview: z.boolean().optional() }),
		response: z.unknown(),
	}),
	releasesStartSet: route({
		method: 'POST',
		path: '/api/releases/start-set',
		auth: 'admin',
		idempotent: true,
		request: z.object({ preparationId: text, sourceSha: sha }),
		response: z.array(executionView),
	}),
	releasesPlanSet: route({
		method: 'POST',
		path: '/api/releases/plan-set',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repositoryId: id, stream: text, plan: z.unknown() }),
		response: planReview,
	}),
	releasesPrepareSet: route({
		method: 'POST',
		path: '/api/releases/prepare-set',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repositoryId: id, stream: text, plan: z.unknown(), sourceSha: sha, planId: z.string() }),
		response: executionView,
	}),
	releasesPlan: route({
		method: 'POST',
		path: '/api/releases/plan',
		auth: 'admin',
		idempotent: true,
		request: z.object({ repositoryId: id, stream: text, version: z.unknown(), packages: z.array(text).optional() }),
		response: planReview,
	}),
	releasesPrepare: route({
		method: 'POST',
		path: '/api/releases/prepare',
		auth: 'admin',
		idempotent: true,
		request: z.object({
			repositoryId: id,
			stream: text,
			version: z.unknown(),
			packages: z.array(text).optional(),
			sourceSha: sha,
			planId: z.string(),
		}),
		response: executionView,
	}),
	executionsBinaries: route({
		method: 'POST',
		path: '/api/executions/binaries',
		auth: 'admin',
		idempotent: true,
		request: executionRef,
		response: binaryProgress,
	}),
	executionsApproval: route({
		method: 'POST',
		path: '/api/executions/approval',
		auth: 'admin',
		idempotent: true,
		request: executionRef,
		response: approvalReadiness,
	}),
	executionsCancel: route({
		method: 'POST',
		path: '/api/executions/cancel',
		auth: 'admin',
		idempotent: true,
		request: executionRef,
		response: executionView,
	}),
	executionsApprove: route({
		method: 'POST',
		path: '/api/executions/approve',
		auth: 'admin',
		idempotent: true,
		request: executionRef.extend({ sourceSha: sha, force: z.boolean().optional() }),
		response: executionView,
	}),
	executionsRecover: route({
		method: 'POST',
		path: '/api/executions/recover',
		auth: 'admin',
		idempotent: false,
		request: executionRef.extend({ action: z.enum(['retry', 'reconcile']) }),
		response: executionView,
	}),
	cliSessionsRevoke: route({
		method: 'POST',
		path: '/api/cli-sessions/revoke',
		auth: 'admin',
		idempotent: true,
		request: z.object({ id: text }),
		response: acknowledged,
	}),
	cliSessionsRevokeAll: route({
		method: 'POST',
		path: '/api/cli-sessions/revoke-all',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: acknowledged,
	}),
	authenticatorsOptions: route({
		method: 'POST',
		path: '/api/authenticators/options',
		auth: 'admin',
		idempotent: false,
		request: z.object({ register: z.boolean().optional(), label: z.string().optional(), proof }),
		response: securityChallenge,
	}),
	authenticatorsVerify: route({
		method: 'POST',
		path: '/api/authenticators/verify',
		auth: 'admin',
		idempotent: false,
		request: z.object({ id: text, response: z.unknown() }),
		response: securityProof,
	}),
	authenticatorsRemove: route({
		method: 'POST',
		path: '/api/authenticators/remove',
		auth: 'elevated',
		idempotent: false,
		request: z.object({ id: text, proof }),
		response: z.looseObject({ removed: z.boolean() }),
	}),
	packagesAdd: route({
		method: 'POST',
		path: '/api/packages/add',
		auth: 'admin',
		idempotent: true,
		request: watchInput,
		response: acknowledged,
	}),
	packagesRemove: route({
		method: 'POST',
		path: '/api/packages/remove',
		auth: 'admin',
		idempotent: true,
		request: watchInput,
		response: acknowledged,
	}),
	packagesSubscription: route({
		method: 'POST',
		path: '/api/packages/subscription',
		auth: 'admin',
		idempotent: true,
		request: subscriptionInput,
		response: acknowledged,
	}),
	notificationsSave: route({
		method: 'POST',
		path: '/api/notifications/save',
		auth: 'admin',
		idempotent: false,
		request: z.object({ destination: destinationInput }),
		response: z.looseObject({ id: z.string() }),
	}),
	notificationsRemove: route({
		method: 'POST',
		path: '/api/notifications/remove',
		auth: 'admin',
		idempotent: true,
		request: z.object({ id: text }),
		response: acknowledged,
	}),
	credentialsReplace: route({
		method: 'POST',
		path: '/api/credentials/replace',
		auth: 'elevated',
		idempotent: false,
		request: z.object({ alias: text, value: text, proof, expectedVersion: z.number().int().nullable().optional() }),
		response: z.looseObject({ version: z.number() }),
	}),
	credentialsReveal: route({
		method: 'POST',
		path: '/api/credentials/reveal',
		auth: 'elevated',
		idempotent: false,
		request: z.object({ alias: text, proof }),
		response: z.looseObject({ value: z.string(), version: z.number() }),
	}),
	credentialsSync: route({
		method: 'POST',
		path: '/api/credentials/sync',
		auth: 'elevated',
		idempotent: false,
		request: z.object({ alias: text, proof }),
		response: z.array(z.looseObject({ id: z.string(), state: z.string() })),
	}),
	credentialsGrant: route({
		method: 'POST',
		path: '/api/credentials/grant',
		auth: 'elevated',
		idempotent: false,
		request: z.object({ selection: z.looseObject({ repositoryId: id }), proof }),
		response: z.looseObject({ granted: z.boolean() }),
	}),
	credentialsRevoke: route({
		method: 'POST',
		path: '/api/credentials/revoke',
		auth: 'elevated',
		idempotent: false,
		request: z.object({ grantId: text, proof }),
		response: z.looseObject({ revoked: z.boolean() }),
	}),
	changes: route({
		method: 'GET',
		path: '/api/v1/changes',
		auth: 'admin',
		idempotent: true,
		request: z.object({
			since: z.coerce.number().int().nonnegative(),
			repositoryId: z.coerce.number().pipe(id).optional(),
		}),
		response: changesResponse,
	}),
	adminReindex: route({
		method: 'POST',
		path: '/api/v1/admin/reindex',
		auth: 'elevated',
		idempotent: true,
		request: z.object({ repositoryId: id.optional(), proof }),
		response: z.object({ queued: z.number().int().nonnegative() }),
	}),
	workflowToken: route({
		method: 'POST',
		path: '/api/workflow/token',
		auth: 'workflow-token',
		idempotent: false,
		request: z.object({
			permissions: z.unknown().optional(),
			purpose: z.string().optional(),
			identity: z.boolean().optional(),
			executionId: z.string().optional(),
		}),
		response: z.looseObject({
			token: z.string(),
			bot: z.looseObject({ login: z.string(), id: z.number(), email: z.string() }).optional(),
		}),
	}),
	workflowStart: route({
		method: 'POST',
		path: '/api/workflow/start',
		auth: 'workflow',
		idempotent: true,
		request: z.object({ stream: z.string().min(1), version: z.string().min(1) }),
		response: executionView,
	}),
	workflowBegin: route({
		method: 'POST',
		path: '/api/workflow/begin',
		auth: 'workflow',
		idempotent: true,
		request: z.object({
			executionId: z.string().optional(),
			stream: z.string().optional(),
			operation: z.string().optional(),
			version: z.string().optional(),
		}),
		response: executionView,
	}),
	workflowPrepared: route({
		method: 'POST',
		path: '/api/workflow/prepared',
		auth: 'workflow',
		idempotent: true,
		request: z.object({ executionId: text, files: z.array(z.object({ path: text, content: text })) }),
		response: z.unknown(),
	}),
	workflowReport: route({
		method: 'POST',
		path: '/api/workflow/report',
		auth: 'workflow',
		idempotent: true,
		request: z.object({
			executionId: text,
			publications: z.array(z.unknown()).optional(),
			artifacts: z.array(z.unknown()).optional(),
		}),
		response: executionView,
	}),
	workflowCredentials: route({
		method: 'POST',
		path: '/api/workflow/credentials',
		auth: 'workflow',
		idempotent: true,
		request: z.object({ executionId: text, aliases: z.array(text) }),
		response: z.record(z.string(), z.string()),
	}),
	workflowRefsPlan: route({
		method: 'POST',
		path: '/api/workflow/refs-plan',
		auth: 'workflow',
		idempotent: true,
		request: z.object({ executionId: text }),
		response: z.unknown(),
	}),
	workflowRefsComplete: route({
		method: 'POST',
		path: '/api/workflow/refs-complete',
		auth: 'workflow',
		idempotent: true,
		request: z.object({ executionId: text }),
		response: z.unknown(),
	}),
	workflowRelease: route({
		method: 'POST',
		path: '/api/workflow/release',
		auth: 'workflow',
		idempotent: true,
		request: z.object({ executionId: text }),
		response: z.unknown(),
	}),
	workflowPublishNext: route({
		method: 'POST',
		path: '/api/workflow/publish/next',
		auth: 'workflow',
		idempotent: true,
		request: publishNextRequest,
		response: nextStep,
	}),
	workflowPublishClaim: route({
		method: 'POST',
		path: '/api/workflow/publish/claim',
		auth: 'workflow',
		idempotent: true,
		request: publishClaimRequest,
		response: claimStep,
	}),
	workflowPublishReport: route({
		method: 'POST',
		path: '/api/workflow/publish/report',
		auth: 'workflow',
		idempotent: true,
		request: publishReportRequest,
		response: reportStep,
	}),
} as const;

export type Routes = typeof routes;
export type RouteId = keyof Routes;
export type AnyRoute = Route<z.ZodType, z.ZodType>;
export type RequestOf<R extends AnyRoute> = z.output<R['request']>;
export type InputOf<R extends AnyRoute> = z.input<R['request']>;
export type ResponseOf<R extends AnyRoute> = z.output<R['response']>;
export type Known<T> = T extends readonly (infer U)[] ? Known<U>[]
	: T extends object ? { [P in keyof T as string extends P ? never : P]: Known<T[P]> }
	: T;
export type ResultOf<R extends AnyRoute> = Known<z.input<R['response']>>;

export function isRouteId(key: string): key is RouteId {
	return Object.hasOwn(routes, key);
}
export const routeIds: readonly RouteId[] = Object.keys(routes).filter(isRouteId);
