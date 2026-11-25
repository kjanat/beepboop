import { Result } from 'effect';
import { isManagerName, type ManagerName, managerSpec } from '@/domain/catalog.ts';
import { matchesPublication, parseReleaseIdentity, selectorKey } from '@/domain/package-identity.ts';
import { type PackageIdentity, purlDefinitions } from '@/domain/purl/index.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { defaultTagPolicy, isPrerelease, semVer, tagFor } from '@/domain/version.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';
import { githubHref, publicationRegistryHref } from '@/publication/links.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { identityPublicationName, legacyPublicationName } from '@/release/domain/reference-probe.ts';

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

function publicationName(id: string, identity?: PackageIdentity) {
	if (!identity) return legacyPublicationName(id);
	if (identity.type === 'generic' && identity.namespace && isManagerName(identity.namespace)) {
		return { manager: identity.namespace, name: identity.name };
	}
	return identityPublicationName(identity);
}

function destinationFor(manager: ManagerName, identity?: PackageIdentity) {
	const primary = manager === 'manifest' ? 'manifest' : managerSpec(manager).destinations?.primary;
	const registry = identity?.qualifiers?.repository_url?.replace(/\/$/, '');
	if (!identity || !registry) return primary;
	if (manager === 'vscode' && registry === 'https://open-vsx.org') return 'open-vsx';
	const registered = purlDefinitions.get(identity.type)?.repository.default_repository_url;
	if (registry === registered?.replace(/\/$/, '')) return primary;
}

function executionReleaseTag(run: TargetExecution): string | undefined {
	const recorded = run.release?.tag ?? run.draftRelease?.tag;
	if (recorded !== undefined) return recorded;
	const version = safeDecode(semVer, run.version);
	if (version.success) return tagFor(run.workflow?.refs ?? defaultTagPolicy, version.data);
}

function githubReleaseHref(run: TargetExecution, repository: string, tag?: string): string | undefined {
	if (!repositoryNamePattern.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) {
		return undefined;
	}
	if (tag === undefined && repository.toLowerCase() === run.repository.toLowerCase()) tag = executionReleaseTag(run);
	return tag ? githubHref(repository, 'releases', 'tag', tag) : undefined;
}

function targetUrl(run: TargetExecution, id: string): string | undefined {
	const parsed = id.startsWith('pkg:') ? parseReleaseIdentity(id) : undefined;
	if (parsed && Result.isFailure(parsed)) return undefined;
	const identity = parsed?.success;
	const reported = run.publications.find(publication => matchesPublication(id, publication));
	const target = reported ?? publicationName(id, identity);
	const pinnedVersion = identity?.version ?? reported?.version;
	const version = pinnedVersion ?? run.version;
	if (!target || !version) return undefined;

	const { manager, name } = target;
	const destination = destinationFor(manager, identity);
	if (!destination) return undefined;
	if (destination === 'manifest') return manifestHref(name);
	if (manager === 'github-release') return githubReleaseHref(run, name, pinnedVersion);
	const registryVersion = manager === 'goreleaser' ? `v${version.replace(/^v/, '')}` : version;
	return publicationRegistryHref(destination, name, registryVersion, run.repository);
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
