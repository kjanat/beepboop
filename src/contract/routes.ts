import { Schema } from 'effect';
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
import { versionPrMerge } from '@/contract/setup-terms';
import {
	acknowledged,
	approvalReadiness,
	binaryProgress,
	credentialsView,
	executionStates,
	executionView,
	notificationsView,
	planReview,
	repositoryView,
	securityChallenge,
	securityProof,
} from '@/contract/views';
import { shaSchema as sha, textSchema as text } from '@/model';
import type { Contract, Decoded, Encoded } from '@/schema';
import { looseStruct, mutableArray, mutableRecord, mutableStruct, numberFromInput, refined } from '@/schema';

export type Method = 'GET' | 'POST';
export type Auth = 'admin' | 'elevated' | 'workflow' | 'workflow-token';

export interface Route<Q extends Contract = Contract, R extends Contract = Contract> {
	method: Method;
	path: `/api/${string}`;
	auth: Auth;
	idempotent: boolean;
	request: Q;
	response: R;
}

function route<const Q extends Contract, const R extends Contract>(definition: Route<Q, R>): Route<Q, R> {
	return definition;
}

const id = Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)).check(
	Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const proof = Schema.optional(text);
const none = mutableStruct({});
const executionRef = mutableStruct({ id: text, repositoryId: Schema.optional(id) });
export const executionFilter = mutableStruct({
	repository: Schema.optional(text),
	stream: Schema.optional(text),
	operation: Schema.optional(text),
	states: Schema.optional(
		refined(
			text,
			value => value.split(',').every(state => (executionStates as readonly string[]).includes(state)),
			'Unknown execution state',
		),
	),
	version: Schema.optional(text),
	limit: Schema.optional(
		numberFromInput.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(
			Schema.isLessThanOrEqualTo(200),
		),
	),
});
export type ExecutionFilter = Decoded<typeof executionFilter>;

export const routes = {
	wingetList: route({
		method: 'GET',
		path: '/api/winget',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: Schema.Unknown,
	}),
	repositoriesList: route({
		method: 'GET',
		path: '/api/repositories',
		auth: 'admin',
		idempotent: true,
		request: none,
		response: mutableArray(repositoryView),
	}),
	executionsList: route({
		method: 'GET',
		path: '/api/executions',
		auth: 'admin',
		idempotent: true,
		request: executionFilter,
		response: mutableArray(executionView),
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
		request: mutableStruct({ repositoryId: id }),
		response: mutableArray(looseStruct({ id: Schema.Finite, tag: Schema.String, name: Schema.String })),
	}),
	wingetPreview: route({
		method: 'POST',
		path: '/api/winget/preview',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ repositoryId: id, releaseId: id }),
		response: looseStruct({
			digest: Schema.String,
			sourceSha: Schema.String,
			files: mutableRecord(Schema.String, Schema.String),
		}),
	}),
	wingetSubmit: route({
		method: 'POST',
		path: '/api/winget/submit',
		auth: 'admin',
		idempotent: false,
		request: mutableStruct({ repositoryId: id, releaseId: id, digest: text }),
		response: Schema.Unknown,
	}),
	repositoriesResolve: route({
		method: 'POST',
		path: '/api/repositories/resolve',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ repository: text }),
		response: repositoryView,
	}),
	repositoriesDiscover: route({
		method: 'POST',
		path: '/api/repositories/discover',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ repository: text, repositoryId: Schema.optional(id) }),
		response: repositoryView,
	}),
	setupPreview: route({
		method: 'POST',
		path: '/api/repositories/setup/preview',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ repository: text, choices: Schema.optional(Schema.Unknown) }),
		response: Schema.Unknown,
	}),
	setupApply: route({
		method: 'POST',
		path: '/api/repositories/setup/apply',
		auth: 'admin',
		idempotent: false,
		request: mutableStruct({
			repository: text,
			choices: Schema.optional(Schema.Unknown),
			planId: Schema.String,
			sourceSha: Schema.String,
			setupHead: Schema.NullOr(Schema.String),
			takeOver: Schema.optional(Schema.Boolean),
		}),
		response: looseStruct({ url: Schema.String }),
	}),
	hooksUpdate: route({
		method: 'POST',
		path: '/api/releases/update-references',
		auth: 'admin',
		idempotent: false,
		request: mutableStruct({ repositoryId: id, releaseEventId: text, preview: Schema.optional(Schema.Boolean) }),
		response: Schema.Unknown,
	}),
	releasesStartSet: route({
		method: 'POST',
		path: '/api/releases/start-set',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ preparationId: text, sourceSha: sha }),
		response: mutableArray(executionView),
	}),
	releasesPlanSet: route({
		method: 'POST',
		path: '/api/releases/plan-set',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ repositoryId: id, stream: text, plan: Schema.Unknown }),
		response: planReview,
	}),
	releasesPrepareSet: route({
		method: 'POST',
		path: '/api/releases/prepare-set',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({
			repositoryId: id,
			stream: text,
			plan: Schema.Unknown,
			sourceSha: sha,
			planId: Schema.String,
		}),
		response: executionView,
	}),
	releasesPlan: route({
		method: 'POST',
		path: '/api/releases/plan',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({
			repositoryId: id,
			stream: text,
			version: Schema.Unknown,
			packages: Schema.optional(mutableArray(text)),
		}),
		response: planReview,
	}),
	releasesPrepare: route({
		method: 'POST',
		path: '/api/releases/prepare',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({
			repositoryId: id,
			stream: text,
			version: Schema.Unknown,
			packages: Schema.optional(mutableArray(text)),
			sourceSha: sha,
			planId: Schema.String,
			versionPrMerge: Schema.optional(versionPrMerge),
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
		request: mutableStruct({ ...executionRef.fields, ...{ sourceSha: sha, force: Schema.optional(Schema.Boolean) } }),
		response: executionView,
	}),
	executionsRecover: route({
		method: 'POST',
		path: '/api/executions/recover',
		auth: 'admin',
		idempotent: false,
		request: mutableStruct({ ...executionRef.fields, ...{ action: Schema.Literals(['retry', 'reconcile']) } }),
		response: executionView,
	}),
	cliSessionsRevoke: route({
		method: 'POST',
		path: '/api/cli-sessions/revoke',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ id: text }),
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
		request: mutableStruct({ register: Schema.optional(Schema.Boolean), label: Schema.optional(Schema.String), proof }),
		response: securityChallenge,
	}),
	authenticatorsVerify: route({
		method: 'POST',
		path: '/api/authenticators/verify',
		auth: 'admin',
		idempotent: false,
		request: mutableStruct({ id: text, response: Schema.Unknown }),
		response: securityProof,
	}),
	authenticatorsRemove: route({
		method: 'POST',
		path: '/api/authenticators/remove',
		auth: 'elevated',
		idempotent: false,
		request: mutableStruct({ id: text, proof }),
		response: looseStruct({ removed: Schema.Boolean }),
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
		request: mutableStruct({ destination: destinationInput }),
		response: looseStruct({ id: Schema.String }),
	}),
	notificationsRemove: route({
		method: 'POST',
		path: '/api/notifications/remove',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({ id: text }),
		response: acknowledged,
	}),
	credentialsReplace: route({
		method: 'POST',
		path: '/api/credentials/replace',
		auth: 'elevated',
		idempotent: false,
		request: mutableStruct({
			alias: text,
			value: text,
			proof,
			expectedVersion: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isInt()))),
		}),
		response: looseStruct({ version: Schema.Finite }),
	}),
	credentialsReveal: route({
		method: 'POST',
		path: '/api/credentials/reveal',
		auth: 'elevated',
		idempotent: false,
		request: mutableStruct({ alias: text, proof }),
		response: looseStruct({ value: Schema.String, version: Schema.Finite }),
	}),
	credentialsSync: route({
		method: 'POST',
		path: '/api/credentials/sync',
		auth: 'elevated',
		idempotent: false,
		request: mutableStruct({ alias: text, proof }),
		response: mutableArray(looseStruct({ id: Schema.String, state: Schema.String })),
	}),
	credentialsGrant: route({
		method: 'POST',
		path: '/api/credentials/grant',
		auth: 'elevated',
		idempotent: false,
		request: mutableStruct({ selection: looseStruct({ repositoryId: id }), proof }),
		response: looseStruct({ granted: Schema.Boolean }),
	}),
	credentialsRevoke: route({
		method: 'POST',
		path: '/api/credentials/revoke',
		auth: 'elevated',
		idempotent: false,
		request: mutableStruct({ grantId: text, proof }),
		response: looseStruct({ revoked: Schema.Boolean }),
	}),
	changes: route({
		method: 'GET',
		path: '/api/v1/changes',
		auth: 'admin',
		idempotent: true,
		request: mutableStruct({
			since: numberFromInput.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
			repositoryId: Schema.optional(numberFromInput.pipe(Schema.decodeTo(id))),
		}),
		response: changesResponse,
	}),
	adminReindex: route({
		method: 'POST',
		path: '/api/v1/admin/reindex',
		auth: 'elevated',
		idempotent: true,
		request: mutableStruct({ repositoryId: Schema.optional(id), proof }),
		response: mutableStruct({ queued: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)) }),
	}),
	workflowToken: route({
		method: 'POST',
		path: '/api/workflow/token',
		auth: 'workflow-token',
		idempotent: false,
		request: mutableStruct({
			permissions: Schema.optional(Schema.Unknown),
			purpose: Schema.optional(Schema.String),
			identity: Schema.optional(Schema.Boolean),
			executionId: Schema.optional(Schema.String),
		}),
		response: looseStruct({
			token: Schema.String,
			bot: Schema.optional(looseStruct({ login: Schema.String, id: Schema.Finite, email: Schema.String })),
		}),
	}),
	workflowStart: route({
		method: 'POST',
		path: '/api/workflow/start',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({
			stream: Schema.String.check(Schema.isMinLength(1)),
			version: Schema.String.check(Schema.isMinLength(1)),
		}),
		response: executionView,
	}),
	workflowBegin: route({
		method: 'POST',
		path: '/api/workflow/begin',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({
			executionId: Schema.optional(Schema.String),
			stream: Schema.optional(Schema.String),
			operation: Schema.optional(Schema.String),
			version: Schema.optional(Schema.String),
		}),
		response: executionView,
	}),
	workflowPrepared: route({
		method: 'POST',
		path: '/api/workflow/prepared',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({ executionId: text, files: mutableArray(mutableStruct({ path: text, content: text })) }),
		response: Schema.Unknown,
	}),
	workflowReport: route({
		method: 'POST',
		path: '/api/workflow/report',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({
			executionId: text,
			publications: Schema.optional(mutableArray(Schema.Unknown)),
			artifacts: Schema.optional(mutableArray(Schema.Unknown)),
		}),
		response: executionView,
	}),
	workflowCredentials: route({
		method: 'POST',
		path: '/api/workflow/credentials',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({ executionId: text, aliases: mutableArray(text) }),
		response: mutableRecord(Schema.String, Schema.String),
	}),
	workflowRefsPlan: route({
		method: 'POST',
		path: '/api/workflow/refs-plan',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({ executionId: text }),
		response: Schema.Unknown,
	}),
	workflowRefsComplete: route({
		method: 'POST',
		path: '/api/workflow/refs-complete',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({ executionId: text }),
		response: Schema.Unknown,
	}),
	workflowRelease: route({
		method: 'POST',
		path: '/api/workflow/release',
		auth: 'workflow',
		idempotent: true,
		request: mutableStruct({ executionId: text }),
		response: Schema.Unknown,
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
export type AnyRoute = Route<Contract, Contract>;
export type RequestOf<R extends AnyRoute> = Decoded<R['request']>;
export type InputOf<R extends AnyRoute> = Encoded<R['request']>;
export type ResponseOf<R extends AnyRoute> = Decoded<R['response']>;
export type Known<T> = T extends readonly (infer U)[] ? Known<U>[]
	: T extends object ? { [P in keyof T as string extends P ? never : P]: Known<T[P]> }
	: T;
export type ResultOf<R extends AnyRoute> = Known<Encoded<R['response']>>;

export function isRouteId(key: string): key is RouteId {
	return Object.hasOwn(routes, key);
}
export const routeIds: readonly RouteId[] = Object.keys(routes).filter(isRouteId);
