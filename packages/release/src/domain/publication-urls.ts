import { selectorKey } from '@/domain/package-identity.ts';
import { githubHref } from '@/publication/links.ts';
import { publicationTargetHref } from '@/publication/target-href.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { executionTags } from '@/release/domain/github-release.ts';
import { resolvePublicationTarget } from '@/release/domain/reference-probe.ts';

type TargetExecution = Pick<
	Execution,
	| 'repository'
	| 'version'
	| 'operation'
	| 'stream'
	| 'configuration'
	| 'publications'
	| 'workflow'
	| 'package'
	| 'release'
	| 'draftRelease'
	| 'moduleTags'
>;

function selectedPublicationIds(run: TargetExecution, refId: string): Set<string> {
	const declared = run.workflow?.publications;
	const binding = run.package;
	if (binding) return new Set([declared?.find(id => selectorKey(id) === binding.id) ?? binding.id]);
	if (declared) return new Set(declared);
	if (run.operation === 'publish') return new Set(run.configuration.streams[run.stream]?.packages);
	return new Set(run.publications.map(publication => publication.id).filter(id => id !== refId));
}

/** Link the execution’s selected publications, using recorded publication versions when available. */
export function plannedPublicationUrls(run: TargetExecution): {
	publicationUrls: Record<string, string>;
	publicationUrl?: string;
} {
	const refId = `refs:${run.operation}`;
	const selected = selectedPublicationIds(run, refId);
	const targets = new Set(selected);
	targets.delete(refId);
	const policy = run.workflow?.refs;
	if (policy?.phase === 'version') {
		for (const { id } of run.moduleTags ?? []) targets.add(id);
	}

	const { refTag, releaseTag } = executionTags(run.version, policy, run.release?.tag ?? run.draftRelease?.tag);
	const urls = new Map<string, string>();
	if (refTag) urls.set(refId, githubHref(run.repository, 'tree', refTag));
	for (const id of targets) {
		const target = resolvePublicationTarget(id, run.publications, run.version);
		const url = target && publicationTargetHref(target, run.repository, releaseTag);
		if (url) urls.set(id, url);
	}
	const [primary = refId] = selected;
	const publicationUrl = selected.size <= 1 ? urls.get(primary) : undefined;
	return { publicationUrls: Object.fromEntries(urls), ...(publicationUrl ? { publicationUrl } : {}) };
}
