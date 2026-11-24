import { selectorKey } from '@/domain/package-identity.ts';
import { defaultTagPolicy, isPrerelease, semVer, tagFor } from '@/domain/version.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';
import type { Execution } from '@/release/domain/execution/types.ts';

export interface ReleaseTarget {
	readonly tag: string;
	readonly prerelease: boolean;
}

export function githubRelease(execution: Execution): ReleaseTarget | undefined {
	if (!execution.version) return undefined;
	const version = decodeSync(semVer, execution.version);
	return { tag: tagFor(execution.workflow?.refs ?? defaultTagPolicy, version), prerelease: isPrerelease(version) };
}

export function publishesGithubRelease(execution: Execution): boolean {
	const key = selectorKey(`github-release:${execution.repository}`);
	return execution.workflow?.publications?.some(id => selectorKey(id) === key) ?? false;
}
