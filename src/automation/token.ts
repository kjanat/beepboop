import type { WorkflowIdentity } from '@/automation/auth';
import { expectedRunTitle } from '@/automation/execution';
import type { Execution } from '@/automation/types';
import { forbidden, invalid } from '@/contract/errors';
import { record } from '@/model';

export type TokenPermissions = Record<string, 'read' | 'write'>;

const issuable = new Set(['contents', 'pull_requests', 'issues', 'checks', 'statuses', 'metadata']);

export interface BotIdentity {
	login: string;
	id: number;
	email: string;
}

export interface TokenIssuer {
	botIdentity(): Promise<BotIdentity>;
	defaultRevision(name: string, id: number): Promise<{ ref: string; sha: string }>;
	token(name: string, id: number, permissions: TokenPermissions): Promise<string>;
	workflowRun(name: string, id: number, runId: number): Promise<{ title: string; path: string }>;
}

export interface TokenAudit {
	audit(actor: string, action: string, target: string): Promise<void>;
	execution(id: string): Promise<Execution | undefined>;
}

const dispatchedStates: Execution['state'][] = ['dispatching', 'running', 'uncertain'];

async function dispatchedByBeepboop(
	identity: WorkflowIdentity,
	executionId: unknown,
	issuer: TokenIssuer,
	log: TokenAudit,
): Promise<boolean> {
	if (typeof executionId !== 'string' || !executionId || identity.event !== 'workflow_dispatch') return false;
	if (identity.actorId !== (await issuer.botIdentity()).id) return false;
	const execution = await log.execution(executionId);
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
	const run = await issuer.workflowRun(identity.repository, identity.repositoryId, identity.runId);
	return (execution.runId === identity.runId || run.title === expectedRunTitle(execution))
		&& run.path === `.github/workflows/${workflow.file}`;
}

export function tokenPermissions(raw: unknown): TokenPermissions {
	const entries = Object.entries(record(raw));
	if (!entries.length) throw invalid('Token permissions required', ['permissions']);
	const permissions: TokenPermissions = {};
	for (const [name, level] of entries) {
		if (!issuable.has(name) || (level !== 'read' && level !== 'write')) {
			throw invalid('Invalid token permission', ['permissions', name]);
		}
		permissions[name] = level;
	}
	return permissions;
}

export interface TokenRequest {
	permissions?: unknown;
	purpose?: string;
	identity?: boolean;
	executionId?: string;
}

export async function issueWorkflowToken(
	identity: WorkflowIdentity,
	body: TokenRequest,
	ownerId: number,
	issuer: TokenIssuer,
	log: TokenAudit,
): Promise<{ token: string; bot?: BotIdentity }> {
	if (identity.actorId !== ownerId) {
		if (body.purpose === 'publish-actions') throw forbidden('Actions publication requires an owner-started run');
		if (!(await dispatchedByBeepboop(identity, body.executionId, issuer, log))) {
			throw forbidden('Workflow run was not started by the owner or a Beepboop operation');
		}
	}
	let permissions: TokenPermissions;
	if (body.purpose === 'publish-actions') {
		if (
			!['workflow_dispatch', 'push'].includes(identity.event) || identity.helperSha
			|| identity.workflowSha !== identity.sha
			|| identity.workflowRef !== `${identity.repository}/.github/workflows/publish-actions.yml@${identity.ref}`
		) {
			throw forbidden('Actions publication requires its own workflow on the default branch');
		}
		const requested = record(body.permissions);
		if (Object.keys(requested).length !== 2 || requested.contents !== 'write' || requested.workflows !== 'write') {
			throw forbidden('Actions publication requires only contents:write and workflows:write');
		}
		const source = await issuer.defaultRevision(identity.repository, identity.repositoryId);
		if (source.ref !== identity.ref || source.sha !== identity.sha) {
			throw forbidden('Actions publication requires the current default branch revision');
		}
		permissions = { contents: 'write', workflows: 'write' };
	} else {
		if (body.purpose !== undefined && body.purpose !== '') throw invalid('Unknown token purpose', ['purpose']);
		permissions = tokenPermissions(body.permissions);
	}
	const bot = body.identity === true ? await issuer.botIdentity() : undefined;
	const token = await issuer.token(identity.repository, identity.repositoryId, permissions);
	const granted = Object.entries(permissions).map(([name, level]) => `${name}:${level}`).join(',');
	await log.audit(`run:${identity.runId}`, 'token.issued', `${identity.repository} ${granted}`);
	return { token, ...(bot ? { bot } : {}) };
}
