import { Clock, Context, Effect, Layer } from 'effect';
import type { RunIdentity } from '@/auth/actions-oidc.ts';
import { WorkflowRunGuard } from '@/auth/actions-oidc.ts';
import type { Inventory, Package } from '@/domain/inventory.ts';
import { packageId, parseReleaseIdentity } from '@/domain/package-identity.ts';
import { toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { parseRetryAfter } from '@/kernel/http/http-date.ts';
import type { ClaimStep, NextStep, PublishReport, ReportStep } from '@/publication/contract.ts';
import type { Ledger, LedgerRecord } from '@/publication/ledger.ts';
import {
	availability,
	claim,
	entry,
	fail,
	label,
	pacedPublication,
	publicationOf,
	publish,
	rateLimit,
	registries,
	released,
	reservation,
	reuse,
	view,
} from '@/publication/ledger.ts';
import type { LedgerExecution } from '@/publication/ledger-plan.ts';
import { dependencyBlocker, planLedger, publicationDeadlock } from '@/publication/ledger-plan.ts';
import type { Publication } from '@/publication/publication.ts';
import type { PacedManager, PublishKind } from '@/publication/publish-pace.ts';
import { PublishPacing, paced } from '@/publication/publish-pace.ts';
import type { CheckOutcome } from '@/publication/registries/outcome.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';

const defaultRetryAfter = 60_000;
const unconfirmedRetry = 15_000;

export interface LedgerOwner extends LedgerExecution {
	readonly repository: string;
	readonly workflowSha?: string | undefined;
	readonly version?: string | undefined;
}

export class LedgerStore extends Context.Service<LedgerStore, {
	readonly get: (executionId: string) => Effect.Effect<Ledger | undefined, DomainError>;
	readonly all: Effect.Effect<Ledger[], DomainError>;
	readonly put: (ledger: Ledger) => Effect.Effect<void, DomainError>;
	readonly execution: (id: string) => Effect.Effect<LedgerOwner, DomainError>;
	readonly executions: Effect.Effect<readonly LedgerOwner[], DomainError>;
	readonly recordPublication: (executionId: string, publication: Publication) => Effect.Effect<void, DomainError>;
	readonly inventory: (repositoryId: number) => Effect.Effect<Inventory | undefined, DomainError>;
}>()('beepboopbot/publication/LedgerStore') {}

export class RegistryVerification extends Context.Service<RegistryVerification, {
	readonly verify: (repository: string, repositoryId: number, publication: Publication) => Effect.Effect<CheckOutcome>;
}>()('beepboopbot/publication/RegistryVerification') {}

function missingReceipt(execution: LedgerExecution, record: LedgerRecord): boolean {
	return released(record)
		&& !execution.publications.some(publication =>
			publication.id === record.id && publication.version === record.version && publication.outcome === 'succeeded'
			&& (!record.digest || publication.digest === record.digest)
		);
}

function owed(execution: LedgerExecution, ledger: Ledger | undefined): ledger is Ledger {
	return ledger?.records.some(record => record.status.state === 'uploaded' || missingReceipt(execution, record))
		?? false;
}

type Settled = Extract<ReportStep, { kind: 'settled' }>;

export class PublicationLedger extends Context.Service<PublicationLedger, {
	readonly next: (id: string, identity: RunIdentity) => Effect.Effect<NextStep, DomainError>;
	readonly claim: (
		id: string,
		identity: RunIdentity,
		purl: string,
		digest: string,
	) => Effect.Effect<ClaimStep, DomainError>;
	readonly report: (id: string, identity: RunIdentity, report: PublishReport) => Effect.Effect<ReportStep, DomainError>;
	readonly reserve: (
		repositoryId: number,
		manager: PacedManager,
		matches: (pkg: Package) => boolean,
	) => Effect.Effect<{ kind: PublishKind; allowedAt: number }, DomainError>;
	readonly owesReceipts: (execution: LedgerExecution) => Effect.Effect<boolean, DomainError>;
	readonly settleReceipts: (execution: LedgerExecution) => Effect.Effect<boolean, DomainError>;
}>()('beepboopbot/publication/PublicationLedger') {
	static readonly layer = Layer.effect(
		PublicationLedger,
		Effect.gen(function*() {
			const store = yield* LedgerStore;
			const pacing = yield* PublishPacing;
			const registry = yield* RegistryVerification;

			const publishing = Effect.fnUntraced(function*(id: string, identity: RunIdentity) {
				const execution = yield* store.execution(id);
				yield* WorkflowRunGuard.require(execution, identity, {
					_tag: 'SameRun',
					mismatch: 'Publication identity mismatch',
				});
				return { execution, holder: `${identity.runId}:${identity.attempt}` };
			});
			const recordPublication = Effect.fnUntraced(function*(
				executionId: string,
				record: LedgerRecord,
				publication: Publication,
			) {
				const identity = yield* Effect.fromResult(parseReleaseIdentity(record.purl)).pipe(
					Effect.mapError(toDomainError),
				);
				yield* store.recordPublication(executionId, { ...publication, identity });
			});
			const settleRecord = Effect.fnUntraced(function*(ledger: Ledger, record: LedgerRecord) {
				const next = {
					...ledger,
					records: ledger.records.map(entry => entry.purl === record.purl ? record : entry),
				};
				yield* store.put(next);
				const publication = publicationOf(record);
				if (publication) yield* recordPublication(ledger.executionId, record, publication);
				return next;
			});
			const settled = (ledger: Ledger, record: LedgerRecord): Effect.Effect<Settled, DomainError> =>
				settleRecord(ledger, record).pipe(Effect.as({
					kind: 'settled' as const,
					entry: entry(record),
					...(record.status.state === 'rate-limited' ? { until: record.status.retryAfter } : {}),
				}));
			const acceptedUploads = Effect.fnUntraced(function*(ledger: Ledger) {
				const clock = yield* Clock.Clock;
				let next = ledger;
				const execution = yield* store.execution(ledger.executionId);
				for (const record of ledger.records) {
					if (record.status.state === 'uploaded') {
						next = yield* settleRecord(
							next,
							publish(record, record.status.holder, '', clock.currentTimeMillisUnsafe()),
						);
					} else if (missingReceipt(execution, record)) {
						const publication = publicationOf(record);
						if (publication) yield* recordPublication(ledger.executionId, record, publication);
					}
				}
				return next;
			});
			const ledgerOf = Effect.fnUntraced(function*(execution: LedgerOwner) {
				const stored = yield* store.get(execution.id);
				if (stored !== undefined) return yield* acceptedUploads(stored);
				const inventory = yield* store.inventory(execution.repositoryId);
				if (!inventory) return yield* precondition('Repository is not enrolled');
				const version = execution.version;
				if (!version) return yield* precondition('The execution has no version to publish');
				const ledger = planLedger(execution, inventory, version);
				yield* store.put(ledger);
				return ledger;
			});
			const recordOf = (ledger: Ledger, purl: string): Effect.Effect<LedgerRecord, DomainError> => {
				const record = ledger.records.find(entry => entry.purl === purl);
				return record ? Effect.succeed(record) : Effect.fail(precondition(`${purl} is not in this execution's plan`));
			};
			const probe = (execution: LedgerOwner, record: LedgerRecord): Effect.Effect<Publication, DomainError> =>
				Effect.fromResult(parseReleaseIdentity(record.purl)).pipe(
					Effect.mapError(toDomainError),
					Effect.flatMap(identity => {
						const publication: Publication = {
							identity,
							id: record.id,
							manager: record.manager,
							name: record.name,
							version: record.version,
							required: record.required,
							...(record.digest ? { digest: record.digest } : {}),
							outcome: 'succeeded',
						};
						return registry.verify(execution.repository, execution.repositoryId, publication).pipe(
							Effect.map(outcome => verifiedPublication(publication, outcome)),
						);
					}),
				);
			const verified = (
				ledger: Ledger,
				record: LedgerRecord,
				holder: string,
				found: Publication,
				accept: (url: string) => LedgerRecord,
				now: number,
			): Effect.Effect<Settled | undefined, DomainError> => {
				if (found.outcome === 'succeeded') return settled(ledger, accept(found.url ?? ''));
				if (found.outcome === 'failed') {
					return settled(
						ledger,
						fail(record, holder, `${registries[record.manager]} has a different ${label(record)}`, true, now),
					);
				}
				return Effect.undefined;
			};
			const reserve = Effect.fnUntraced(function*(
				repositoryId: number,
				manager: PacedManager,
				matches: (pkg: Package) => boolean,
			) {
				const inventory = yield* store.inventory(repositoryId);
				const kind = reservation(inventory?.packages.find(matches)?.publicationStatus);
				const allowedAt = yield* pacing.reserve(manager, kind);
				return { kind, allowedAt };
			});

			return PublicationLedger.of({
				next: Effect.fnUntraced(function*(id: string, identity: RunIdentity) {
					const clock = yield* Clock.Clock;
					const { execution, holder } = yield* publishing(id, identity);
					let ledger = yield* ledgerOf(execution);
					const now = clock.currentTimeMillisUnsafe();
					const ledgers = yield* store.all, executions = yield* store.executions;
					const waits: { until: number; reason: string }[] = [];
					for (const purl of ledger.records.map(record => record.purl)) {
						const record = ledger.records.find(entry => entry.purl === purl);
						if (!record) continue;
						const open = availability(record, holder, now);
						if (open.kind === 'settled' || open.kind === 'uploaded') continue;
						if (open.kind === 'held') return { kind: 'publish' as const, package: view(record) };
						if (open.kind === 'wait') {
							waits.push(open);
							continue;
						}
						const blocked = dependencyBlocker(execution, record, holder, ledgers, executions, now);
						if (blocked?.kind === 'failed') {
							ledger = yield* settleRecord(ledger, fail(record, holder, blocked.reason, false, now));
						} else if (blocked) waits.push({ until: blocked.until, reason: blocked.reason });
						else return { kind: 'publish' as const, package: view(record) };
					}
					const [wait] = waits.sort((a, b) => a.until - b.until);
					if (wait) {
						const cycle = publicationDeadlock(
							ledger,
							[ledger, ...ledgers.filter(other => other.executionId !== id)],
							executions,
							now,
						);
						if (cycle) return yield* precondition(`Publication dependency cycle at ${cycle.id}`);
					}
					return wait
						? { kind: 'wait' as const, ...wait }
						: { kind: 'done' as const, entries: ledger.records.map(entry) };
				}),
				claim: Effect.fnUntraced(function*(id: string, identity: RunIdentity, purl: string, digest: string) {
					const clock = yield* Clock.Clock;
					const { execution, holder } = yield* publishing(id, identity);
					const ledger = yield* ledgerOf(execution);
					let record = yield* recordOf(ledger, purl);
					const now = clock.currentTimeMillisUnsafe();
					const open = availability(record, holder, now);
					if (open.kind === 'settled' || open.kind === 'uploaded') {
						return { kind: 'settled' as const, entry: entry(record) };
					}
					if (open.kind === 'wait') return { kind: 'wait' as const, until: open.until, reason: open.reason };
					if (open.kind === 'open') {
						const blocked = dependencyBlocker(
							execution,
							record,
							holder,
							yield* store.all,
							yield* store.executions,
							now,
						);
						if (blocked?.kind === 'failed') {
							return yield* settled(ledger, fail(record, holder, blocked.reason, false, now));
						}
						if (blocked) return { kind: 'wait' as const, until: blocked.until, reason: blocked.reason };
						const found = yield* probe(execution, { ...record, digest });
						const reused = yield* verified(
							ledger,
							record,
							holder,
							found,
							url => reuse({ ...record, digest }, holder, url, now),
							now,
						);
						if (reused) return reused;
						if (found.outcome !== 'pending') {
							return {
								kind: 'wait' as const,
								until: now + unconfirmedRetry,
								reason: `${registries[record.manager]} could not confirm whether it has ${label(record)}`,
							};
						}
						if (paced(record.manager) && !record.reservation) {
							const { kind, allowedAt } = yield* reserve(
								execution.repositoryId,
								record.manager,
								pkg => packageId(pkg) === record.id,
							);
							record = { ...record, reservation: kind, notBefore: allowedAt };
							yield* settleRecord(ledger, record);
							const pace = availability(record, holder, now);
							if (pace.kind === 'wait') {
								yield* recordPublication(execution.id, record, pacedPublication(record, pace.until));
								return { kind: 'wait' as const, until: pace.until, reason: pace.reason };
							}
						}
					}
					const claimed = yield* Effect.fromResult(claim(record, holder, digest, now));
					yield* settleRecord(ledger, claimed);
					return { kind: 'publish' as const, package: view(claimed) };
				}),
				report: Effect.fnUntraced(function*(id: string, identity: RunIdentity, report: PublishReport) {
					const clock = yield* Clock.Clock;
					const { execution, holder } = yield* publishing(id, identity);
					const ledger = yield* ledgerOf(execution);
					const record = yield* recordOf(ledger, report.purl);
					const now = clock.currentTimeMillisUnsafe();
					const open = availability(record, holder, now);
					if (open.kind === 'settled' || open.kind === 'uploaded') {
						return { kind: 'settled' as const, entry: entry(record) };
					}
					if (report.outcome === 'failed' && open.kind === 'open') {
						return yield* settled(ledger, fail(record, holder, report.message, false, now));
					}
					if (open.kind !== 'held') return yield* precondition(`This run does not hold ${label(record)}`);
					if (report.outcome === 'rate-limited') {
						const until = parseRetryAfter(report.retryAfter ?? '', now) ?? now + defaultRetryAfter;
						yield* pacing.defer(record.manager, until);
						return yield* settled(ledger, rateLimit(record, holder, until, now));
					}
					if (report.outcome === 'published') return yield* settled(ledger, publish(record, holder, '', now));
					const found = yield* probe(execution, record);
					const accepted = yield* verified(
						ledger,
						record,
						holder,
						found,
						url => publish(record, holder, url, now),
						now,
					);
					return accepted ?? (yield* settled(ledger, fail(record, holder, report.message, false, now)));
				}),
				reserve,
				owesReceipts: execution => store.get(execution.id).pipe(Effect.map(ledger => owed(execution, ledger))),
				settleReceipts: Effect.fnUntraced(function*(execution: LedgerExecution) {
					const ledger = yield* store.get(execution.id);
					if (!owed(execution, ledger)) return false;
					yield* acceptedUploads(ledger);
					return true;
				}),
			});
		}),
	);
}
