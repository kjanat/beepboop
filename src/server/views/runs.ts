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
		?? (parsed.success ? tagFor(run.workflow?.refs ?? defaultTagPolicy, parsed.data) : undefined);
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

function configuredStages(run: Execution): string[] {
	const stream = run.configuration.streams[run.stream];
	if (!stream) return [];
	const placed = [...(stream.prepare ? ['prepare'] : []), 'promote'];
	const waiting = new Map(Object.entries(stream.workflows));
	while (waiting.size) {
		const ready = [...waiting].filter(([, binding]) =>
			(binding.needs ?? []).every(need => placed.includes(need) || !waiting.has(need))
		);
		for (const [name] of ready.length ? ready : waiting) {
			placed.push(name);
			waiting.delete(name);
		}
	}
	return placed;
}

const needsLook: readonly Execution['state'][] = ['awaiting-approval', 'blocked', 'failed', 'uncertain'];
const inFlight: readonly Execution['state'][] = ['pending', 'ready', 'dispatching', 'running', 'verifying'];

/** One release as a row of stages, like a workflow run and its jobs. */
export function pipeline(release: Release, now: number) {
	if (release.version === undefined) return undefined;
	const operations = [
		...new Set([...configuredStages(release.latest), ...release.runs.map(run => run.operation)]),
	];
	const stages = operations.map(operation => {
		const runs = release.runs.filter(run => run.operation === operation).sort(byAge);
		const run = runs.at(-1);
		const tone: Tone = run ? executionTone[run.state] : 'neutral';
		const attempts = runs.reduce((count, entry) => count + (entry.runAttempt ?? 1), 0);
		return {
			operation,
			run,
			tone,
			note: [
				run ? progress(run, now) : 'not run',
				...(attempts > 1 ? [`attempt ${attempts}`] : []),
			].join(', '),
			runHref: run?.runId
				? githubHref(run.repository, 'actions', 'runs', String(run.runId))
				: undefined,
			runs: [...runs].reverse().map((entry, index) => ({
				run: entry,
				earlier: index > 0,
				open: index === 0 && (needsLook.includes(entry.state) || inFlight.includes(entry.state)),
			})),
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
		const current = extra.get(entry.publication.id);
		if (current?.publication.outcome !== 'succeeded') extra.set(entry.publication.id, entry);
	}
	const status: Status = releaseStatus(release);
	return {
		status,
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
