import { runFailedNote } from '@/automation/execution.ts';
import { matchesPublication } from '@/automation/package-identity.ts';
import type { Execution, Publication } from '@/automation/types.ts';
import { managerSpec } from '@/contract/catalog';
import { githubHref, registryHref } from '@/contract/links';
import { versionPrMergeSentences } from '@/contract/setup-terms';
import { formatTime } from '@/contract/time';
import { defaultTagPolicy, semVer, tagFor } from '@/contract/version';
import type { Status, Tone } from '@/contract/views';
import { packageLabel } from '@/domain/package-label';
import { packageDisplayName } from '@/server/package-name.ts';
import type { releaseSummaries } from '@/server/releases.ts';
import { byAge, publishesAutomatically, runStateLabel } from '@/server/releases.ts';
import { executionTone, releaseStatus } from '@/server/views/tone.ts';

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
	const parsed = semVer.safeParse(publication.version);
	return `tag ${parsed.success ? tagFor(run.workflow?.refs ?? defaultTagPolicy, parsed.data) : publication.version}`;
}

function publicationHref(
	run: Execution,
	publication: Pick<Publication, 'manager' | 'name' | 'version'>,
	published: boolean,
): string | undefined {
	const destination = managerSpec(publication.manager).destinations?.primary;
	if (!destination) return undefined;
	return registryHref(destination, publication.name, published ? publication.version : undefined, run.repository);
}

function releaseLink(run: Execution): { tag: string; href: string } | undefined {
	if (run.state !== 'succeeded') return undefined;
	const parsed = semVer.safeParse(run.version);
	const tag = run.release?.tag
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
	return {
		name: [run.repository, run.stream, run.operation, run.version].filter(Boolean).join(' '),
		until: waitingUntil(run, now),
		approving,
		automatic,
		missing: !approving && run.state !== 'verifying' && run.operation !== 'prepare' && run.state !== 'cancelled'
			? missing
			: [],
		reason: run.reason?.replace(/\b[0-9a-f]{32,64}\b/g, id => id.slice(0, 12)),
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
		retryable: Boolean(run.workflow) && ['failed', 'cancelled'].includes(run.state)
			&& !(run.operation === 'prepare' && !run.plan && !run.managed),
		reconcilable: run.state === 'uncertain',
		cancellable: !['succeeded', 'cancelled', 'failed'].includes(run.state),
	};
}

type Release = ReturnType<typeof releaseSummaries>[number];

function configuredStages(run: Execution): Map<string, string[]> {
	const stream = run.configuration.streams[run.stream];
	if (!stream) return new Map();
	const needs = new Map<string, string[]>([
		['prepare', stream.prepare.workflow?.needs ?? []],
		['promote', [...stream.promote.workflow?.needs ?? [], 'prepare']],
		...Object.entries(stream.workflows).map(([name, binding]): [string, string[]] => [name, binding.needs ?? []]),
	]);
	const ordered = new Map<string, string[]>();
	while (ordered.size < needs.size) {
		const waiting = [...needs].filter(([name]) => !ordered.has(name));
		const ready = waiting.filter(([, wanted]) => wanted.every(need => ordered.has(need) || !needs.has(need)));
		for (const [name, wanted] of ready.length ? ready : waiting) ordered.set(name, wanted);
	}
	return ordered;
}

function follows(stage: string, started: ReadonlySet<string>, needs: ReadonlyMap<string, string[]>): boolean {
	const seen = new Set<string>();
	const reaches = (name: string): boolean => {
		if (seen.has(name)) return false;
		seen.add(name);
		return (needs.get(name) ?? []).some(need => started.has(need) || reaches(need));
	};
	return reaches(stage);
}

const urgency: readonly Tone[] = ['error', 'warn', 'active', 'waiting', 'ok', 'neutral'];
const needsLook: readonly Execution['state'][] = ['awaiting-approval', 'blocked', 'failed', 'cancelled', 'uncertain'];
const working: readonly Execution['state'][] = ['ready', 'dispatching', 'running', 'verifying'];
const inFlight: readonly Execution['state'][] = ['pending', 'ready', 'dispatching', 'running', 'verifying'];

/** One release as a row of stages, like a workflow run and its jobs. */
export function pipeline(release: Release, now: number) {
	if (release.version === undefined) return undefined;
	const needs = configuredStages(release.latest);
	const started = new Set(release.runs.map(run => run.operation));
	const operations = [
		...[...needs.keys()].filter(name => started.has(name) || follows(name, started, needs)),
		...[...started].filter(name => !needs.has(name)),
	];
	const newest: Execution[] = [];
	const stages = operations.map(operation => {
		const targets = new Map<string, Execution[]>();
		for (const run of release.runs.filter(entry => entry.operation === operation).sort(byAge)) {
			const target = run.package?.id ?? '';
			targets.set(target, [...targets.get(target) ?? [], run]);
		}
		const current = [...targets.values()].flatMap(runs => runs.slice(-1));
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
		const done = current.filter(entry => entry.state === 'succeeded').length;
		return {
			operation,
			run,
			tone,
			note: [
				run ? progress(run, now) : 'not run',
				...(run?.state === 'succeeded' && run.reason === runFailedNote ? ['workflow run failed'] : []),
				...(current.length > 1 ? [`${done} of ${current.length} packages succeeded`] : []),
				...(attempts > 1 ? [`attempt ${attempts}`] : []),
			].join(', '),
			runHref: run?.runId
				? githubHref(run.repository, 'actions', 'runs', String(run.runId))
				: undefined,
			runs: [...targets.values()].flatMap(runs =>
				[...runs].reverse().map((entry, index) => ({
					run: entry,
					earlier: index > 0,
					open: index === 0 && (needsLook.includes(entry.state) || inFlight.includes(entry.state)),
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
