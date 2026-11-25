import { selectorKey } from '@/domain/package-identity.ts';
import { aliasSeries, defaultTagPolicy, isPrerelease, semVer, tagFor } from '@/domain/version.ts';
import { decodeSync, safeDecode } from '@/kernel/schema/structs.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

export interface ReleaseTarget {
	readonly tag: string;
	readonly prerelease: boolean;
}

export function githubRelease(execution: Pick<Execution, 'workflow' | 'version'>): ReleaseTarget | undefined {
	if (!execution.version) return undefined;
	const version = decodeSync(semVer, execution.version);
	return { tag: tagFor(execution.workflow?.refs ?? defaultTagPolicy, version), prerelease: isPrerelease(version) };
}

export function publishesGithubRelease(execution: Execution): boolean {
	const key = selectorKey(`github-release:${execution.repository}`);
	return execution.workflow?.publications?.some(id => selectorKey(id) === key) ?? false;
}

export function executionTags(
	version: string | undefined,
	policy: NonNullable<Execution['workflow']>['refs'],
	recordedTag?: string,
) {
	const parsed = safeDecode(semVer, version);
	if (!parsed.success) return { releaseTag: recordedTag };
	const tag = tagFor(policy ?? defaultTagPolicy, parsed.data);
	const releaseTag = recordedTag ?? tag;
	if (policy?.phase === 'version') return { releaseTag, refTag: tag };
	const alias = policy?.aliases[0];
	if (alias && policy?.aliases.length === 1 && !isPrerelease(parsed.data)) {
		return { releaseTag, refTag: policy.prefix + aliasSeries(parsed.data, alias) };
	}
	return { releaseTag };
}
