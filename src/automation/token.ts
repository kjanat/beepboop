import { Effect } from 'effect';
import type { WorkflowIdentity } from '@/automation/auth';
import { expectedRunTitle } from '@/automation/execution';
import type { Execution } from '@/automation/types';
import { type DomainError, forbidden, invalid } from '@/contract/errors';
import { record } from '@/model';

export type TokenPermissions = Record<string, 'read' | 'write'>;

const issuable = new Set(['contents', 'pull_requests', 'issues', 'checks', 'statuses', 'metadata']);

export interface BotIdentity {
	login: string;
	id: number;
	email: string;
}

export interface TokenIssuer {
	readonly botIdentity: Effect.Effect<BotIdentity, DomainError>;
	defaultRevision(name: string, id: number): Effect.Effect<{ ref: string; sha: string }, DomainError>;
	token(name: string, id: number, permissions: TokenPermissions): Effect.Effect<string, DomainError>;
	workflowRun(name: string, id: number, runId: number): Effect.Effect<{ title: string; path: string }, DomainError>;
}

export interface TokenAudit {
	audit(actor: string, action: string, target: string): Effect.Effect<void, DomainError>;
	execution(id: string): Effect.Effect<Execution | undefined, DomainError>;
}

const dispatchedStates: Execution['state'][] = ['dispatching', 'running', 'uncertain'];

function dispatchedByBeepboop(
	identity: WorkflowIdentity,
	executionId: unknown,
	issuer: TokenIssuer,
	log: TokenAudit,
): Effect.Effect<boolean, DomainError> {
	return Effect.gen(function*() {
		if (typeof executionId !== 'string' || !executionId || identity.event !== 'workflow_dispatch') return false;
		if (identity.actorId !== (yield* issuer.botIdentity).id) return false;
		const execution = yield* log.execution(executionId);
		const workflow = execution?.workflow;
		if (
			!execution || !workflow || execution.repositoryId !== identity.repositoryId
			|| !dispatchedStates.includes(execution.state)
			|| (execution.runId !== undefined && execution.runId !== identity.runId)
			|| identity.workflowRef !== `${identity.repository}/.github/workflows/${workflow.file}@${identity.ref}`
			|| identity.ref.replace(/^refs\/(?:heads|tags)\//, '') !== workflow.ref.replace(/^refs\/(?:heads|tags)\//, '')
		) {
			return false;
		}
		const run = yield* issuer.workflowRun(identity.repository, identity.repositoryId, identity.runId);
		return (execution.runId === identity.runId || run.title === expectedRunTitle(execution))
			&& run.path === `.github/workflows/${workflow.file}`;
	});
}

export function tokenPermissions(raw: unknown): Effect.Effect<TokenPermissions, DomainError> {
	return Effect.gen(function*() {
		const entries = Object.entries(yield* Effect.fromResult(record(raw)));
		if (!entries.length) return yield* invalid('Token permissions required', ['permissions']);
		const permissions: TokenPermissions = {};
		for (const [name, level] of entries) {
			if (!issuable.has(name) || (level !== 'read' && level !== 'write')) {
				return yield* invalid('Invalid token permission', ['permissions', name]);
			}
			permissions[name] = level;
		}
		return permissions;
	});
}

export interface TokenRequest {
	permissions?: unknown;
	purpose?: string;
	identity?: boolean;
	executionId?: string;
}

export function issueWorkflowToken(
	identity: WorkflowIdentity,
	body: TokenRequest,
	ownerId: number,
	issuer: TokenIssuer,
	log: TokenAudit,
): Effect.Effect<{ token: string; bot?: BotIdentity }, DomainError> {
	return Effect.gen(function*() {
		if (identity.actorId !== ownerId) {
			if (body.purpose === 'publish-actions') {
				return yield* forbidden('Actions publication requires an owner-started run');
			}
			if (!(yield* dispatchedByBeepboop(identity, body.executionId, issuer, log))) {
				return yield* forbidden('Workflow run was not started by the owner or a Beepboop operation');
			}
		}
		let permissions: TokenPermissions;
		if (body.purpose === 'publish-actions') {
			if (
				!['workflow_dispatch', 'push'].includes(identity.event) || identity.helperSha
				|| identity.workflowSha !== identity.sha
				|| identity.workflowRef !== `${identity.repository}/.github/workflows/publish-actions.yml@${identity.ref}`
			) {
				return yield* forbidden('Actions publication requires its own workflow on the default branch');
			}
			const requested = yield* Effect.fromResult(record(body.permissions));
			if (Object.keys(requested).length !== 2 || requested.contents !== 'write' || requested.workflows !== 'write') {
				return yield* forbidden('Actions publication requires only contents:write and workflows:write');
			}
			const source = yield* issuer.defaultRevision(identity.repository, identity.repositoryId);
			if (source.ref !== identity.ref || source.sha !== identity.sha) {
				return yield* forbidden('Actions publication requires the current default branch revision');
			}
			permissions = { contents: 'write', workflows: 'write' };
		} else {
			if (body.purpose !== undefined && body.purpose !== '') {
				return yield* invalid('Unknown token purpose', ['purpose']);
			}
			permissions = yield* tokenPermissions(body.permissions);
		}
		const bot = body.identity === true ? yield* issuer.botIdentity : undefined;
		const token = yield* issuer.token(identity.repository, identity.repositoryId, permissions);
		const granted = Object.entries(permissions).map(([name, level]) => `${name}:${level}`).join(',');
		yield* log.audit(`run:${identity.runId}`, 'token.issued', `${identity.repository} ${granted}`);
		return { token, ...(bot ? { bot } : {}) };
	});
}
