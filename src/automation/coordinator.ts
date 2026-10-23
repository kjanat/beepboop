import { DurableObject } from 'cloudflare:workers';
import { array, integer, record, sha } from '#model';
import type { WorkflowIdentity } from './auth.ts';
import { completion, createExecution, mergePublications } from './execution.ts';
import { type Credentials, RepositoryGateway } from './github.ts';
import { discover, verifyPublication } from './managers.ts';
import { verifyManifest } from './manifest.ts';
import { verifyImage } from './oci.ts';
import { matchesRef } from './policy.ts';
import { planRefs, type RefPlan } from './refs.ts';
import { Store } from './store.ts';
import type { Artifact, AutomationEvent, Execution, Publication, ReleaseReference } from './types.ts';

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
		const required = execution.configuration.streams[execution.stream]?.required ?? [];
		if (!required.length) return;
		const id =
			`release:${execution.repositoryId}:${execution.stream}:${execution.configurationSha}:${execution.sourceSha}:${execution.version}`;
		if (await this.ctx.storage.get(`release-emitted:${id}`)) return;
		const group = [...(await this.ctx.storage.list<Execution>({ prefix: 'execution:' })).values()]
			.filter(e =>
				e.state === 'succeeded' && e.stream === execution.stream && e.version === execution.version
				&& e.sourceSha === execution.sourceSha && e.configurationSha === execution.configurationSha
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
	async enqueue(execution: Execution): Promise<Execution> {
		return this.serial(async () => {
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
	async register(id: string, identity: WorkflowIdentity): Promise<Execution> {
		return this.serial(async () => {
			const execution = await this.get(id);
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
				if (['cargo', 'npm'].includes(publication.manager) && publication.outcome === 'succeeded') {
					verified.push(await verifyPublication(publication));
				} else if (publication.manager === 'manifest' && publication.outcome === 'succeeded') {
					verified.push(await verifyManifest(publication, this.gateway()));
				} else if (publication.manager === 'oci' && publication.outcome === 'succeeded') {
					verified.push(await verifyImage(publication));
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
				artifacts: [
					...new Map([...execution.artifacts, ...artifacts].map((a) => [a.id, a])).values(),
				],
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
							if (!['cargo', 'npm'].includes(pkg.manager)) continue;
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
								&& ['cargo', 'npm'].includes(publication.manager)
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
								&& run.path === `.github/workflows/${execution.workflow.file}`
								&& run.head_branch === execution.workflow.ref?.replace(/^refs\/(heads|tags)\//, '')
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
				if (
					execution.dependencies.some(
						(id) => executions.find((e) => e.id === id)?.state !== 'succeeded',
					)
				) {
					continue;
				}
				if (busy.has(execution.stream)) continue;
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
