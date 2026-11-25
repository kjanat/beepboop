import { Result } from 'effect';
import { isManagerName, managerSpec } from '@/domain/catalog.ts';
import { matchesPublication, parseReleaseIdentity, selectorKey } from '@/domain/package-identity.ts';
import { purlDefinitions } from '@/domain/purl/index.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { isPrerelease, semVer, tagFor } from '@/domain/version.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';
import { githubHref, publicationRegistryHref } from '@/publication/links.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { githubRelease } from '@/release/domain/github-release.ts';
import { referenceProbe } from '@/release/domain/reference-probe.ts';

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
	| 'releaseSet'
	| 'release'
	| 'draftRelease'
	| 'moduleTags'
>;

function manifestHref(name: string): string | undefined {
	const [owner, repo, ...parts] = name.split('/');
	const repository = `${owner}/${repo}`;
	if (!owner || !repo || !repositoryNamePattern.test(repository) || !/\.(?:json|rb)$/.test(name)) return undefined;
	if ([owner, repo, ...parts].some(part => !part || part === '.' || part === '..')) return undefined;
	return parts.length ? githubHref(repository, 'blob', 'HEAD', ...parts) : undefined;
}

function targetUrl(run: TargetExecution, id: string): string | undefined {
	const parsed = id.startsWith('pkg:') ? parseReleaseIdentity(id) : undefined;
	if (parsed && Result.isFailure(parsed)) return undefined;
	const identity = parsed?.success;
	const reported = run.publications.find(publication => matchesPublication(id, publication));
	const version = identity?.version ?? reported?.version ?? run.version;
	if (!version) return undefined;
	const probe = identity?.type === 'generic' && identity.namespace && isManagerName(identity.namespace)
		? { manager: identity.namespace, name: identity.name }
		: referenceProbe(id, version);
	const publication = reported ?? probe;
	if (!publication) return undefined;
	const { manager, name } = publication;
	const registry = identity?.qualifiers?.repository_url?.replace(/\/$/, '');
	const openVsx = manager === 'vscode' && registry === 'https://open-vsx.org';
	if (registry && !openVsx) {
		const defaultRegistry = identity && purlDefinitions.get(identity.type)?.repository.default_repository_url;
		if (registry !== defaultRegistry?.replace(/\/$/, '')) return undefined;
	}
	if (manager === 'manifest') return manifestHref(name);
	const destination = openVsx ? 'open-vsx' : managerSpec(manager).destinations?.primary;
	if (!destination) return undefined;
	if (manager === 'github-release') {
		if (!repositoryNamePattern.test(name) || name.split('/').some(part => part === '.' || part === '..')) {
			return undefined;
		}
		const local = name.toLowerCase() === run.repository.toLowerCase();
		const tag = identity?.version ?? reported?.version ?? (local
			? run.release?.tag ?? run.draftRelease?.tag
				?? (safeDecode(semVer, run.version).success ? githubRelease(run)?.tag : undefined)
			: undefined);
		return tag ? githubHref(name, 'releases', 'tag', tag) : undefined;
	}
	return publicationRegistryHref(
		destination,
		name,
		manager === 'goreleaser' ? `v${version.replace(/^v/, '')}` : version,
		run.repository,
	);
}

function refUrl(run: TargetExecution): string | undefined {
	const policy = run.workflow?.refs;
	const version = safeDecode(semVer, run.version);
	if (!policy || !version.success) return undefined;
	if (policy.phase === 'version') return githubHref(run.repository, 'tree', tagFor(policy, version.data));
	if (policy.aliases.length !== 1 || isPrerelease(version.data)) return undefined;
	const [major, minor] = version.data.split('.');
	const tag = policy.prefix + (policy.aliases[0] === 'major' ? major : `${major}.${minor}`);
	return githubHref(run.repository, 'tree', tag);
}

/** Resolve the frozen operation's destinations before the workflow publishes anything. */
export function plannedPublicationUrls(run: TargetExecution): {
	publicationUrls: Record<string, string>;
	publicationUrl?: string;
} {
	const refId = `refs:${run.operation}`;
	const declared = run.workflow?.publications;
	const scoped = run.package ? [declared?.find(id => selectorKey(id) === run.package?.id) ?? run.package.id] : declared;
	const configured = scoped
		?? (run.operation === 'publish'
			? run.releaseSet?.required ?? run.configuration.streams[run.stream]?.required
			: undefined);
	const selected = new Set(
		configured ?? run.publications.map(publication => publication.id).filter(id => id !== refId),
	);
	const urls = new Map<string, string>();
	const urlFor = (id: string) => {
		if (id === refId) return refUrl(run);
		return targetUrl(run, id);
	};
	for (const id of selected) {
		const url = urlFor(id);
		if (url) urls.set(id, url);
	}
	const tag = refUrl(run);
	if (tag) urls.set(refId, tag);
	for (const { id } of run.workflow?.refs?.phase === 'version' ? run.moduleTags ?? [] : []) {
		const url = urlFor(id);
		if (url) urls.set(id, url);
	}
	const [first] = selected;
	const publicationUrl = selected.size === 1 && first ? urls.get(first) : selected.size === 0 ? tag : undefined;
	return { publicationUrls: Object.fromEntries(urls), ...(publicationUrl ? { publicationUrl } : {}) };
}
