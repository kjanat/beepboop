import type { JWTVerifyGetKey } from 'jose';
import { type WorkflowIdentity, workflowIdentity } from '@/automation/auth';
import type { Execution } from '@/automation/types';
import { record } from '@/model';
import { readBody } from '@/webhook';

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
	return run.title === `Release operation ${execution.id}` && run.path === `.github/workflows/${workflow.file}`;
}

export function tokenPermissions(raw: unknown): TokenPermissions {
	const entries = Object.entries(record(raw));
	if (!entries.length) throw new Error('Token permissions required');
	const permissions: TokenPermissions = {};
	for (const [name, level] of entries) {
		if (!issuable.has(name) || (level !== 'read' && level !== 'write')) {
			throw new Error('Invalid token permission');
		}
		permissions[name] = level;
	}
	return permissions;
}

export async function workflowToken(
	request: Request,
	audience: string,
	ownerId: number,
	issuer: TokenIssuer,
	log: TokenAudit,
	issuerKeys?: JWTVerifyGetKey,
): Promise<Response> {
	if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
	const identity = await workflowIdentity(request, audience, ownerId, issuerKeys);
	const body = record(JSON.parse(new TextDecoder().decode(await readBody(request))));
	if (identity.actorId !== ownerId) {
		if (body.purpose === 'publish-actions') throw new Error('Actions publication requires an owner-started run');
		if (!(await dispatchedByBeepboop(identity, body.executionId, issuer, log))) {
			throw new Error('Workflow run was not started by the owner or a Beepboop operation');
		}
	}
	let permissions: TokenPermissions;
	if (body.purpose === 'publish-actions') {
		if (
			identity.event !== 'workflow_dispatch' || identity.helperSha
			|| identity.workflowSha !== identity.sha
			|| identity.workflowRef !== `${identity.repository}/.github/workflows/publish-actions.yml@${identity.ref}`
		) {
			throw new Error('Actions publication requires its own manually dispatched workflow');
		}
		const requested = record(body.permissions);
		if (Object.keys(requested).length !== 2 || requested.contents !== 'write' || requested.workflows !== 'write') {
			throw new Error('Actions publication requires only contents:write and workflows:write');
		}
		const source = await issuer.defaultRevision(identity.repository, identity.repositoryId);
		if (source.ref !== identity.ref || source.sha !== identity.sha) {
			throw new Error('Actions publication requires the current default branch revision');
		}
		permissions = { contents: 'write', workflows: 'write' };
	} else {
		if (body.purpose !== undefined && body.purpose !== '') throw new Error('Unknown token purpose');
		permissions = tokenPermissions(body.permissions);
	}
	const bot = body.identity === true ? await issuer.botIdentity() : undefined;
	const token = await issuer.token(identity.repository, identity.repositoryId, permissions);
	const granted = Object.entries(permissions).map(([name, level]) => `${name}:${level}`).join(',');
	await log.audit(`run:${identity.runId}`, 'token.issued', `${identity.repository} ${granted}`);
	return Response.json({ token, ...(bot ? { bot } : {}) });
}
