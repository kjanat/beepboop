import type { Status, Tone } from '@/contract/views';
import { managerSpec } from '@/domain/catalog.ts';
import { matchesPublication } from '@/domain/package-identity.ts';
import { packageLabel } from '@/domain/package-label';
import { rerunnable, stoppedByGates } from '@/domain/release-gates.ts';
import { startLabels } from '@/domain/release-start.ts';
import { versionPrMergeSentences } from '@/domain/setup-terms.ts';
import { defaultTagPolicy, semVer, tagFor } from '@/domain/version.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';
import { formatTime } from '@/kernel/time.ts';
import { githubHref, registryHref } from '@/publication/links.ts';
import type { Publication } from '@/publication/publication.ts';
import { runFailedNote } from '@/release/domain/execution/execution.ts';
import { retiredStates, settledStates } from '@/release/domain/execution/states.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { pipelineStages } from '@/release/domain/stages.ts';
import type { releaseSummaries } from '@/release/domain/summaries.ts';
import { byAge, checksPolicy, publishesAutomatically, runStateLabel } from '@/release/domain/summaries.ts';
import { packageDisplayName } from '@/server/package-name.ts';
import { executionTone, releaseStatus, shownReason } from '@/server/views/tone.ts';

export function waitingUntil(run: Execution, now: number): string | undefined {
	return run.notBefore !== undefined && run.notBefore > now && ['pending', 'ready'].includes(run.state)
		? formatTime(run.notBefore)
		: undefined;
}

export function progress(run: Execution, now: number): string {
	const until = waitingUntil(run, now);
	return until ? `waiting until ${until}` : runStateLabel(run);
}

function publicationName(run: Execution, publication: Execution['publications'][number]): string {
	if (!publication.id.startsWith('refs:')) return packageDisplayName(publication);
	const parsed = safeDecode(semVer, publication.version);
	return `tag ${parsed.success ? tagFor(run.workflow?.refs ?? defaultTagPolicy, parsed.data) : publication.version}`;
}

function publicationHref(
	run: Execution,
	publication: Pick<Publication, 'manager' | 'name' | 'version'>,
	published: boolean,
): string | undefined {
	const destination = managerSpec(publication.manager).destinations?.primary;
	if (!destination) return undefined;
	const version = published
		? publication.manager === 'goreleaser' ? `v${publication.version.replace(/^v/, '')}` : publication.version
		: undefined;
	return registryHref(destination, publication.name, version, run.repository);
}

function releaseLink(run: Execution): { tag: string; href: string } | undefined {
	if (run.state !== 'succeeded') return undefined;
	const parsed = safeDecode(semVer, run.version);
	const tag = run.release?.tag
		?? run.publications.find(publication =>
			publication.manager === 'github-release' && publication.outcome === 'succeeded'
		)?.version
		?? (parsed.success && (run.workflow?.refs || run.operation === 'promote')
			? tagFor(run.workflow?.refs ?? defaultTagPolicy, parsed.data)
			: undefined);
	return tag ? { tag, href: githubHref(run.repository, 'releases', 'tag', tag) } : undefined;
}

export function runCard(run: Execution, now: number) {
	const required = run.releaseSet?.required ?? run.configuration.streams[run.stream]?.required ?? [];
	const approving = run.state === 'awaiting-approval';
	const automatic = publishesAutomatically(run);
	const missing = required.filter(id =>
		!run.publications.some(p => matchesPublication(id, p) && p.outcome === 'succeeded')
	);
	const preparation = run.managed?.result ?? run.prepared?.result;
	const reason = shownReason(run.reason);
	const origin = run.started
		? [`Started from ${startLabels[run.started.via]}.`]
		: run.approvedBy === 'merge'
		? ['You merged the preparation PR.']
		: [];
	return {
		name: [run.repository, run.stream, run.operation, run.version].filter(Boolean).join(' '),
		until: waitingUntil(run, now),
		approving,
		automatic,
		missing: !approving && run.state !== 'verifying' && run.operation !== 'prepare' && run.state !== 'cancelled'
			? missing
			: [],
		reason,
		wait: automatic
			? { fact: reason ?? runStateLabel(run), detail: [...origin, `${checksPolicy}.`].join(' ') }
			: undefined,
		workflowCommit: run.workflowSha
			? undefined
			: run.eventId.startsWith('observed:')
			? 'Started on GitHub'
			: 'Not dispatched yet',
		preparationUrl: preparation?.url.startsWith('https://github.com/') ? preparation.url : undefined,
		autoMerge: preparation?.autoMerge?.state === 'refused'
			? preparation.autoMerge.note
			: preparation?.autoMerge
			? versionPrMergeSentences[preparation.autoMerge.method].replaceAll('`', '')
			: undefined,
		publications: run.publications.map(publication => ({
			...publication,
			label: publicationName(run, publication),
			href: publicationHref(run, publication, publication.outcome === 'succeeded'),
		})),
		release: releaseLink(run),
		retryable: Boolean(run.workflow) && retiredStates.includes(run.state)
			&& !(run.operation === 'prepare' && !run.plan && !run.managed),
		checksStop: run.operation === 'promote' && stoppedByGates(run.reason)
			&& (run.state === 'awaiting-approval'
				|| (run.state === 'failed' && run.attempts === 0 && run.approvedAt === undefined)),
		rerunnable: rerunnable(run.reason),
		reconcilable: run.state === 'uncertain',
		cancellable: !settledStates.includes(run.state),
	};
}

type Release = ReturnType<typeof releaseSummaries>[number];

const urgency: readonly Tone[] = ['error', 'warn', 'active', 'waiting', 'ok', 'neutral'];
const working: readonly Execution['state'][] = ['ready', 'dispatching', 'running', 'verifying'];
const inFlight: readonly Execution['state'][] = ['pending', 'ready', 'dispatching', 'running', 'verifying'];

/** One release as a row of stages, like a workflow run and its jobs. */
export function pipeline(release: Release, now: number) {
	if (release.version === undefined) return undefined;
	const operations = pipelineStages(release.latest, release.runs);
	const newest: Execution[] = [];
	const stages = operations.map(operation => {
		const targets = new Map<string, Execution[]>();
		for (const run of release.runs.filter(entry => entry.operation === operation).sort(byAge)) {
			const target = run.package?.id ?? '';
			targets.set(target, [...targets.get(target) ?? [], run]);
		}
		const current = [...targets.values()].flatMap(runs =>
			runs.filter((entry, index) =>
				index === runs.length - 1 || release.needing.includes(entry.id) || inFlight.includes(entry.state)
			)
		);
		newest.push(...current);
		const run =
			[...current].sort((x, y) => urgency.indexOf(executionTone[x.state]) - urgency.indexOf(executionTone[y.state]))[0];
		const tone: Tone = run ? executionTone[run.state] : 'neutral';
		const attempts = Math.max(
			0,
			...[...targets.values()].map(runs =>
				runs.reduce((count, entry) => count + (entry.runId === undefined ? 0 : entry.runAttempt ?? 1), 0)
			),
		);
		const done = [...targets.values()].filter(runs => runs.at(-1)?.state === 'succeeded').length;
		return {
			operation,
			run,
			tone,
			note: [
				run ? progress(run, now) : 'not run',
				...(run?.state === 'succeeded' && run.reason === runFailedNote ? ['workflow run failed'] : []),
				...(targets.size > 1 ? [`${done} of ${targets.size} packages succeeded`] : []),
				...(attempts > 1 ? [`attempt ${attempts}`] : []),
			].join(', '),
			runHref: run?.runId
				? githubHref(run.repository, 'actions', 'runs', String(run.runId))
				: undefined,
			runs: [...targets.values()].flatMap(runs =>
				[...runs].reverse().map((entry, index) => ({
					run: entry,
					earlier: index > 0,
					open: release.needing.includes(entry.id) || inFlight.includes(entry.state),
				}))
			),
		};
	});
	const reported = release.runs.flatMap(run => run.publications.map(publication => ({ run, publication })));
	const shown = (run: Execution, publication: Publication, outcome: Publication['outcome'] | 'waiting') => ({
		label: publicationName(run, publication),
		href: publicationHref(run, publication, outcome === 'succeeded'),
		version: publication.version,
		outcome,
	});
	const required = release.publications.map(({ id, outcome }) => {
		const reports = reported.filter(entry => matchesPublication(id, entry.publication));
		const report = reports.find(entry => entry.publication.outcome === 'succeeded') ?? reports.at(-1);
		return {
			required: true,
			...(report
				? shown(report.run, report.publication, outcome)
				: { label: packageLabel(id), href: undefined, version: release.version, outcome }),
		};
	});
	const requiredIds = release.publications.map(publication => publication.id);
	const extra = new Map<string, (typeof reported)[number]>();
	for (const entry of reported) {
		if (requiredIds.some(id => matchesPublication(id, entry.publication))) continue;
		const key = JSON.stringify([entry.publication.id, entry.publication.version]);
		if (extra.get(key)?.publication.outcome !== 'succeeded') extra.set(key, entry);
	}
	const overall = releaseStatus(release);
	const status: Status = overall.tone === 'warn'
		? overall
		: newest.some(run => working.includes(run.state))
		? { tone: 'active', label: 'In progress' }
		: newest.some(run => run.state === 'pending')
		? { tone: 'waiting', label: 'Waiting to start' }
		: overall;
	return {
		status,
		open: status.tone === 'warn' || status.tone === 'active' || status.tone === 'waiting',
		stages,
		publications: [
			...required,
			...[...extra.values()].map(entry => ({
				required: entry.publication.required,
				...shown(entry.run, entry.publication, entry.publication.outcome),
			})),
		],
	};
}
