import type { JWTVerifyGetKey } from 'jose';
import { workflowIdentity } from '@/automation/auth';
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
}

export interface TokenAudit {
	audit(actor: string, action: string, target: string): Promise<void>;
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
	if (identity.actorId !== ownerId) throw new Error('Workflow run was not started by the owner');
	const body = record(JSON.parse(new TextDecoder().decode(await readBody(request))));
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
