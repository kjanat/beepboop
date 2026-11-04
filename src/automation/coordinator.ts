import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import type { WorkflowIdentity } from '@/automation/auth';
import {
	completion,
	createExecution,
	dependenciesReady,
	expectedRunTitle,
	mergePublications,
	runTitle,
	validatePublicationIdentity,
} from '@/automation/execution';
import { type Credentials, RepositoryGateway } from '@/automation/github';
import { canVerifyPublication, discover, observedVersion, verifyPublication } from '@/automation/managers';
import { verifyManifest } from '@/automation/manifest';
import { mergeArtifacts, resolveInputs } from '@/automation/outputs';
import {
	identifyExecution,
	identityOf,
	matchesPackage,
	matchesPublication,
	packageId,
	publicationIdentity,
	selectorKey,
} from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import { matchesRef } from '@/automation/policy';
import type { PublishBudget } from '@/automation/publish-budget';
import { planRefs, type RefPlan } from '@/automation/refs';
import { compileReleaseSet } from '@/automation/release-set';
import type { ReleaseWorkflowParams } from '@/automation/release-workflow';
import { automationEventSchema, executionSchema, setupEditSchema } from '@/automation/schemas';
import { maintainSetup } from '@/automation/setup-maintenance';
import type { SetupEdit } from '@/automation/setup-types';
import { Store } from '@/automation/store';
import type { Artifact, AutomationEvent, Edit, Execution, Publication, ReleaseReference } from '@/automation/types';
import { array, integer, record, semver, sha, text } from '@/model';

export interface CoordinatorBindings extends Credentials {
	DB: D1Database;
	OWNER_ID: string;
	RELEASE_WORKFLOW: Workflow<ReleaseWorkflowParams>;
	PUBLISH_BUDGET: DurableObjectNamespace<PublishBudget>;
}
interface ReleaseSetRecord {
	target: string;
	ids: string[];
	workflowId?: string;
	started?: boolean;
	completed?: boolean;
}
const releaseSetRecord: z.ZodType<ReleaseSetRecord> = z.object({
	target: z.string(),
	ids: z.array(z.string()),
	workflowId: z.string().optional(),
	started: z.boolean().optional(),
	completed: z.boolean().optional(),
});
const observation = z.object({ repositoryId: z.number(), runId: z.number() });
function githubRelease(execution: Execution): { tag: string; prerelease: boolean } | undefined {
	if (!execution.version) return undefined;
	const version = semver(execution.version).replace(/^v/, '');
	return {
		tag: `${execution.workflow?.refs?.prefix ?? 'v'}${version}`,
		prerelease: version.split('+')[0]?.includes('-') ?? false,
	};
}
function publishesGithubRelease(execution: Execution): boolean {
	const key = selectorKey(`github-release:${execution.repository}`);
	return execution.workflow?.publications?.some(id => selectorKey(id) === key) ?? false;
}
export class AutomationCoordinator extends DurableObject<CoordinatorBindings> {
	private pending: Promise<unknown> = Promise.resolve();
	private serial<T>(work: () => Promise<T>): Promise<T> {
		const result = this.pending.then(work);
		this.pending = result.catch(() => {});
		return result;
	}
	private store(): Store {
		return new Store(this.env.DB);
	}
	protected gateway(): RepositoryGateway {
		return new RepositoryGateway(this.env, Number(this.env.OWNER_ID));
	}
	private async journal(): Promise<Execution[]> {
		return [...(await this.ctx.storage.list({ prefix: 'execution:' })).values()].map(value =>
			executionSchema.parse(value)
		);
	}
	private async releaseSet(key: string): Promise<ReleaseSetRecord | undefined> {
		return releaseSetRecord.optional().parse(await this.ctx.storage.get(key));
	}
	private async put(execution: Execution): Promise<void> {
		Object.assign(execution, identifyExecution(execution));
		const previous = executionSchema.optional().parse(await this.ctx.storage.get(`execution:${execution.id}`));
		if (
			previous && previous.state !== execution.state && ['running', 'succeeded'].includes(execution.state)
			&& execution.reason === previous.reason
		) {
			delete execution.reason;
		}
		execution.updatedAt = Date.now();
		// The journal is authoritative. D1 is an asynchronously repairable dashboard index.
		await this.ctx.storage.put(`execution:${execution.id}`, execution);
		if (!execution.releaseSet?.workflowId) await this.ctx.storage.setAlarm(Date.now() + 15000);
		if (JSON.stringify({ ...previous, updatedAt: 0 }) !== JSON.stringify({ ...execution, updatedAt: 0 })) {
			await this.wakeReleaseWorkflows();
		}
		await this.store().putExecution(execution);
		if (execution.state === 'succeeded') await this.captureReleaseEvent(execution);
	}
	private async captureReleaseEvent(execution: Execution): Promise<void> {
		if (!execution.version) return;
		const required = execution.releaseSet?.required ?? execution.configuration.streams[execution.stream]?.required
			?? [];
		if (!required.length) return;
		const id =
			`release:${execution.repositoryId}:${execution.stream}:${execution.configurationSha}:${execution.sourceSha}:${execution.version}${
				execution.releaseSet ? `:${execution.releaseSet.preparationId}:${execution.releaseSet.group}` : ''
			}`;
		if (await this.ctx.storage.get(`release-emitted:${id}`)) return;
		const group = (await this.journal())
			.filter(e =>
				e.state === 'succeeded' && e.stream === execution.stream && e.version === execution.version
				&& e.sourceSha === execution.sourceSha && e.configurationSha === execution.configurationSha
				&& e.releaseSet?.preparationId === execution.releaseSet?.preparationId
				&& e.releaseSet?.group === execution.releaseSet?.group
			);
		if (
			!required.every(key =>
				group.some(e => e.publications.some(p => matchesPublication(key, p) && p.outcome === 'succeeded'))
			)
		) {
			return;
		}
		const references = group.flatMap(e => e.release ? [e.release] : []);
		if (references.some(r => r.tag !== references[0]?.tag || r.releaseId !== references[0]?.releaseId)) {
			throw new Error('Conflicting release identities');
		}
		const release: ReleaseReference = {
			id,
			...(execution.releaseSet ? { group: execution.releaseSet.group } : {}),
			repository: { id: execution.repositoryId, name: execution.repository },
			stream: execution.stream,
			commit: execution.sourceSha,
			version: execution.version,
			...(references[0]?.tag ? { tag: references[0].tag, releaseId: references[0].releaseId } : {}),
			publications: mergePublications([], group.flatMap(e => e.publications)),
			artifacts: [...new Map(group.flatMap(e => e.artifacts).map(a => [a.id, a])).values()],
		};
		const event: AutomationEvent = {
			id,
			source: execution.repository,
			event: 'release',
			version: execution.version,
			release,
		};
		await this.ctx.storage.put({ [`release-event:${id}`]: event, [`release-emitted:${id}`]: true });
	}
	async releaseEvents(): Promise<AutomationEvent[]> {
		return [...(await this.ctx.storage.list({ prefix: 'release-event:', limit: 100 })).values()].map(value =>
			automationEventSchema.parse(value)
		);
	}
	async acknowledgeReleaseEvent(id: string): Promise<void> {
		await this.ctx.storage.delete(`release-event:${id}`);
	}
	/** Persist wake-ups separately so failed delivery survives Worker restarts. */
	private async wakeReleaseWorkflows(): Promise<void> {
		for (const [key, value] of await this.ctx.storage.list({ prefix: 'release-set:' })) {
			const release = releaseSetRecord.parse(value);
			if (!release.workflowId || release.completed) continue;
			await this.ctx.storage.put(`release-wake:${key.slice('release-set:'.length)}`, true);
			await this.ctx.storage.setAlarm(Date.now() + 1000);
		}
	}
	private async deliverReleaseEvents(): Promise<void> {
		for (const key of (await this.ctx.storage.list({ prefix: 'release-wake:' })).keys()) {
			const preparationId = key.slice('release-wake:'.length);
			const release = await this.releaseSet(`release-set:${preparationId}`);
			if (!release?.workflowId || release.completed) {
				await this.ctx.storage.delete(key);
				continue;
			}
			try {
				const binding = this.env.RELEASE_WORKFLOW;
				if (!release.started) {
					const preparation = await this.get(preparationId);
					try {
						await binding.create({
							id: release.workflowId,
							params: { repositoryId: preparation.repositoryId, preparationId },
						});
					} catch (error) {
						// A create response can be lost after Cloudflare accepts the instance.
						try {
							await (await binding.get(release.workflowId)).status();
						} catch {
							throw error;
						}
					}
					release.started = true;
					await this.ctx.storage.put(`release-set:${preparationId}`, release);
				}
				const instance = await binding.get(release.workflowId);
				const status = await instance.status();
				if (['errored', 'terminated'].includes(status.status)) {
					await this.recordReleaseWorkflowInterruption(preparationId, release.workflowId);
				}
				if (!['complete', 'errored', 'terminated'].includes(status.status)) {
					for (const id of release.ids) await instance.sendEvent({ type: id, payload: {} });
				}
				await this.ctx.storage.delete(key);
			} catch {
				await this.ctx.storage.setAlarm(Date.now() + 60000);
			}
		}
	}
	async releaseOperations(preparationId: string, workflowId: string) {
		const release = await this.releaseSet(`release-set:${preparationId}`);
		if (!release || release.workflowId !== workflowId) throw new Error('Release Workflow identity mismatch');
		return Promise.all(release.ids.map(async id => {
			const execution = await this.get(id);
			return {
				id,
				operation: execution.package ? `${execution.operation} ${execution.package.id}` : execution.operation,
				paced: execution.package?.manager === 'cargo',
				dependencies: execution.dependencies,
			};
		}));
	}
	async reservePublication(preparationId: string, workflowId: string, id: string): Promise<number> {
		return this.serial(async () => {
			const operations = await this.releaseOperations(preparationId, workflowId);
			if (!operations.some(operation => operation.id === id && operation.paced)) {
				throw new Error('Operation is not a paced publication in this release');
			}
			const execution = await this.get(id);
			const target = execution.package;
			if (!target) throw new Error('Paced operation has no package');
			if (!execution.reservation) {
				const repository = await this.store().repository(execution.repositoryId);
				const status = repository?.inventory.packages.find(pkg => matchesPackage(target.id, pkg))?.publicationStatus;
				const reservation = status === 'missing' ? 'new' : 'update';
				const allowedAt = await this.env.PUBLISH_BUDGET.getByName('crates-io').reserve(reservation);
				await this.put({ ...execution, reservation, notBefore: Math.max(execution.notBefore ?? 0, allowedAt) });
			}
			return Math.max(0, ((await this.get(id)).notBefore ?? 0) - Date.now());
		});
	}
	async operationDelay(preparationId: string, workflowId: string, id: string): Promise<number> {
		const operations = await this.releaseOperations(preparationId, workflowId);
		if (!operations.some(operation => operation.id === id)) throw new Error('Operation is not in this release');
		return Math.max(0, ((await this.get(id)).notBefore ?? 0) - Date.now());
	}
	async advanceReleaseOperation(preparationId: string, workflowId: string, id: string) {
		return this.serial(async () => {
			const operations = await this.releaseOperations(preparationId, workflowId);
			if (!operations.some(operation => operation.id === id)) throw new Error('Operation is not in this release');
			await this.reconcile(id);
			return (await this.get(id)).state;
		});
	}
	async releaseWorkflowInterrupted(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(() => this.recordReleaseWorkflowInterruption(preparationId, workflowId));
	}
	private async recordReleaseWorkflowInterruption(
		preparationId: string,
		workflowId: string,
		interrupted = true,
	): Promise<void> {
		for (const operation of await this.releaseOperations(preparationId, workflowId)) {
			const execution = await this.get(operation.id);
			if (!execution.releaseSet) continue;
			execution.releaseSet.workflowError = interrupted
				? 'Release coordination interrupted. Check coordination to resume.'
				: undefined;
			await this.ctx.storage.put(`execution:${execution.id}`, execution);
			await this.store().putExecution(execution);
		}
	}
	async completeReleaseWorkflow(preparationId: string, workflowId: string): Promise<void> {
		return this.serial(async () => {
			const operations = await this.releaseOperations(preparationId, workflowId);
			for (const operation of operations) {
				if ((await this.get(operation.id)).state !== 'succeeded') throw new Error('Release is incomplete');
			}
			const key = `release-set:${preparationId}`;
			const release = await this.releaseSet(key);
			await this.ctx.storage.put(key, { ...release, completed: true });
		});
	}
	async startReleaseSet(preparationId: string, target: string): Promise<Execution[]> {
		return this.serial(async () => {
			const preparation = await this.get(preparationId);
			if ((await this.store().repository(preparation.repositoryId))?.suspended) {
				throw new Error('Repository is suspended');
			}
			const key = `release-set:${preparationId}`;
			const prior = await this.releaseSet(key);
			if (prior) {
				if (prior.target !== target) throw new Error('Release set already targets another revision');
				return Promise.all(prior.ids.map(id => this.get(id)));
			}
			const result = preparation.managed?.result ?? preparation.prepared?.result;
			const plan = preparation.managed?.plan ?? preparation.plan;
			if (!result || !plan) throw new Error('Preparation result unavailable');
			const snapshot = await this.gateway().preparedSnapshot(
				preparation.repository,
				preparation.repositoryId,
				result,
				sha(target),
				(preparation.prepared?.edits ?? plan.edits).map(edit => edit.path),
			);
			for (const edit of preparation.prepared?.edits ?? []) {
				if (snapshot.files[edit.path] !== edit.after) {
					throw new Error(`Generated preparation file changed: ${edit.path}`);
				}
			}
			const executions = await compileReleaseSet(preparation, snapshot);
			const workflowId = `release-${preparationId}`;
			for (const execution of executions) {
				if (execution.releaseSet) {
					execution.releaseSet.workflowId = workflowId;
					execution.releaseSet.operationCount = executions.length;
				}
			}
			await this.ctx.storage.transaction(async storage => {
				await storage.put({
					[key]: { target, ids: executions.map(execution => execution.id), workflowId },
					[`release-wake:${preparationId}`]: true,
					...Object.fromEntries(executions.map(execution => [`execution:${execution.id}`, execution])),
				});
				await storage.setAlarm(Date.now() + 1000);
			});
			for (const execution of executions) await this.store().putExecution(execution);
			return executions;
		});
	}
	async enqueue(execution: Execution): Promise<Execution> {
		return this.serial(async () => {
			if (Boolean(execution.workflow) === Boolean(execution.managed)) {
				throw new Error('Execution needs exactly one runner');
			}
			const prior = executionSchema.optional().parse(await this.ctx.storage.get(`execution:${execution.id}`));
			if (prior) return identifyExecution(prior);
			if (execution.configuration.streams[execution.stream]?.concurrency === 'supersede-pending') {
				for (const old of await this.journal()) {
					if (
						old.stream === execution.stream
						&& old.operation === execution.operation
						&& ['pending', 'ready'].includes(old.state)
					) {
						await this.put({ ...old, state: 'cancelled', reason: 'Superseded before dispatch' });
					}
				}
			}
			await this.put(execution);
			return execution;
		});
	}
	private async get(id: string): Promise<Execution> {
		const execution = executionSchema.optional().parse(await this.ctx.storage.get(`execution:${id}`));
		if (!execution) throw new Error('Unknown execution');
		return identifyExecution(execution);
	}
	async prepared(id: string, identity: WorkflowIdentity, edits: Edit[]): Promise<{ url: string; head: string }> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (
				!execution.workflow || execution.managed || execution.operation !== 'prepare' || !execution.plan
				|| execution.state !== 'running' || execution.repositoryId !== identity.repositoryId
				|| execution.runId !== identity.runId || execution.runAttempt !== identity.attempt
				|| execution.workflowSha !== identity.workflowSha
			) throw new Error('Preparation run identity mismatch');
			const ordered = [...edits].sort((a, b) => a.path.localeCompare(b.path));
			if (execution.prepared && JSON.stringify(execution.prepared.edits) !== JSON.stringify(ordered)) {
				throw new Error('Submitted preparation changed; create a new preparation');
			}
			if (execution.prepared?.result) return execution.prepared.result;
			execution.prepared ??= { edits: ordered };
			await this.put(execution);
			const gateway = this.gateway();
			const source = await gateway.snapshot(
				execution.repository,
				execution.repositoryId,
				execution.sourceSha,
				ordered.map(edit => edit.path),
			);
			const branch = `release/${execution.stream}/${execution.id}`;
			const title = `chore(release): prepare ${execution.version ?? 'release set'}`;
			const body =
				`Source: ${execution.sourceSha}\nPreparation execution: ${execution.id}\n\nPromotion requires approval.`;
			const result = execution.prepared.head
				? await gateway.resumePreparation(source, branch, title, body, execution.prepared.head)
				: await gateway.pullRequest(source, branch, title, body, ordered, undefined, async head => {
					if (!execution.prepared) throw new Error('Missing preparation checkpoint');
					execution.prepared.head = head;
					await this.put(execution);
				});
			execution.prepared.result = result;
			await this.put(execution);
			return result;
		});
	}
	async register(id: string, identity: WorkflowIdentity): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (!execution.workflow || execution.managed) throw new Error('Operation is not a workflow');
			const dependencies = await Promise.all(execution.dependencies.map(id => this.get(id)));
			if (!dependenciesReady(execution, dependencies)) throw new Error('Execution dependencies have not succeeded');
			if (execution.attempts === 0 && execution.eventId !== `observed:${identity.runId}`) {
				throw new Error('Execution has not been dispatched');
			}
			if (
				execution.repositoryId !== identity.repositoryId
				|| execution.repository !== identity.repository
				|| !['pending', 'ready', 'dispatching', 'uncertain', 'running'].includes(execution.state)
			) {
				throw new Error('Execution cannot register this run');
			}
			const expected = `${identity.repository}/.github/workflows/${execution.workflow.file}@`;
			if (!identity.workflowRef.startsWith(expected)) throw new Error('Workflow binding mismatch');
			if (execution.runId && execution.runId !== identity.runId) {
				throw new Error('Execution is already bound to a run');
			}
			if (execution.runAttempt && identity.attempt < execution.runAttempt) {
				throw new Error('Stale run attempt');
			}
			const gateway = this.gateway(),
				token = await gateway.token(execution.repository, execution.repositoryId);
			const run = record(
				await gateway.call(`/repos/${execution.repository}/actions/runs/${identity.runId}`, token),
			);
			if (
				record(run.repository).id !== execution.repositoryId
				|| run.head_sha !== identity.sha
				|| run.path !== `.github/workflows/${execution.workflow.file}`
				|| run.run_attempt !== identity.attempt
			) {
				throw new Error('Run identity mismatch');
			}
			if (!matchesRef(execution.workflow.ref, identity.ref)) throw new Error('Workflow ref mismatch');
			if (execution.attempts > 0 && !execution.runId && run.display_title !== expectedRunTitle(execution)) {
				throw new Error('Dispatch correlation mismatch');
			}
			const next: Execution = {
				...execution,
				resolvedInputs: resolveInputs(execution, dependencies),
				state: 'running',
				runId: identity.runId,
				runAttempt: identity.attempt,
				workflowSha: identity.workflowSha,
				helperShas: [
					...new Set([...(execution.helperShas ?? []), identity.helperSha ?? identity.workflowSha]),
				],
			};
			await this.put(next);
			return next;
		});
	}
	async refs(id: string, identity: WorkflowIdentity, complete = false): Promise<RefPlan> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (!execution.workflow || execution.managed) throw new Error('Operation is not a workflow');
			if (
				execution.state !== 'running' || execution.repositoryId !== identity.repositoryId
				|| execution.repository !== identity.repository || execution.runId !== identity.runId
				|| execution.runAttempt !== identity.attempt || execution.workflowSha !== identity.workflowSha
			) throw new Error('Ref operation identity mismatch');
			if (!execution.workflow.refs || !execution.version) throw new Error('No configured ref operation');
			if (execution.operation !== 'promote') {
				const visited = new Set<string>();
				const approved = async (current: Execution): Promise<boolean> => {
					if (visited.has(current.id)) return false;
					visited.add(current.id);
					if (current.state !== 'succeeded' || current.sourceSha !== execution.sourceSha) return false;
					if (current.operation === 'promote') return true;
					for (const dependency of current.dependencies) if (await approved(await this.get(dependency))) return true;
					return false;
				};
				let found = false;
				for (const dependency of execution.dependencies) if (await approved(await this.get(dependency))) found = true;
				if (!found) throw new Error('Ref operation requires completed promotion');
			}
			const gateway = this.gateway();
			const refs = await gateway.tagRefs(execution.repository, execution.repositoryId);
			if (!execution.refPlan) {
				if (complete) throw new Error('Ref plan has not been authorized');
				execution.refPlan = {
					repository: execution.repository,
					executionId: id,
					version: execution.version,
					changes: planRefs(execution.workflow.refs, execution.version, execution.sourceSha, refs),
				};
				await this.put(execution);
			}
			if (complete) {
				for (const change of execution.refPlan.changes) {
					const actual = refs.find(ref => ref.name === change.name);
					if (actual?.commit !== change.commit) throw new Error('Published ref does not match the plan');
					if (change.annotated) {
						const token = await gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
						const tag = record(await gateway.call(`/repos/${execution.repository}/git/tags/${actual.oid}`, token));
						if (
							record(tag.object).sha !== change.commit || tag.tag !== change.name
							|| (change.signed && record(tag.verification).verified !== true)
						) throw new Error('Version tag verification failed');
					}
				}
				execution.publications = mergePublications(execution.publications, [{
					id: `refs:${execution.operation}`,
					manager: 'workflow',
					name: execution.repository,
					version: execution.version,
					outcome: 'succeeded',
					required: true,
				}]);
				await this.put(execution);
			}
			return execution.refPlan;
		});
	}
	async publishRelease(id: string, identity: WorkflowIdentity): Promise<Execution> {
		const publication = await this.serial(async (): Promise<Publication> => {
			const execution = await this.get(id);
			if (!execution.workflow || execution.managed) throw new Error('Operation is not a workflow');
			if (
				execution.state !== 'running' || execution.repositoryId !== identity.repositoryId
				|| execution.repository !== identity.repository || execution.runId !== identity.runId
				|| execution.runAttempt !== identity.attempt || execution.workflowSha !== identity.workflowSha
			) throw new Error('Release operation identity mismatch');
			const target = githubRelease(execution);
			if (!target) throw new Error('Release operation has no version');
			const { tag, prerelease } = target;
			const gateway = this.gateway();
			const read = await gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
			const ref = await gateway.call(`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(tag)}`, read);
			if (ref === null) throw new Error('Publish the release tag before the release');
			const object = record(record(ref).object);
			if (object.type !== 'tag') throw new Error('Release tag must be annotated');
			const tagged = record(
				record(await gateway.call(`/repos/${execution.repository}/git/tags/${sha(object.sha)}`, read)).object,
			);
			if (tagged.type !== 'commit' || tagged.sha !== execution.sourceSha) {
				throw new Error('Release tag points to another commit');
			}
			const write = await gateway.token(execution.repository, execution.repositoryId, {
				contents: 'write',
				workflows: 'write',
			});
			const release = execution.draftRelease
				? await this.publishDraft(execution, execution.draftRelease, target, write)
				: record(
					await gateway.call(`/repos/${execution.repository}/releases/tags/${encodeURIComponent(tag)}`, read)
						?? await gateway.call(`/repos/${execution.repository}/releases`, write, 'POST', {
							tag_name: tag,
							target_commitish: execution.sourceSha,
							name: tag,
							generate_release_notes: true,
							prerelease,
						}),
				);
			if (release.tag_name !== tag || release.draft !== false || release.prerelease !== prerelease) {
				throw new Error('Existing GitHub release does not match the release operation');
			}
			return {
				id: `github-release:${execution.repository}`,
				manager: 'github-release',
				name: execution.repository,
				version: tag,
				outcome: 'succeeded',
				required: true,
				...(typeof release.html_url === 'string' ? { url: release.html_url } : {}),
			};
		});
		return this.report(id, identity, [publication], []);
	}
	private async draftRelease(execution: Execution): Promise<Execution['draftRelease']> {
		const target = githubRelease(execution);
		if (!target || !publishesGithubRelease(execution)) return execution.draftRelease;
		const gateway = this.gateway();
		const write = await gateway.token(execution.repository, execution.repositoryId, {
			contents: 'write',
			workflows: 'write',
		});
		if (execution.draftRelease) {
			const kept = await gateway.call(`/repos/${execution.repository}/releases/${execution.draftRelease.id}`, write);
			if (kept !== null) return execution.draftRelease;
		}
		const bot = await gateway.botIdentity();
		const drafts = array(await gateway.call(`/repos/${execution.repository}/releases?per_page=100`, write))
			.map(record)
			.filter(release => release.draft === true && release.tag_name === target.tag);
		const matches = (release: Record<string, unknown>) =>
			release.target_commitish === execution.sourceSha && release.prerelease === target.prerelease;
		for (const stale of drafts.filter(release => !matches(release) && record(release.author).id === bot.id)) {
			await gateway.call(`/repos/${execution.repository}/releases/${integer(stale.id)}`, write, 'DELETE');
		}
		const existing = drafts.find(matches);
		const release = existing ?? record(
			await gateway.call(`/repos/${execution.repository}/releases`, write, 'POST', {
				tag_name: target.tag,
				target_commitish: execution.sourceSha,
				name: target.tag,
				generate_release_notes: true,
				prerelease: target.prerelease,
				draft: true,
			}),
		);
		return { id: integer(release.id), tag: target.tag };
	}
	private async publishDraft(
		execution: Execution,
		draft: { id: number; tag: string },
		target: { tag: string; prerelease: boolean },
		token: string,
	): Promise<Record<string, unknown>> {
		const gateway = this.gateway();
		const path = `/repos/${execution.repository}/releases/${draft.id}`;
		const found = await gateway.call(path, token);
		if (found === null) throw new Error('Draft GitHub release no longer exists');
		const release = record(found);
		if (draft.tag !== target.tag || release.tag_name !== target.tag || release.prerelease !== target.prerelease) {
			throw new Error('Draft GitHub release does not match the release operation');
		}
		if (release.draft !== true) return release;
		const bot = await gateway.botIdentity();
		const others = array(await gateway.call(`/repos/${execution.repository}/releases?per_page=100`, token))
			.map(record)
			.filter(other =>
				other.draft === true && other.tag_name === target.tag && integer(other.id) !== draft.id
				&& record(other.author).id === bot.id
			);
		const names = new Set(array(release.assets).map(record).map(asset => text(asset.name)));
		for (const other of others) {
			for (const asset of array(other.assets).map(record)) {
				if (asset.state !== 'uploaded' || names.has(text(asset.name))) continue;
				await gateway.copyReleaseAsset(
					execution.repository,
					{ id: integer(asset.id), name: text(asset.name), contentType: text(asset.content_type) },
					draft.id,
					token,
				);
				names.add(text(asset.name));
			}
			await gateway.call(`/repos/${execution.repository}/releases/${integer(other.id)}`, token, 'DELETE');
		}
		const current = record(await gateway.call(path, token));
		if (array(current.assets).map(record).some(asset => asset.state !== 'uploaded')) {
			throw new Error('Draft GitHub release has unfinished asset uploads');
		}
		return record(await gateway.call(path, token, 'PATCH', { draft: false }));
	}
	async report(
		id: string,
		identity: WorkflowIdentity,
		publications: Publication[],
		artifacts: Artifact[],
	): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (!execution.workflow || execution.managed) throw new Error('Operation is not a workflow');
			if (
				execution.repositoryId !== identity.repositoryId
				|| execution.runId !== identity.runId
				|| execution.runAttempt !== identity.attempt
				|| execution.workflowSha !== identity.workflowSha
				|| execution.state !== 'running'
			) {
				throw new Error('Report identity mismatch');
			}
			for (const artifact of artifacts) {
				if (artifact.runId !== identity.runId) throw new Error('Artifact producer mismatch');
				if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest) || !(Date.parse(artifact.expiresAt) > Date.now())) {
					throw new Error('Artifact has no usable digest or has expired');
				}
				const gateway = this.gateway(),
					token = await gateway.token(execution.repository, execution.repositoryId);
				const actual = record(
					await gateway.call(
						`/repos/${execution.repository}/actions/artifacts/${artifact.id}`,
						token,
					),
				);
				if (
					record(actual.workflow_run).id !== identity.runId
					|| actual.expired
					|| actual.name !== artifact.name
					|| actual.digest !== artifact.digest
					|| actual.expires_at !== artifact.expiresAt
				) {
					throw new Error('Reported artifact does not match GitHub');
				}
			}
			const verified: Publication[] = [];
			for (const reported of publications) {
				const publication = { ...reported, identity: identityOf(reported, execution.repository) };
				if (publication.id.startsWith('refs:')) {
					throw new Error('Ref results are verified by the ref completion endpoint');
				}
				validatePublicationIdentity(execution, publication);
				if (canVerifyPublication(publication.manager) && publication.outcome === 'succeeded') {
					verified.push(
						await verifyPublication(
							publication,
							fetch,
							this.gateway().verification(execution.repository, execution.repositoryId),
						),
					);
				} else if (publication.manager === 'manifest' && publication.outcome === 'succeeded') {
					verified.push(await verifyManifest(publication, this.gateway()));
				} else if (
					publication.manager === 'github-release'
					&& publication.outcome === 'succeeded'
				) {
					if (publication.name !== execution.repository) {
						throw new Error('Release repository mismatch');
					}
					const gateway = this.gateway(),
						token = await gateway.token(execution.repository, execution.repositoryId);
					const release = record(
						await gateway.call(
							`/repos/${execution.repository}/releases/tags/${encodeURIComponent(publication.version)}`,
							token,
						),
					);
					const tag = record(
						await gateway.call(
							`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(publication.version)}`,
							token,
						),
					);
					let target = record(tag.object);
					if (target.type === 'tag') {
						target = record(
							record(
								await gateway.call(
									`/repos/${execution.repository}/git/tags/${sha(target.sha)}`,
									token,
								),
							).object,
						);
					}
					const valid = release.draft === false
						&& release.tag_name === publication.version
						&& target.type === 'commit'
						&& target.sha === execution.sourceSha;
					if (valid) {
						const reference: ReleaseReference = {
							id: `github:${execution.repositoryId}:${integer(release.id)}`,
							repository: { id: execution.repositoryId, name: execution.repository },
							stream: execution.stream,
							commit: execution.sourceSha,
							version: execution.version ?? publication.version.replace(/^v/, ''),
							tag: publication.version,
							releaseId: integer(release.id),
							artifacts: [],
							publications: [],
						};
						if (
							execution.release
							&& (execution.release.tag !== reference.tag || execution.release.releaseId !== reference.releaseId)
						) throw new Error('Release identity changed');
						execution.release = reference;
					}
					verified.push({ ...publication, outcome: valid ? 'succeeded' : 'failed' });
				} else verified.push(publication);
			}
			const next = {
				...execution,
				publications: mergePublications(execution.publications, verified),
				artifacts: mergeArtifacts(execution.artifacts, artifacts, execution.workflow.outputs),
			};
			await this.put(next);
			return next;
		});
	}
	private async supersedeVersion(execution: Execution): Promise<void> {
		if (execution.operation !== 'promote' || !execution.version) return;
		for (const other of await this.journal()) {
			if (
				other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
				&& other.version === execution.version && ['blocked', 'pending', 'ready'].includes(other.state)
			) {
				await this.put({ ...other, state: 'cancelled', reason: `Superseded by ${execution.id}` });
			}
		}
	}
	private async approveFromPush(execution: Execution, executions: Execution[]): Promise<boolean> {
		const newer = executions.find(other =>
			other.id !== execution.id && other.operation === 'promote' && other.stream === execution.stream
			&& other.version === execution.version && other.createdAt > execution.createdAt
			&& !['succeeded', 'cancelled', 'failed'].includes(other.state)
		);
		if (newer) {
			await this.put({ ...execution, state: 'cancelled', reason: `Superseded by ${newer.id}` });
			return true;
		}
		const problems = await this.approvalProblems(execution);
		if (problems.length) {
			const reason = `Releases when the commit is verified and its checks pass: ${problems.join('; ')}`;
			if (execution.reason !== reason) await this.put({ ...execution, reason });
			return false;
		}
		await this.store().audit('beepboop', 'promotion.approve', `${execution.id}:${execution.sourceSha}:push`);
		const next: Execution = { ...execution, state: 'ready' };
		delete next.reason;
		await this.supersedeVersion(next);
		await this.put(next);
		return true;
	}
	async approve(id: string, commitSha: string, actor: string, force = false): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (
				execution.operation !== 'promote'
				|| execution.state !== 'blocked'
				|| execution.sourceSha !== sha(commitSha)
			) {
				throw new Error('Approval does not match promotion target');
			}
			const problems = await this.approvalProblems(execution);
			if (problems.length && !force) throw new Error(problems.join('; '));
			await this.store().audit(
				actor,
				'promotion.approve',
				`${id}:${commitSha}${problems.length ? ` overriding: ${problems.join('; ')}` : ''}`,
			);
			const next: Execution = { ...execution, state: 'ready' };
			await this.supersedeVersion(next);
			await this.put(next);
			return next;
		});
	}
	async approvalReadiness(id: string): Promise<{ problems: string[] }> {
		const execution = await this.get(id);
		if (execution.operation !== 'promote' || execution.state !== 'blocked') {
			return { problems: ['This promotion is not waiting for approval'] };
		}
		return { problems: await this.approvalProblems(execution) };
	}
	private async approvalProblems(execution: Execution): Promise<string[]> {
		const gateway = this.gateway(),
			token = await gateway.token(execution.repository, execution.repositoryId);
		const base = `/repos/${execution.repository}`;
		const problems: string[] = [];
		const commit = record(await gateway.call(`${base}/commits/${execution.sourceSha}`, token));
		if (record(record(commit.commit).verification).verified !== true) {
			problems.push('The commit signature is not verified');
		}
		const checks = record(
			await gateway.call(`${base}/commits/${execution.sourceSha}/check-runs?per_page=100&filter=latest`, token),
		);
		const runs = array(checks.check_runs).map(record);
		if (checks.total_count !== runs.length) problems.push('The commit has more than 100 check runs');
		const releaseFiles = new Set(
			Object.values(execution.configuration.streams).flatMap(stream =>
				[stream.prepare.workflow, stream.promote.workflow, ...Object.values(stream.workflows)]
					.flatMap(binding => binding ? [`.github/workflows/${binding.file}`] : [])
			),
		);
		const workflowRuns = array(
			record(await gateway.call(`${base}/actions/runs?head_sha=${execution.sourceSha}&per_page=100`, token))
				.workflow_runs,
		).map(record);
		const paths = new Map(workflowRuns.map(run => [String(run.id), String(run.path)]));
		const gating = runs.filter(run => {
			const runId = /\/actions\/runs\/(\d+)\//.exec(String(run.details_url))?.[1];
			return !(runId && releaseFiles.has(paths.get(runId) ?? ''));
		});
		if (!gating.length) problems.push('No checks have run on this commit');
		for (const run of gating) {
			if (run.status !== 'completed') problems.push(`${String(run.name)} is still running`);
			else if (!['success', 'neutral', 'skipped'].includes(String(run.conclusion))) {
				problems.push(`${String(run.name)} ${String(run.conclusion)}`);
			}
		}
		const status = record(await gateway.call(`${base}/commits/${execution.sourceSha}/status`, token));
		if (Number(status.total_count) > 0 && status.state !== 'success') {
			problems.push(`Commit status is ${String(status.state)}`);
		}
		return problems;
	}
	async recover(id: string, action: 'reconcile' | 'retry', actor: string): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (action === 'retry') {
				if (!['failed', 'cancelled'].includes(execution.state)) {
					throw new Error('Only failed or cancelled operations can be retried');
				}
				if (execution.operation === 'prepare' && !execution.plan && !execution.managed) {
					throw new Error('This preparation has no plan; prepare the release from Prepare a release');
				}
				if (execution.artifacts.some((a) => Date.parse(a.expiresAt) <= Date.now())) {
					throw new Error('Artifacts expired; use the configured preparation/recovery producer');
				}
				const publications = execution.publications.map(publication =>
					publication.outcome === 'succeeded' ? publication : { ...publication, outcome: 'pending' as const }
				);
				const gateway = this.gateway(),
					token = await gateway.token(execution.repository, execution.repositoryId, {
						contents: 'read',
						actions: 'write',
					});
				const ref = execution.workflow?.ref?.replace(/^refs\/(heads|tags)\//, '');
				const run = execution.runId
					? await gateway.call(`/repos/${execution.repository}/actions/runs/${execution.runId}`, token)
					: null;
				const head = run !== null && ref
					? await gateway.call(`/repos/${execution.repository}/commits/${encodeURIComponent(ref)}`, token)
					: null;
				if (run !== null && head !== null && record(run).head_sha === record(head).sha) {
					await gateway.call(
						`/repos/${execution.repository}/actions/runs/${execution.runId}/rerun-failed-jobs`,
						token,
						'POST',
					);
					await this.put({
						...execution,
						state: 'uncertain',
						runAttempt: integer(record(run).run_attempt),
						reason: 'Retry requested; re-running the failed jobs',
						publications,
					});
				} else {
					await this.put({
						...execution,
						state: 'ready',
						supersededRuns: [...(execution.supersededRuns ?? []), ...(execution.runId ? [execution.runId] : [])],
						runId: undefined,
						runAttempt: undefined,
						workflowSha: undefined,
						reason: `Retry requested; ${ref ?? 'the workflow ref'} moved, so dispatching a new run`,
						publications,
					});
				}
				await this.supersedeVersion(execution);
				await this.ctx.storage.setAlarm(Date.now() + 1000);
			} else await this.wake();
			if (execution.releaseSet?.workflowId) {
				const instance = await this.env.RELEASE_WORKFLOW.get(execution.releaseSet.workflowId);
				const status = await instance.status();
				if (['errored', 'terminated'].includes(status.status)) {
					await instance.restart();
					await this.recordReleaseWorkflowInterruption(
						execution.releaseSet.preparationId,
						execution.releaseSet.workflowId,
						false,
					);
				}
			}
			await this.store().audit(actor, `execution.${action}`, id);
			return this.get(id);
		});
	}
	async cancel(id: string, actor: string): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (['succeeded', 'cancelled'].includes(execution.state)) throw new Error('Execution has already finished');
			if (execution.runId && ['dispatching', 'running', 'uncertain'].includes(execution.state)) {
				const gateway = this.gateway(),
					token = await gateway.token(execution.repository, execution.repositoryId, {
						contents: 'read',
						actions: 'write',
					});
				const path = `/repos/${execution.repository}/actions/runs/${execution.runId}`;
				if (record(await gateway.call(path, token)).status !== 'completed') {
					await gateway.call(`${path}/cancel`, token, 'POST');
				}
			}
			const next: Execution = { ...execution, state: 'cancelled', reason: 'Cancelled from the dashboard' };
			await this.put(next);
			await this.store().audit(actor, 'execution.cancel', id);
			return next;
		});
	}
	async wake(): Promise<void> {
		await this.wakeReleaseWorkflows();
		await this.ctx.storage.setAlarm(Date.now() + 1000);
	}
	async observeRun(repositoryId: number, runId: number): Promise<void> {
		await this.ctx.storage.put(`observe:${runId}`, { repositoryId, runId });
		await this.wake();
	}
	private async observations(): Promise<void> {
		const pending = await this.ctx.storage.list({
			prefix: 'observe:',
		});
		if (pending.size) await this.ctx.storage.setAlarm(Date.now() + 60000);
		for (const [key, value] of pending) {
			try {
				const event = observation.parse(value);
				const repository = await this.store().repository(event.repositoryId);
				if (!repository?.configuration || repository.suspended || repository.diagnostics.length) {
					await this.ctx.storage.delete(key);
					continue;
				}
				const gateway = this.gateway(),
					token = await gateway.token(repository.name, repository.id);
				const run = record(
					await gateway.call(`/repos/${repository.name}/actions/runs/${event.runId}`, token),
				);
				if (
					record(run.repository).id !== repository.id
					|| !['push', 'release', 'workflow_dispatch', 'schedule'].includes(String(run.event))
				) {
					await this.ctx.storage.delete(key);
					continue;
				}
				const branch = String(run.head_branch),
					ref = run.event === 'release' || /^v?\d+\.\d+\.\d+/.test(branch)
						? `refs/tags/${branch}`
						: `refs/heads/${branch}`;
				for (const [streamName, stream] of Object.entries(repository.configuration.streams)) {
					for (const [operation, binding] of Object.entries(stream.workflows)) {
						if (
							binding.mode !== 'observe'
							|| run.path !== `.github/workflows/${binding.file}`
							|| !matchesRef(binding.ref ?? repository.defaultBranch, ref)
						) {
							continue;
						}
						const version = ref.startsWith('refs/tags/') ? branch.replace(/^v/, '') : undefined;
						const execution = await createExecution(
							repository,
							streamName,
							operation,
							`observed:${event.runId}`,
							version,
							true,
						);
						if (await this.ctx.storage.get(`execution:${execution.id}`)) continue;
						const snapshot = await gateway.snapshot(
							repository.name,
							repository.id,
							sha(run.head_sha),
						);
						execution.sourceSha = snapshot.sha;
						execution.runId = event.runId;
						execution.runAttempt = integer(run.run_attempt);
						execution.state = 'running';
						if (version) {
							const commit = record(
								await gateway.call(`/repos/${repository.name}/commits/${snapshot.sha}`, token),
							);
							const tag = record(
								await gateway.call(
									`/repos/${repository.name}/git/ref/tags/${encodeURIComponent(branch)}`,
									token,
								),
							);
							let target = record(tag.object);
							if (target.type === 'tag') {
								target = record(
									record(
										await gateway.call(
											`/repos/${repository.name}/git/tags/${sha(target.sha)}`,
											token,
										),
									).object,
								);
							}
							if (
								record(record(commit.commit).verification).verified !== true
								|| target.type !== 'commit'
								|| target.sha !== snapshot.sha
							) {
								await this.put({
									...execution,
									state: 'failed',
									reason: 'Source commit signature or release tag identity is invalid',
								});
								continue;
							}
						}
						const inventory = discover(snapshot, repository.configuration.managers);
						if (
							inventory.diagnostics.some((d) => d.includes('cannot safely') || d.includes('cycle'))
						) {
							throw new Error('Producer inventory is incomplete');
						}
						for (
							const pkg of inventory.packages.filter(
								(p) =>
									Boolean(version)
									&& publishable(p)
									&& (!stream.packages || stream.packages.some(reference => matchesPackage(reference, p))),
							)
						) {
							if (!canVerifyPublication(pkg.manager)) continue;
							const released = observedVersion(pkg, branch);
							if (released === undefined) continue;
							const publication: Publication = {
								id: packageId(pkg),
								identity: publicationIdentity(pkg, released),
								manager: pkg.manager,
								name: pkg.name,
								version: released,
								outcome: 'pending',
								required: !pkg.optional,
							};
							execution.publications.push(
								await verifyPublication(
									publication,
									fetch,
									this.gateway().verification(repository.name, repository.id),
								),
							);
						}
						await this.put(execution);
					}
				}
				await this.ctx.storage.delete(key);
			} catch {
				/* Persist the observation until its producer can be verified. */
			}
		}
	}
	async setupEdited(edit: Omit<SetupEdit, 'due'>, changed: boolean): Promise<void> {
		const previous = setupEditSchema.optional().parse(await this.ctx.storage.get('setup-edit'));
		if (previous ? previous.number === edit.number && previous.body === edit.body : !changed) return;
		const due = Date.now() + 5000;
		await this.ctx.storage.put('setup-edit', { ...edit, due });
		await this.arm(due);
	}
	private async arm(at: number): Promise<void> {
		const current = await this.ctx.storage.getAlarm();
		if (current === null || current > at || current <= Date.now()) await this.ctx.storage.setAlarm(at);
	}
	private async rebuildSetup(): Promise<void> {
		const edit = setupEditSchema.optional().parse(await this.ctx.storage.get('setup-edit'));
		if (!edit) return;
		if (edit.due > Date.now()) return this.arm(edit.due);
		const store = this.store();
		try {
			const repository = await store.repository(edit.repositoryId);
			if (repository && !repository.suspended) {
				const gateway = this.gateway();
				await maintainSetup(store, gateway, await gateway.snapshot(repository.name, repository.id), {
					number: edit.number,
					choices: edit.choices,
				});
			}
		} catch (error) {
			await store.audit(
				'beepboop',
				'repository.setup.failed',
				`${edit.repositoryId} ${edit.head}: ${error instanceof Error ? error.message : 'Setup edit failed'}`,
			);
		}
		const current = setupEditSchema.optional().parse(await this.ctx.storage.get('setup-edit'));
		if (current?.due === edit.due) await this.ctx.storage.delete('setup-edit');
	}
	async alarm(): Promise<void> {
		await Promise.all([
			this.serial(async () => {
				await this.deliverReleaseEvents();
				await this.reconcile();
			}),
			this.serial(() => this.rebuildSetup()),
		]);
	}
	private async runManaged(execution: Execution): Promise<void> {
		const operation = execution.managed;
		if (!operation || execution.workflow) throw new Error('Invalid managed operation');
		try {
			if (operation.result) {
				await this.put({ ...execution, state: 'succeeded' });
				return;
			}
			if (operation.plan.requiresPreparation || operation.plan.sourceSha !== execution.sourceSha) {
				throw new Error('Managed preparation plan is not executable');
			}
			const gateway = this.gateway();
			const snapshot = await gateway.snapshot(
				execution.repository,
				execution.repositoryId,
				execution.sourceSha,
				operation.plan.edits.map(edit => edit.path),
			);
			execution.state = 'running';
			execution.attempts++;
			await this.put(execution);
			operation.result = operation.head
				? await gateway.resumePreparation(snapshot, operation.branch, operation.title, operation.body, operation.head)
				: await gateway.pullRequest(
					snapshot,
					operation.branch,
					operation.title,
					operation.body,
					operation.plan.edits,
					undefined,
					async head => {
						operation.head = head;
						await this.put(execution);
					},
				);
			execution.state = 'succeeded';
			delete execution.reason;
			await this.put(execution);
		} catch (error) {
			await this.put({
				...execution,
				state: 'uncertain',
				reason: error instanceof Error ? error.message : 'Managed preparation interrupted',
			});
		}
	}
	private async reconcile(onlyExecution?: string): Promise<void> {
		if (!onlyExecution) await this.observations();
		const executions = (await this.journal()).sort((a, b) => a.createdAt - b.createdAt);
		if (executions[0] && (await this.store().repository(executions[0].repositoryId))?.suspended) {
			return;
		}
		const active = executions.filter(
			(e) => !['succeeded', 'cancelled', 'failed'].includes(e.state),
		);
		const busy = new Set(
			active
				.filter((e) => ['dispatching', 'running', 'uncertain'].includes(e.state))
				.map((e) => e.stream),
		);
		if (active.some(e => !e.releaseSet?.workflowId)) await this.ctx.storage.setAlarm(Date.now() + 60000);
		for (const execution of executions) {
			if (onlyExecution ? execution.id !== onlyExecution : Boolean(execution.releaseSet?.workflowId)) continue;
			await this.store().putExecution(execution);
			if (execution.state === 'succeeded') await this.captureReleaseEvent(execution);
			if (!active.includes(execution) || execution.state === 'pending') continue;
			if (execution.state === 'blocked' && execution.operation === 'promote') {
				if (execution.configuration.streams[execution.stream]?.promote.approval !== 'push') continue;
				try {
					if (await this.approveFromPush(execution, executions)) {
						await this.ctx.storage.setAlarm(Date.now() + 1000);
						return;
					}
				} catch (error) {
					const reason = `Beepboop could not check this commit: ${
						error instanceof Error ? error.message : String(error)
					}`;
					if (execution.reason !== reason) await this.put({ ...execution, reason });
				}
				continue;
			}
			if (execution.managed) {
				await this.runManaged(execution);
				continue;
			}
			if (!execution.workflow) throw new Error('Execution has no runner');
			try {
				const gateway = this.gateway();
				const token = await gateway.token(execution.repository, execution.repositoryId, {
					contents: 'read',
					actions: 'write',
				});
				if (execution.runId) {
					const run = record(
						await gateway.call(
							`/repos/${execution.repository}/actions/runs/${execution.runId}`,
							token,
						),
					);
					if (
						record(run.repository).id !== execution.repositoryId
						|| run.path !== `.github/workflows/${execution.workflow.file}`
					) {
						throw new Error('Run identity changed');
					}
					if (
						run.status === 'completed' && execution.state === 'uncertain'
						&& integer(run.run_attempt) <= (execution.runAttempt ?? 0)
					) {
						continue;
					}
					if (run.status === 'completed') {
						for (let i = 0; i < execution.publications.length; i++) {
							const publication = execution.publications[i];
							if (
								publication
								&& canVerifyPublication(publication.manager)
								&& ['pending', 'uncertain'].includes(publication.outcome)
							) {
								execution.publications[i] = await verifyPublication(
									publication,
									fetch,
									this.gateway().verification(execution.repository, execution.repositoryId),
								);
							}
						}
						const limited = execution.publications.flatMap(publication =>
							publication.outcome === 'rate-limited' ? [Date.parse(publication.retryAfter)] : []
						);
						if (limited.length) {
							const until = Math.max(Date.now(), ...limited);
							if (execution.package?.manager === 'cargo') {
								await this.env.PUBLISH_BUDGET.getByName('crates-io').defer(until);
							}
							await this.put({
								...execution,
								state: 'ready',
								supersededRuns: [...(execution.supersededRuns ?? []), execution.runId],
								runId: undefined,
								runAttempt: undefined,
								workflowSha: undefined,
								notBefore: until,
								reason: `Registry rate limit until ${new Date(until).toISOString()}`,
								publications: execution.publications.map(publication =>
									publication.outcome === 'rate-limited' ? { ...publication, outcome: 'pending' } : publication
								),
							});
							continue;
						}
						const next = {
							...execution,
							state: completion(execution, run.conclusion === 'success'),
							runAttempt: integer(run.run_attempt),
						};
						await this.put(next);
					} else if (execution.state === 'uncertain') {
						await this.put({
							...execution,
							state: 'running',
							runAttempt: integer(run.run_attempt),
						});
					}
					continue;
				}
				if (['dispatching', 'uncertain'].includes(execution.state)) {
					const data = record(
						await gateway.call(
							`/repos/${execution.repository}/actions/workflows/${execution.workflow.file}/runs?event=workflow_dispatch&per_page=100`,
							token,
						),
					);
					const matches = array(data.workflow_runs)
						.map(record)
						.filter(
							(run) =>
								run.display_title === expectedRunTitle(execution)
								&& run.path === `.github/workflows/${execution.workflow?.file}`
								&& run.head_branch === execution.workflow?.ref?.replace(/^refs\/(heads|tags)\//, '')
								&& record(run.repository).id === execution.repositoryId
								&& !execution.supersededRuns?.includes(integer(run.id)),
						);
					const run = matches.length === 1 ? matches[0] : undefined;
					if (run) {
						await this.put({
							...execution,
							state: 'running',
							runId: integer(run.id),
							runAttempt: integer(run.run_attempt),
							workflowSha: undefined,
						});
					} else if (!matches.length && Date.now() - (execution.dispatchedAt ?? 0) > 120_000) {
						await this.put({
							...execution,
							state: 'ready',
							reason: 'GitHub started no run for the last dispatch; dispatching again',
						});
					} else {
						await this.put({
							...execution,
							state: 'uncertain',
							reason: matches.length
								? 'Multiple matching runs require review'
								: 'Dispatch outcome awaiting reconciliation',
						});
					}
					continue;
				}
				if (!dependenciesReady(execution, executions) || (execution.notBefore ?? 0) > Date.now()) {
					continue;
				}
				if (busy.has(execution.stream)) {
					const releaseId = execution.releaseSet?.workflowId;
					// Independent operations within one frozen release may run together.
					// Other releases and legacy executions still own the stream exclusively.
					if (
						!releaseId || active.some(other =>
							other.stream === execution.stream
							&& ['dispatching', 'running', 'uncertain'].includes(other.state)
							&& other.releaseSet?.workflowId !== releaseId
						)
					) continue;
				}
				execution.resolvedInputs = resolveInputs(execution, executions);
				const draftRelease = await this.draftRelease(execution);
				if (draftRelease) execution.draftRelease = draftRelease;
				busy.add(execution.stream);
				await this.put({
					...execution,
					state: 'dispatching',
					attempts: execution.attempts + 1,
					dispatchedAt: Date.now(),
				});
				const response = await gateway.call(
					`/repos/${execution.repository}/actions/workflows/${execution.workflow.file}/dispatches`,
					token,
					'POST',
					{
						ref: execution.workflow.ref,
						inputs: {
							...execution.workflow.inputs,
							...(execution.package ? { package: execution.package.id } : {}),
							...(execution.titled ? { beepboop_title: runTitle(execution) } : {}),
							beepboop_execution_id: execution.id,
						},
					},
				);
				if (response && record(response).workflow_run_id) {
					await this.put({
						...execution,
						state: 'running',
						attempts: execution.attempts + 1,
						runId: integer(record(response).workflow_run_id),
					});
				}
			} catch (error) {
				const reason = `Beepboop could not continue: ${error instanceof Error ? error.message : String(error)}`;
				const current = await this.get(execution.id);
				if (current.reason !== reason) await this.put({ ...current, reason });
			}
		}
	}
}
