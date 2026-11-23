import type { Execution } from '@/automation/types';
import type { Inventory, Package } from '@/domain/inventory.ts';
import {
	matchesPackage,
	matchesPublication,
	packageId,
	publicationIdentity,
	selectorKey,
} from '@/domain/package-identity.ts';
import { publishable } from '@/domain/package-publication.ts';
import { purl } from '@/domain/purl/index.ts';
import { isPrerelease, semVer } from '@/domain/version.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';
import type { LedgerManager } from '@/publication/contract.ts';
import { ledgerManagers } from '@/publication/contract.ts';
import type { Ledger, LedgerRecord } from '@/publication/ledger.ts';
import { availability, label, released } from '@/publication/ledger.ts';

const dependencyPoll = 30_000;

export type Blocker =
	| { kind: 'failed'; reason: string }
	| { kind: 'pending'; reason: string; until: number; producers: LedgerRecord[] };

export function planLedger(execution: Execution, inventory: Inventory, version: string): Ledger {
	const stream = execution.configuration.streams[execution.stream];
	const selected = execution.workflow?.publications ?? stream?.packages ?? [];
	const required = execution.workflow?.publications ?? stream?.required ?? [];
	const packages = inventory.packages;
	const order = inventory.publicationOrder;
	const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
	const candidates = packages.filter((pkg): pkg is Package & { manager: LedgerManager } =>
		publishable(pkg) && ledgerManagers.some(manager => manager === pkg.manager)
		&& selected.some(reference => matchesPackage(reference, pkg))
	).sort((a, b) => rank(packageId(a)) - rank(packageId(b)));
	return {
		executionId: execution.id,
		sourceSha: execution.sourceSha,
		records: candidates.map(pkg => ({
			purl: purl(publicationIdentity(pkg, version)),
			id: packageId(pkg),
			manager: pkg.manager,
			name: pkg.name,
			version,
			manifest: pkg.manifest,
			required: required.some(reference => matchesPackage(reference, pkg)),
			dependencies: pkg.dependencies.flatMap(name =>
				packages.filter(other => other.manager === pkg.manager && other.name === name && publishable(other))
					.map(packageId)
			),
			...(pkg.generated ? { generated: true } : {}),
			...(pkg.manager === 'npm' && stream
				? {
					channel: isPrerelease(decodeSync(semVer, version)) ? stream.channels.prerelease : stream.channels.stable,
				}
				: {}),
			status: { state: 'planned' as const },
			attempts: [],
		})),
	};
}

export function publicationDeadlock(
	current: Ledger,
	ledgers: Ledger[],
	executions: Execution[],
	now: number,
): LedgerRecord | undefined {
	const active = new Map(
		executions.filter(execution => execution.state === 'running').map(execution => [
			execution.id,
			execution,
		]),
	);
	const waiting = new Map<LedgerRecord, LedgerRecord[]>();
	for (const ledger of ledgers) {
		if (ledger.sourceSha !== current.sourceSha) continue;
		const execution = active.get(ledger.executionId);
		if (!execution?.runId) continue;
		const holder = `${execution.runId}:${execution.runAttempt ?? 1}`;
		for (const record of ledger.records) {
			if (availability(record, holder, now).kind !== 'open') continue;
			const blocker = dependencyBlocker(execution, record, holder, ledgers, executions, now);
			if (blocker?.kind === 'pending' && blocker.producers.length) waiting.set(record, blocker.producers);
		}
	}
	// A package can move if any producer it waits on can move.
	let before: number;
	do {
		before = waiting.size;
		for (const [record, producers] of waiting) {
			if (producers.some(producer => !waiting.has(producer))) waiting.delete(record);
		}
	} while (waiting.size !== before);
	return current.records.find(record => waiting.has(record));
}

export function dependencyBlocker(
	execution: Execution,
	record: LedgerRecord,
	holder: string,
	ledgers: Ledger[],
	executions: Execution[],
	now: number,
): Blocker | undefined {
	const live = (id: string) =>
		executions.some(other => other.id === id && !['succeeded', 'cancelled', 'failed'].includes(other.state));
	for (const dependency of record.dependencies) {
		const records = ledgers.filter(other => other.sourceSha === execution.sourceSha).flatMap(other =>
			other.records.filter(candidate => candidate.id === dependency).map(candidate => ({ other, candidate }))
		);
		if (records.some(({ candidate }) => released(candidate))) continue;
		if (
			executions.some(other =>
				other.repositoryId === execution.repositoryId && other.sourceSha === execution.sourceSha
				&& other.publications.some(p => p.outcome === 'succeeded' && matchesPublication(dependency, p))
			)
		) continue;
		const reason = `${label(record)} waits for ${dependency}`;
		const producers = records.filter(({ other, candidate }) =>
			candidate.status.state !== 'failed-permanent'
			&& !(candidate.status.state === 'failed-retryable' && candidate.status.holder === holder)
			&& live(other.executionId)
		).map(({ candidate }) => candidate);
		if (producers.length) {
			const until = Math.min(...producers.map(candidate =>
				candidate.status.state === 'rate-limited'
					? candidate.status.retryAfter
					: Math.max(candidate.notBefore ?? 0, now + dependencyPoll)
			));
			return { kind: 'pending', reason, until, producers };
		}
		if (records.length) return { kind: 'failed', reason: `${dependency} did not publish` };
		if (
			executions.some(other =>
				other.id !== execution.id && other.repositoryId === execution.repositoryId
				&& other.sourceSha === execution.sourceSha && live(other.id)
				&& (other.workflow?.publications ?? []).some(reference => selectorKey(reference) === dependency)
			)
		) return { kind: 'pending', reason, until: now + dependencyPoll, producers: [] };
	}
	return undefined;
}
