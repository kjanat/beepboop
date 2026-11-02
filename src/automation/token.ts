import type { JWTVerifyGetKey } from 'jose';
import { record } from '@/model';
import { readBody } from '@/webhook';
import { workflowIdentity } from './auth.ts';

export type TokenPermissions = Record<string, 'read' | 'write'>;

const issuable = new Set(['contents', 'pull_requests', 'issues', 'checks', 'statuses', 'metadata']);

export interface TokenIssuer {
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
	const permissions = tokenPermissions(body.permissions);
	const token = await issuer.token(identity.repository, identity.repositoryId, permissions);
	const granted = Object.entries(permissions).map(([name, level]) => `${name}:${level}`).join(',');
	await log.audit(`run:${identity.runId}`, 'token.issued', `${identity.repository} ${granted}`);
	return Response.json({ token });
}
