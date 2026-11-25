import { Context, Effect, Layer, Option, Schema } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { requireImmutableReleases } from '@/automation/immutable-release.ts';
import { Automation } from '@/automation/service.ts';
import { TagSigning } from '@/automation/tag-signing.ts';
import type { PackageTagPage } from '@/contract/views';
import { packageId, publicationIdentity, publishablePackages } from '@/domain/package-identity.ts';
import type { RefPlan, RefState } from '@/domain/refs.ts';
import { tagObjectId } from '@/domain/refs.ts';
import { semVer, tagFor } from '@/domain/version.ts';
import {
	comparisonSchema,
	gitRefSchema,
	releaseSchema,
	workflowRunSchema,
	workflowRunsSchema,
} from '@/github/resources.ts';
import { TagSigner } from '@/github/signing.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { logFailure, logRecovered } from '@/kernel/logging/failure-log.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';
import type { Publication } from '@/publication/publication.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';
import {
	canVerifyPublication,
	verifyPublication,
	verifySecondaryPublications,
} from '@/publication/registries/verify.ts';
import { readDistributionArtifact } from '@/release/distribution/artifact.ts';
import { createDistribution, readDistributionFile, readDistributionMode } from '@/release/distribution/validation.ts';
import { mergePublications } from '@/release/domain/execution/execution.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import type { PackageTagResult, PackageTagRow, Release } from '@/release/domain/package-tags.ts';
import {
	frozenPackageTagRows,
	packageTagGroups,
	packageTagPage,
	packageTagPages,
	packageTagRows,
	taggedReleases,
} from '@/release/domain/package-tags.ts';
import { referenceProbe } from '@/release/domain/reference-probe.ts';
import {
	conflictMessage,
	planRefs,
	releaseCommit,
	streamModuleTagPrefixes,
	tagConflict,
	tagPrefixes,
	versionTagged,
} from '@/release/domain/refs.ts';
import type { RefsRequest } from '@/release/domain/refs-request.ts';
import { Background } from '@/release/services/coordinator/background.ts';
import type { ExecutionCommitted } from '@/release/services/coordinator/executions.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';
import { RunBinder } from '@/release/services/coordinator/run-binder.ts';

type ReclaimingRelease = Pick<Execution, 'repository' | 'repositoryId' | 'stream' | 'version' | 'moduleTags'> & {
	id?: string;
};

export class RefPublication extends Context.Service<RefPublication, {
	readonly refs: (id: string, identity: RunIdentity, request: RefsRequest) => Effect.Effect<RefPlan, DomainError>;
	readonly distributionProblem: (
		execution: Execution,
		plan: RefPlan,
		refs: RefState[],
	) => Effect.Effect<string | undefined, DomainError>;
	readonly promoted: (execution: Execution) => Effect.Effect<boolean, DomainError>;
	readonly modulePrefixes: (execution: Execution) => Effect.Effect<string[], DomainError>;
	readonly versionTagged: (execution: Execution) => Effect.Effect<boolean, DomainError>;
	readonly tagProblem: (execution: Execution, registries?: boolean) => Effect.Effect<string | undefined, DomainError>;
	readonly reclaimable: (
		repositoryId: number,
		stream: string,
		version: string,
		primary: string,
		conflicts: RefState[],
		restartId?: string,
	) => Effect.Effect<RefState[], DomainError>;
	readonly packageTags: (
		repositoryId: number,
		stream: string,
		apply: boolean,
		after: string | undefined,
		actor: string,
	) => Effect.Effect<PackageTagPage, DomainError>;
	readonly tagPackagesLater: (committed: ExecutionCommitted) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/RefPublication') {
	static readonly layer = Layer.effect(
		RefPublication,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const executions = yield* Executions;
			const binder = yield* RunBinder;
			const signing = yield* TagSigning;
			const signers = yield* TagSigner;
			const background = yield* Background;

			const modulePrefixes = Effect.fnUntraced(function*(execution: Execution) {
				if (execution.moduleTags) return tagPrefixes(execution.moduleTags);
				const repository = yield* automation.store.repositories.get(execution.repositoryId);
				return streamModuleTagPrefixes(
					repository?.inventory.packages ?? [],
					execution.configuration.streams[execution.stream],
				);
			});

			const promoted = (execution: Execution): Effect.Effect<boolean, DomainError> => {
				if (execution.operation === 'promote') return Effect.succeed(true);
				const visited = new Set<string>();
				const approved = (current: Execution): Effect.Effect<boolean, DomainError> =>
					Effect.gen(function*() {
						if (visited.has(current.id)) return false;
						visited.add(current.id);
						if (current.state !== 'succeeded' || current.sourceSha !== execution.sourceSha) return false;
						if (current.operation === 'promote') return true;
						for (const dependency of current.dependencies) {
							if (yield* approved(yield* executions.get(dependency))) return true;
						}
						return false;
					});
				return Effect.gen(function*() {
					for (const dependency of execution.dependencies) {
						if (yield* approved(yield* executions.get(dependency))) return true;
					}
					return false;
				});
			};

			const distributionProblem = Effect.fnUntraced(function*(
				execution: Execution,
				plan: RefPlan,
				refs: RefState[],
			) {
				const evidence = plan.distribution;
				if (!evidence) return undefined;
				if (
					evidence.sourceSha !== execution.sourceSha || plan.changes.some(change => change.commit !== evidence.commit)
				) return 'Distribution refs differ from the authorized source and target';
				for (const change of plan.changes) {
					if (change.object) {
						const expected = yield* tagObjectId(change.object);
						if (!refs.some(ref => ref.name === change.name && ref.oid === expected)) {
							return 'Distribution tag object differs from the signed plan';
						}
					}
				}
				if (
					!plan.changes.every(change =>
						refs.some(ref =>
							ref.name === change.name && ref.commit === change.commit && (!change.annotated || ref.oid !== ref.commit)
						)
					)
				) return 'Distribution refs did not land';
				const gateway = automation.gateway;
				const token = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
				const branch = yield* gateway.read(
					gitRefSchema,
					`/repos/${execution.repository}/git/ref/heads/${encodeURIComponent(evidence.branch)}`,
					token,
				);
				if (branch.object.type !== 'commit') return 'Distribution ancestry did not land';
				if (branch.object.sha !== evidence.ancestryCommit) {
					const compared = yield* gateway.read(
						comparisonSchema,
						`/repos/${execution.repository}/compare/${evidence.ancestryCommit}...${branch.object.sha}`,
						token,
					);
					if (compared.status !== 'ahead' || compared.merge_base_commit.sha !== evidence.ancestryCommit) {
						return 'Distribution ancestry did not land';
					}
				}
				return undefined;
			});

			const reclaimableTags = Effect.fnUntraced(function*(
				release: ReclaimingRelease,
				conflicts: readonly RefState[],
				registries: boolean,
				primary: string,
				restartId?: string,
			) {
				const version = release.version;
				if (!version || !conflicts.length || conflicts.some(tag => tag.name !== primary)) return [];
				const releases = (yield* executions.all).filter(execution =>
					execution.operation === 'promote' && execution.stream === release.stream
					&& execution.version === version && execution.id !== release.id
				);
				const shipped = releases.some(execution =>
					['succeeded', 'dispatching', 'running', 'uncertain', 'verifying'].includes(execution.state)
					|| execution.publications.some(publication =>
						publication.outcome === 'succeeded' && !publication.id.startsWith('refs:')
					)
				);
				if (shipped) return [];
				const owned: RefState[] = [];
				for (const execution of releases) {
					if (
						!['failed', 'cancelled'].includes(execution.state)
						|| (restartId !== undefined && restartId !== execution.id)
						|| !execution.publications.some(publication =>
							publication.id === 'refs:promote' && publication.outcome === 'succeeded'
						)
					) continue;
					for (const change of execution.refPlan?.changes ?? []) {
						if (!change.annotated || (change.expected !== null && !change.replaces)) continue;
						const tag = conflicts.find(ref => ref.name === change.name && ref.commit === change.commit);
						if (!tag || owned.includes(tag) || tag.oid === tag.commit) continue;
						// Resuming the same execution leaves the previously confirmed tag in place.
						const oid = change.object !== undefined
							? yield* tagObjectId(change.object)
							: restartId === execution.id
							? execution.confirmedTagOid
							: undefined;
						if (tag.oid === oid) owned.push(tag);
					}
				}
				if (owned.length !== conflicts.length) return [];
				const record = yield* automation.store.repositories.get(release.repositoryId);
				const stream = record?.configuration?.streams[release.stream];
				const prefixes = [
					...streamModuleTagPrefixes(record?.inventory.packages ?? [], stream),
					...tagPrefixes(release.moduleTags ?? []),
				];
				for (const execution of releases) prefixes.push(...yield* modulePrefixes(execution));
				if (prefixes.some(prefix => `${prefix}${version}` === primary)) return [];
				const gateway = automation.gateway;
				const token = yield* gateway.token(release.repository, release.repositoryId, {
					contents: 'read',
					actions: 'read',
				});
				for (const execution of releases) {
					if (execution.runId === undefined) continue;
					const run = yield* gateway.read(
						workflowRunSchema,
						`/repos/${release.repository}/actions/runs/${execution.runId}`,
						token,
					);
					if (run.status !== 'completed') return [];
				}
				for (const commit of new Set(owned.map(tag => tag.commit))) {
					for (let page = 1;; page++) {
						const { workflow_runs: runs } = yield* gateway.read(
							workflowRunsSchema,
							`/repos/${release.repository}/actions/runs?head_sha=${commit}&per_page=100&page=${page}`,
							token,
						);
						if (runs.some(run => run.status !== 'completed')) return [];
						if (runs.length < 100) break;
					}
				}
				for (const tag of owned) {
					const published = yield* gateway.read(
						Schema.NullOr(releaseSchema),
						`/repos/${release.repository}/releases/tags/${encodeURIComponent(tag.name)}`,
						token,
					);
					if (
						published
						&& !(published.draft
							&& releases.some(execution => execution.id === restartId && execution.draftRelease?.id === published.id))
					) return [];
				}
				if (!registries) return owned;
				if (!record || !stream) return [];
				const transport = automation.dependencies.transport;
				const context = gateway.verification(release.repository, release.repositoryId);
				const probes = new Map<string, Publication>();
				for (const pkg of publishablePackages(record.inventory.packages, stream.packages)) {
					probes.set(`${pkg.manager}:${pkg.name}`, {
						id: packageId(pkg),
						identity: publicationIdentity(pkg, version),
						manager: pkg.manager,
						name: pkg.name,
						version,
						outcome: 'pending',
						required: true,
					});
				}
				for (const execution of releases) {
					const frozen = execution.configuration.streams[execution.stream];
					const references = [
						...(frozen?.packages ?? []),
						...(frozen?.required ?? []),
						...(execution.workflow?.publications ?? []),
					];
					for (const reference of references) {
						const probe = referenceProbe(reference, version);
						if (probe) probes.set(`${probe.manager}:${probe.name}`, probe);
					}
					for (const publication of execution.publications) {
						if (publication.manager === 'workflow' || publication.id.startsWith('refs:')) continue;
						probes.set(`${publication.manager}:${publication.name}`, {
							id: publication.id,
							...(publication.identity ? { identity: publication.identity } : {}),
							manager: publication.manager,
							name: publication.name,
							version,
							outcome: 'pending',
							required: true,
						});
					}
				}
				const outcomes = yield* Effect.forEach(
					[...probes.values()].filter(publication => canVerifyPublication(publication.manager)),
					publication =>
						Effect.all([
							verifyPublication(publication, transport, context),
							verifySecondaryPublications(publication, transport),
						]).pipe(Effect.map(([primary, secondary]) => [primary, ...secondary])),
					{ concurrency: 8 },
				);
				return outcomes.flat().every(outcome => outcome._tag === 'Pending') ? owned : [];
			});

			const packageTagWork = Effect.fnUntraced(function*(
				repository: string,
				repositoryId: number,
				rows: (refs: RefState[]) => PackageTagRow[],
				apply: boolean,
			) {
				const gateway = automation.gateway;
				const refs = yield* gateway.tagRefs(repository, repositoryId);
				const transport = automation.dependencies.transport;
				const context = gateway.verification(repository, repositoryId);
				const create = (row: PackageTagRow) =>
					signing.createTag(repository, repositoryId, { name: row.tag, commit: row.commit });
				const check = (row: PackageTagRow): Effect.Effect<PackageTagResult> =>
					Effect.gen(function*() {
						const base = { tag: row.tag, version: row.version, commit: row.commit };
						if (row.state === 'exists') return { ...base, outcome: 'exists' };
						if (row.state === 'conflict') {
							return {
								...base,
								outcome: 'conflict',
								reason: `${row.tag} already targets ${(row.target ?? '').slice(0, 12)}`,
							};
						}
						let published = false;
						const unanswered: string[] = [];
						for (const { reference, publication } of row.probes) {
							const verified = verifiedPublication(
								publication,
								yield* verifyPublication(publication, transport, context),
							);
							if (verified.outcome === 'succeeded') {
								published = true;
								break;
							}
							if (verified.outcome !== 'pending') unanswered.push(`${reference} is ${verified.outcome}`);
						}
						if (!published && unanswered.length) {
							return {
								...base,
								outcome: 'failed',
								reason: `The registry did not confirm ${row.version}: ${unanswered.join(', ')}`,
							};
						}
						if (!published) return { ...base, outcome: 'unpublished' };
						if (!apply) return { ...base, outcome: 'publishable' };
						const created = yield* Effect.result(create(row));
						return created._tag === 'Success'
							? { ...base, outcome: 'created' }
							: { ...base, outcome: 'failed', reason: decodeError(created.failure) };
					});
				return { rows: rows(refs), check };
			});

			const publishRefs = Effect.fnUntraced(function*(id: string, identity: RunIdentity, request: RefsRequest) {
				const { execution, workflow } = yield* binder.bind(id, identity, {
					_tag: 'SameRunAndName',
					mismatch: 'Ref operation identity mismatch',
				});
				const policy = workflow.refs;
				const version = execution.version;
				if (!policy || !version) return yield* precondition('No configured ref operation');
				if (!(yield* promoted(execution))) {
					return yield* precondition('Ref operation requires completed promotion');
				}
				const gateway = automation.gateway;
				const complete = request._tag === 'CompleteRefs';
				const files = yield* Effect.gen(function*() {
					if (request._tag === 'PlanRefs') return request.files;
					if (request._tag === 'CompleteRefs') return [];
					if (!policy.distribution) return yield* precondition('Unexpected distribution artifact');
					return yield* readDistributionArtifact(gateway, {
						artifact: request.artifact,
						identity,
						sourceSha: execution.sourceSha,
						paths: policy.distribution.files,
					});
				});
				const refs = complete && !execution.refPlan?.distribution
					? []
					: yield* gateway.tagRefs(execution.repository, execution.repositoryId);
				const pending = (execution.reclaims ?? []).filter(tag =>
					refs.some(ref => ref.name === tag.name && ref.oid === tag.oid)
				);
				if (pending.length) {
					const kept = yield* reclaimableTags(execution, pending, true, `${policy.prefix}${version}`);
					if (kept.length !== pending.length) {
						return yield* precondition(
							`${
								pending.map(tag => tag.name).join(', ')
							} can no longer move: a release of ${version} published or runs`,
						);
					}
				}
				if (!execution.refPlan) {
					if (complete) return yield* precondition('Ref plan has not been authorized');
					const read = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
					yield* requireImmutableReleases({
						gateway,
						repository: execution.repository,
						token: read,
						required: policy.immutable,
					});
					let target = execution.sourceSha;
					let distribution: RefPlan['distribution'];
					if (policy.distribution) {
						if (policy.phase !== 'version' || !policy.signed) {
							return yield* precondition('Distribution publication requires signed version refs');
						}
						const signer = yield* signers.current;
						if (Option.isNone(signer)) {
							return yield* precondition('Distribution publication requires the signing service');
						}
						distribution = yield* createDistribution(gateway, {
							repository: execution.repository,
							repositoryId: execution.repositoryId,
							sourceSha: execution.sourceSha,
							version,
							paths: policy.distribution.files,
							files,
							signer: signer.value,
						});
						target = distribution.commit;
					} else {
						if (files.length) return yield* precondition('No distribution files are configured');
						if (policy.phase === 'aliases') {
							const targets = new Set<string>();
							const visited = new Set<string>();
							const collect = (id: string): Effect.Effect<void, DomainError> =>
								Effect.gen(function*() {
									if (visited.has(id)) return;
									visited.add(id);
									const dependency = yield* executions.get(id);
									if (
										dependency.state !== 'succeeded' || dependency.sourceSha !== execution.sourceSha
										|| dependency.configurationSha !== execution.configurationSha
									) return yield* precondition('Alias dependency identity changed');
									if (dependency.refPlan?.distribution) targets.add(dependency.refPlan.distribution.commit);
									for (const parent of dependency.dependencies) yield* collect(parent);
								});
							for (const id of execution.dependencies) yield* collect(id);
							if (targets.size > 1) {
								return yield* precondition('Alias dependencies contain different distribution targets');
							}
							target = targets.values().next().value ?? target;
						}
					}
					const changes = yield* planRefs(
						policy,
						version,
						target,
						refs,
						yield* modulePrefixes(execution),
						execution.reclaims ?? [],
					);
					execution.refPlan = yield* signing.sign({
						repository: execution.repository,
						executionId: id,
						version,
						changes,
						...(distribution ? { distribution } : {}),
					});
					yield* executions.put(execution);
				}
				const plan = execution.refPlan;
				if (!complete && plan.distribution && policy.distribution) {
					if (
						files.length !== policy.distribution.files.length
						|| new Set(files.map(file => file.path)).size !== files.length
						|| files.some(file => !policy.distribution?.files.includes(file.path))
					) return yield* precondition('Distribution files differ from the frozen plan');
					const token = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
					for (const file of files) {
						if (
							(yield* readDistributionFile(
								gateway,
								execution.repository,
								file.path,
								plan.distribution.commit,
								file.encoding,
								token,
							)) !== file.after
							|| (yield* readDistributionFile(
								gateway,
								execution.repository,
								file.path,
								execution.sourceSha,
								file.encoding,
								token,
							))
								!== file.before
							|| (yield* readDistributionMode(
								gateway,
								execution.repository,
								file.path,
								plan.distribution.commit,
								token,
							))
								!== (file.mode ?? '100644')
						) return yield* precondition('Distribution files differ from the frozen plan');
					}
				}
				if (complete) {
					const problem = yield* distributionProblem(execution, plan, refs);
					if (problem) return yield* precondition(problem);
					const primary = plan.changes.find(change => change.annotated && change.name === `${policy.prefix}${version}`);
					if (primary && primary.object === undefined && (primary.expected === null || primary.replaces)) {
						const token = yield* gateway.token(execution.repository, execution.repositoryId, { contents: 'read' });
						const ref = yield* gateway.read(
							Schema.NullOr(gitRefSchema),
							`/repos/${execution.repository}/git/ref/tags/${encodeURIComponent(primary.name)}`,
							token,
						);
						if (execution.confirmedTagOid && execution.confirmedTagOid !== ref?.object.sha) {
							return yield* precondition('Confirmed version tag changed');
						}
						if (ref && !execution.confirmedTagOid) {
							if (ref.object.type !== 'tag') return yield* precondition('Version tag must be annotated');
							const target = yield* gateway.peelTag(execution.repository, ref.object, token);
							if (target.type !== 'commit' || target.sha !== primary.commit) {
								return yield* precondition('Version tag differs from the authorized target');
							}
							execution.confirmedTagOid = ref.object.sha;
						}
					}
					execution.publications = yield* mergePublications(execution.publications, [{
						id: `refs:${execution.operation}`,
						manager: 'workflow',
						name: execution.repository,
						version,
						outcome: 'succeeded',
						required: true,
					}]);
					yield* executions.put(execution);
				}
				return plan;
			});

			return RefPublication.of({
				refs: publishRefs,
				distributionProblem,
				promoted,
				modulePrefixes,
				versionTagged: Effect.fnUntraced(function*(execution: Execution) {
					const policy = execution.workflow?.refs;
					const version = safeDecode(semVer, execution.version);
					if (!policy || !version.success) return false;
					const refs = yield* automation.gateway.tagRefs(execution.repository, execution.repositoryId);
					return versionTagged(policy, version.data, releaseCommit(execution), refs, yield* modulePrefixes(execution));
				}),
				tagProblem: Effect.fnUntraced(function*(execution: Execution, registries = false) {
					const policy = execution.workflow?.refs;
					const version = safeDecode(semVer, execution.version);
					if (execution.operation !== 'promote' || !policy || !version.success) return undefined;
					const refs = yield* automation.gateway.tagRefs(execution.repository, execution.repositoryId);
					const conflict = tagConflict(
						policy,
						version.data,
						execution.sourceSha,
						refs,
						yield* modulePrefixes(execution),
						execution.reclaims ?? [],
					);
					if (conflict) return conflictMessage(conflict);
					const pending = (execution.reclaims ?? []).filter(tag =>
						refs.some(ref => ref.name === tag.name && ref.oid === tag.oid)
					);
					if (!pending.length) return undefined;
					const kept = yield* reclaimableTags(execution, pending, registries, tagFor(policy, version.data));
					const lost = pending.find(tag => !kept.some(entry => entry.name === tag.name));
					return lost && `${conflictMessage(lost)}, and that release published packages`;
				}),
				reclaimable: Effect.fnUntraced(function*(
					repositoryId: number,
					stream: string,
					version: string,
					primary: string,
					conflicts: RefState[],
					restartId?: string,
				) {
					const record = yield* automation.store.repositories.get(repositoryId);
					if (!record) return [];
					const probe = { repository: record.name, repositoryId: record.id, stream, version };
					return yield* reclaimableTags(probe, conflicts, true, primary, restartId);
				}),
				packageTags: Effect.fnUntraced(function*(
					repositoryId: number,
					stream: string,
					apply: boolean,
					after: string | undefined,
					actor: string,
				) {
					const record = yield* automation.store.repositories.get(repositoryId);
					if (!record?.configuration) return yield* precondition('Repository not configured');
					const configured = record.configuration.streams[stream];
					if (!configured) return yield* precondition(`Unknown stream ${stream}`);
					const references = configured.packageTags ?? [];
					if (!references.length) return yield* precondition(`Stream ${stream} names no packageTags`);
					const policy = configured.promote.workflow?.refs;
					if (policy?.phase !== 'version') {
						return yield* precondition(`Stream ${stream} pushes no version tag, so its packages get no tags`);
					}
					const groups = packageTagGroups(references, policy.prefix, record.inventory.packages);
					const work = yield* packageTagWork(
						record.name,
						record.id,
						refs => packageTagRows(groups, taggedReleases(policy.prefix, refs), refs),
						apply,
					);
					const page = yield* packageTagPage(work.rows, after, work.check);
					if (apply) {
						const created = page.results.filter(result => result.outcome === 'created').map(result => result.tag);
						yield* automation.store.audit(
							actor,
							'repository.package-tags',
							`${record.name}: ${created.length ? created.join(', ') : 'none created'}`,
						);
					}
					return page;
				}),
				tagPackagesLater: Effect.fnUntraced(function*({ execution, previous }: ExecutionCommitted) {
					if (execution.state !== 'succeeded' || previous?.state === 'succeeded') return;
					const promotion = execution.operation === 'promote'
						? execution
						: execution.version === undefined
						? undefined
						: (yield* executions.all).find(other =>
							other.operation === 'promote' && other.state === 'succeeded' && other.stream === execution.stream
							&& other.version === execution.version
						);
					const references = promotion?.configuration.streams[promotion.stream]?.packageTags;
					const policy = promotion?.workflow?.refs;
					const version = promotion?.version;
					if (!promotion || !references?.length || policy?.phase !== 'version' || !version) return;
					const release: Release = { version, commit: promotion.sourceSha };
					const frozen = promotion.packageTags;
					const work = Effect.gen(function*() {
						const packages = frozen
							? []
							: (yield* automation.store.repositories.get(execution.repositoryId))?.inventory.packages ?? [];
						const work = yield* packageTagWork(
							execution.repository,
							execution.repositoryId,
							refs =>
								frozen
									? frozenPackageTagRows(frozen, release, refs)
									: packageTagRows(packageTagGroups(references, policy.prefix, packages), [release], refs),
							true,
						);
						const results = yield* packageTagPages(work.rows, work.check);
						for (
							const result of results.filter(result => result.outcome === 'failed' || result.outcome === 'conflict')
						) {
							yield* logFailure(
								'package-tags.failed',
								precondition(result.reason ?? `${result.tag} was not created`),
								{ executionId: execution.id, tag: result.tag },
							);
						}
					}).pipe(logRecovered('package-tags.failed', { executionId: execution.id }));
					yield* background.fork(work);
				}),
			});
		}),
	);

	static readonly packageTagSchedule = Layer.effectDiscard(Effect.gen(function*() {
		const publication = yield* RefPublication;
		yield* (yield* Executions).onCommitted(publication.tagPackagesLater);
	}));
}
