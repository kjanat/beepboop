import { Effect, Option, Result } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { expectedRunTitle } from '@/automation/execution';
import type { Execution } from '@/automation/types';
import type { BotIdentity } from '@/github/app.ts';
import type { RevisionFiles } from '@/github/contents.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { forbidden, invalid } from '@/kernel/errors/domain-error.ts';
import { yaml } from '@/kernel/parse/yaml.ts';
import { array, record } from '@/kernel/schema/result.ts';

export type TokenPermissions = Record<string, 'read' | 'write'>;

const issuable = new Set(['contents', 'pull_requests', 'issues', 'checks', 'statuses', 'metadata']);

export interface TokenIssuer {
	readonly botIdentity: Effect.Effect<BotIdentity, DomainError>;
	defaultRevision(name: string, id: number): Effect.Effect<{ ref: string; sha: string }, DomainError>;
	revisionFiles(name: string, id: number, sha: string): Effect.Effect<RevisionFiles, DomainError>;
	mintToken(name: string, id: number, permissions: TokenPermissions): Effect.Effect<string, DomainError>;
	workflowRun(name: string, id: number, runId: number): Effect.Effect<{ title: string; path: string }, DomainError>;
}

const publishWorkflow = '.github/workflows/publish-actions.yml';

function objects(value: unknown): Record<string, unknown>[] {
	const items = Result.getOrElse(array(value), () => [value]);
	return items.flatMap(item => Result.match(record(item), { onFailure: () => [], onSuccess: found => [found] }));
}

function within(path: string, file: string): boolean {
	return path === '' || file === path || file.startsWith(`${path}/`);
}

function localUses(source: string): Option.Option<string[]> {
	const parsed = yaml(source);
	if (Result.isFailure(parsed)) return Option.none();
	const document = parsed.success;
	const holders = [
		...objects(Object.values(Result.getOrElse(record(document.jobs), () => ({})))),
		...objects(document.runs),
	];
	return Option.some(
		holders.flatMap(holder => [holder, ...objects(holder.steps)]).flatMap(entry => {
			const uses = entry.uses;
			return typeof uses === 'string' && /^[$.]\//.test(uses) ? [uses.slice(2).replace(/\/$/, '')] : [];
		}),
	);
}

const definitionPaths = Effect.fnUntraced(function*(
	files: RevisionFiles,
): Effect.fn.Return<Option.Option<ReadonlySet<string>>, DomainError> {
	const covered = new Set<string>();
	const pending = [publishWorkflow];
	for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
		if (covered.has(path)) continue;
		covered.add(path);
		if (![...files.entries.keys()].some(file => within(path, file))) return Option.none();
		const manifests = files.entries.has(path)
			? [path]
			: [`${path ? `${path}/` : ''}action.yml`, `${path ? `${path}/` : ''}action.yaml`].filter(manifest =>
				files.entries.has(manifest)
			);
		for (const manifest of manifests) {
			const source = yield* files.read(manifest);
			const uses = source === null ? Option.none<string[]>() : localUses(source);
			if (Option.isNone(uses)) return Option.none();
			pending.push(...uses.value);
		}
	}
	return Option.some(covered);
});

function definition(files: RevisionFiles, paths: ReadonlySet<string>): string {
	const inside = (file: string) => [...paths].some(path => within(path, file));
	return JSON.stringify([...files.entries].filter(([file]) => inside(file)).sort(([a], [b]) => a.localeCompare(b)));
}

const sameDefinition = Effect.fnUntraced(function*(
	identity: RunIdentity,
	head: string,
	issuer: TokenIssuer,
): Effect.fn.Return<boolean, DomainError> {
	const current = yield* issuer.revisionFiles(identity.repository, identity.repositoryId, head);
	const run = yield* issuer.revisionFiles(identity.repository, identity.repositoryId, identity.sha);
	const paths = yield* definitionPaths(current);
	return Option.isSome(paths) && definition(current, paths.value) === definition(run, paths.value);
});

export interface TokenAudit {
	audit(actor: string, action: string, target: string): Effect.Effect<void, DomainError>;
	execution(id: string): Effect.Effect<Execution | undefined, DomainError>;
}

const dispatchedStates: Execution['state'][] = ['dispatching', 'running', 'uncertain'];

function dispatchedByBeepboop(
	identity: RunIdentity,
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
	identity: RunIdentity,
	body: TokenRequest,
	ownerId: number,
	issuer: TokenIssuer,
	log: TokenAudit,
): Effect.Effect<{ token: string; bot?: BotIdentity }, DomainError> {
	return Effect.gen(function*() {
		if (identity.actorId !== ownerId && body.purpose !== 'publish-actions') {
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
			if (
				identity.actorId !== ownerId
				&& (identity.event !== 'push' || identity.actorId !== (yield* issuer.botIdentity).id)
			) {
				return yield* forbidden('Actions publication requires the owner or a Beepboop push');
			}
			const requested = yield* Effect.fromResult(record(body.permissions));
			if (Object.keys(requested).length !== 2 || requested.contents !== 'write' || requested.workflows !== 'write') {
				return yield* forbidden('Actions publication requires only contents:write and workflows:write');
			}
			const source = yield* issuer.defaultRevision(identity.repository, identity.repositoryId);
			if (
				source.ref !== identity.ref
				|| (source.sha !== identity.sha && !(yield* sameDefinition(identity, source.sha, issuer)))
			) {
				return yield* forbidden('Actions publication requires the workflow of the current default branch revision');
			}
			permissions = { contents: 'write', workflows: 'write' };
		} else {
			if (body.purpose !== undefined && body.purpose !== '') {
				return yield* invalid('Unknown token purpose', ['purpose']);
			}
			permissions = yield* tokenPermissions(body.permissions);
		}
		const bot = body.identity === true ? yield* issuer.botIdentity : undefined;
		const token = yield* issuer.mintToken(identity.repository, identity.repositoryId, permissions);
		const granted = Object.entries(permissions).map(([name, level]) => `${name}:${level}`).join(',');
		yield* log.audit(`run:${identity.runId}`, 'token.issued', `${identity.repository} ${granted}`);
		return { token, ...(bot ? { bot } : {}) };
	});
}
