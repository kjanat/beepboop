import { DurableObject } from 'cloudflare:workers';
import { array, integer, record, sha } from '#model';
import type { WorkflowIdentity } from './auth.ts';
import {
	completion,
	createExecution,
	dependenciesReady,
	mergePublications,
	validatePublicationIdentity,
} from './execution.ts';
import { type Credentials, RepositoryGateway } from './github.ts';
import { canVerifyPublication, discover, verifyPublication } from './managers.ts';
import { verifyManifest } from './manifest.ts';
import { mergeArtifacts, resolveInputs } from './outputs.ts';
import { matchesRef } from './policy.ts';
import { planRefs, type RefPlan } from './refs.ts';
import { compileReleaseSet } from './release-set.ts';
import { Store } from './store.ts';
import type { Artifact, AutomationEvent, Edit, Execution, Publication, ReleaseReference } from './types.ts';

export interface CoordinatorBindings extends Credentials {
	DB: D1Database;
	OWNER_ID: string;
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
	private gateway(): RepositoryGateway {
		return new RepositoryGateway(this.env, Number(this.env.OWNER_ID));
	}
	private async put(execution: Execution): Promise<void> {
		execution.updatedAt = Date.now();
		// The journal is authoritative. D1 is an asynchronously repairable dashboard index.
		await this.ctx.storage.put(`execution:${execution.id}`, execution);
		await this.ctx.storage.setAlarm(Date.now() + 15000);
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
		const group = [...(await this.ctx.storage.list<Execution>({ prefix: 'execution:' })).values()]
			.filter(e =>
				e.state === 'succeeded' && e.stream === execution.stream && e.version === execution.version
				&& e.sourceSha === execution.sourceSha && e.configurationSha === execution.configurationSha
				&& e.releaseSet?.preparationId === execution.releaseSet?.preparationId
				&& e.releaseSet?.group === execution.releaseSet?.group
			);
		if (!required.every(key => group.some(e => e.publications.some(p => p.id === key && p.outcome === 'succeeded')))) {
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
		return [...(await this.ctx.storage.list<AutomationEvent>({ prefix: 'release-event:', limit: 100 })).values()];
	}
	async acknowledgeReleaseEvent(id: string): Promise<void> {
		await this.ctx.storage.delete(`release-event:${id}`);
	}
	async startReleaseSet(preparationId: string, target: string): Promise<Execution[]> {
		return this.serial(async () => {
			const preparation = await this.get(preparationId);
			if ((await this.store().repository(preparation.repositoryId))?.suspended) {
				throw new Error('Repository is suspended');
			}
			const key = `release-set:${preparationId}`;
			const prior = await this.ctx.storage.get<{ target: string; ids: string[] }>(key);
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
			await this.ctx.storage.transaction(async storage => {
				await storage.put({
					[key]: { target, ids: executions.map(execution => execution.id) },
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
			const prior = await this.ctx.storage.get<Execution>(`execution:${execution.id}`);
			if (prior) return prior;
			if (execution.configuration.streams[execution.stream]?.concurrency === 'supersede-pending') {
				for (
					const old of (
						await this.ctx.storage.list<Execution>({ prefix: 'execution:' })
					).values()
				) {
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
		const execution = await this.ctx.storage.get<Execution>(`execution:${id}`);
		if (!execution) throw new Error('Unknown execution');
		return execution;
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
			const expectedRef = execution.workflow.ref as string;
			if (!matchesRef(expectedRef, identity.ref)) throw new Error('Workflow ref mismatch');
			if (execution.attempts > 0 && run.display_title !== `Release operation ${id}`) {
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
					throw new Error('Artifact evidence mismatch');
				}
			}
			const verified: Publication[] = [];
			for (const publication of publications) {
				if (publication.id.startsWith('refs:')) {
					throw new Error('Ref results are verified by the ref completion endpoint');
				}
				validatePublicationIdentity(execution, publication);
				if (canVerifyPublication(publication.manager) && publication.outcome === 'succeeded') {
					verified.push(await verifyPublication(publication));
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
	async approve(id: string, commitSha: string, actor: string): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (
				execution.operation !== 'promote'
				|| execution.state !== 'blocked'
				|| execution.sourceSha !== sha(commitSha)
			) {
				throw new Error('Approval does not match promotion target');
			}
			const gateway = this.gateway(),
				token = await gateway.token(execution.repository, execution.repositoryId);
			const commit = record(
				await gateway.call(`/repos/${execution.repository}/commits/${commitSha}`, token),
			);
			if (record(record(commit.commit).verification).verified !== true) {
				throw new Error('Target commit signature is not verified');
			}
			const checks = record(
				await gateway.call(
					`/repos/${execution.repository}/commits/${commitSha}/check-runs?per_page=100&filter=latest`,
					token,
				),
			);
			const runs = array(checks.check_runs).map(record);
			if (
				checks.total_count !== runs.length
				|| !runs.length
				|| runs.some(
					(r) =>
						r.status !== 'completed'
						|| !['success', 'neutral', 'skipped'].includes(String(r.conclusion)),
				)
			) {
				throw new Error('Target checks have not passed');
			}
			const status = record(
				await gateway.call(`/repos/${execution.repository}/commits/${commitSha}/status`, token),
			);
			if (Number(status.total_count) > 0 && status.state !== 'success') {
				throw new Error('Target status checks have not passed');
			}
			await this.store().audit(actor, 'promotion.approve', `${id}:${commitSha}`);
			const next: Execution = { ...execution, state: 'ready' };
			await this.put(next);
			return next;
		});
	}
	async recover(id: string, action: 'reconcile' | 'retry', actor: string): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
			if (action === 'retry') {
				if (!['failed', 'cancelled'].includes(execution.state) || !execution.runId) {
					throw new Error('Only confirmed failed runs can be retried');
				}
				if (execution.artifacts.some((a) => Date.parse(a.expiresAt) <= Date.now())) {
					throw new Error('Artifacts expired; use the configured preparation/recovery producer');
				}
				const gateway = this.gateway(),
					token = await gateway.token(execution.repository, execution.repositoryId, {
						contents: 'read',
						actions: 'write',
					});
				await this.put({
					...execution,
					state: 'uncertain',
					reason: 'Retry requested; awaiting run reconciliation',
				});
				await gateway.call(
					`/repos/${execution.repository}/actions/runs/${execution.runId}/rerun-failed-jobs`,
					token,
					'POST',
				);
			} else await this.ctx.storage.setAlarm(Date.now() + 1000);
			await this.store().audit(actor, `execution.${action}`, id);
			return this.get(id);
		});
	}
	async wake(): Promise<void> {
		await this.ctx.storage.setAlarm(Date.now() + 1000);
	}
	async observeRun(repositoryId: number, runId: number): Promise<void> {
		await this.ctx.storage.put(`observe:${runId}`, { repositoryId, runId });
		await this.wake();
	}
	private async observations(): Promise<void> {
		const pending = await this.ctx.storage.list<{ repositoryId: number; runId: number }>({
			prefix: 'observe:',
		});
		if (pending.size) await this.ctx.storage.setAlarm(Date.now() + 60000);
		for (const [key, event] of pending) {
			try {
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
									&& p.publish
									&& (!stream.packages || stream.packages.includes(`${p.manager}:${p.name}`)),
							)
						) {
							if (!canVerifyPublication(pkg.manager)) continue;
							const publication: Publication = {
								id: `${pkg.manager}:${pkg.name}`,
								manager: pkg.manager,
								name: pkg.name,
								version: pkg.version,
								outcome: 'pending',
								required: !pkg.optional,
							};
							execution.publications.push(await verifyPublication(publication));
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
	async alarm(): Promise<void> {
		await this.serial(() => this.reconcile());
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
	private async reconcile(): Promise<void> {
		await this.observations();
		const executions = [
			...(await this.ctx.storage.list<Execution>({ prefix: 'execution:' })).values(),
		].sort((a, b) => a.createdAt - b.createdAt);
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
		if (active.length) await this.ctx.storage.setAlarm(Date.now() + 60000);
		for (const execution of executions) {
			await this.store().putExecution(execution);
			if (execution.state === 'succeeded') await this.captureReleaseEvent(execution);
			if (
				!active.includes(execution)
				|| execution.state === 'pending'
				|| (execution.state === 'blocked' && execution.operation === 'promote')
			) {
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
					if (run.status === 'completed') {
						for (let i = 0; i < execution.publications.length; i++) {
							const publication = execution.publications[i];
							if (
								publication
								&& canVerifyPublication(publication.manager)
								&& ['pending', 'uncertain'].includes(publication.outcome)
							) {
								execution.publications[i] = await verifyPublication(publication);
							}
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
								run.display_title === `Release operation ${execution.id}`
								&& run.path === `.github/workflows/${execution.workflow?.file}`
								&& run.head_branch === execution.workflow?.ref?.replace(/^refs\/(heads|tags)\//, '')
								&& record(run.repository).id === execution.repositoryId,
						);
					if (matches.length === 1) {
						const run = matches[0] as Record<string, unknown>;
						await this.put({
							...execution,
							state: 'running',
							runId: integer(run.id),
							runAttempt: integer(run.run_attempt),
							workflowSha: undefined,
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
				if (!dependenciesReady(execution, executions)) {
					continue;
				}
				if (busy.has(execution.stream)) continue;
				execution.resolvedInputs = resolveInputs(execution, executions);
				busy.add(execution.stream);
				await this.put({ ...execution, state: 'dispatching', attempts: execution.attempts + 1 });
				const response = await gateway.call(
					`/repos/${execution.repository}/actions/workflows/${execution.workflow.file}/dispatches`,
					token,
					'POST',
					{
						ref: execution.workflow.ref,
						inputs: { ...execution.workflow.inputs, beepboop_execution_id: execution.id },
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
			} catch {
				/* Durable intent remains authoritative; no automatic redispatch after uncertainty. */
			}
		}
	}
}
