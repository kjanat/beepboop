import { matchesPublication } from '@/automation/package-identity.ts';
import type { Execution } from '@/automation/types.ts';
import { managerSpec } from '@/contract/catalog';
import { githubHref, registryHref } from '@/contract/links';
import { formatTime } from '@/contract/time';
import { defaultTagPolicy, semVer, tagFor } from '@/contract/version';
import { packageDisplayName } from '@/server/package-name.ts';

export function waitingUntil(run: Execution, now: number): string | undefined {
	return run.notBefore !== undefined && run.notBefore > now && ['pending', 'ready'].includes(run.state)
		? formatTime(run.notBefore)
		: undefined;
}

export function progress(run: Execution, now: number): string {
	const until = waitingUntil(run, now);
	return until ? `waiting until ${until}` : run.state;
}

function publicationName(run: Execution, publication: Execution['publications'][number]): string {
	if (!publication.id.startsWith('refs:')) return packageDisplayName(publication);
	const parsed = semVer.safeParse(publication.version);
	return `tag ${parsed.success ? tagFor(run.workflow?.refs ?? defaultTagPolicy, parsed.data) : publication.version}`;
}

function publicationHref(run: Execution, publication: Execution['publications'][number]): string | undefined {
	const destination = managerSpec(publication.manager).destinations?.primary;
	if (publication.outcome !== 'succeeded' || !destination) return undefined;
	return registryHref(destination, publication.name, publication.version, run.repository);
}

function releaseHref(run: Execution): string | undefined {
	if (run.state !== 'succeeded') return undefined;
	const parsed = semVer.safeParse(run.version);
	const tag = run.release?.tag
		?? (parsed.success ? tagFor(run.workflow?.refs ?? defaultTagPolicy, parsed.data) : undefined);
	return tag ? githubHref(run.repository, 'releases', 'tag', tag) : undefined;
}

export function runCard(run: Execution, now: number) {
	const required = run.releaseSet?.required ?? run.configuration.streams[run.stream]?.required ?? [];
	const approving = run.state === 'awaiting-approval';
	const automatic = approving
		&& (run.configuration.streams[run.stream]?.promote.approval === 'push' || run.approvedBy === 'merge');
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
		publications: run.publications.map(publication => ({
			...publication,
			label: publicationName(run, publication),
			href: publicationHref(run, publication),
		})),
		release: releaseHref(run),
		retryable: Boolean(run.workflow) && ['failed', 'cancelled'].includes(run.state)
			&& !(run.operation === 'prepare' && !run.plan && !run.managed),
		reconcilable: run.state === 'uncertain',
		cancellable: !['succeeded', 'cancelled', 'failed'].includes(run.state),
	};
}
