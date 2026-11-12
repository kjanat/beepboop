import { Schema } from 'effect';
import { workflowFilePattern } from '@/contract/catalog';
import type { Decoded } from '@/schema';
import { matchesPattern, mutableArray, refined, strictStruct } from '@/schema';

export const startChannels = ['action', 'dashboard', 'cli'] as const;
export type StartChannel = typeof startChannels[number];
export const startChannel = Schema.Literals(startChannels);
export const releaseStart = Schema.Union([
	strictStruct({ via: Schema.Literal('action'), workflow: Schema.String.check(matchesPattern(workflowFilePattern)) }),
	strictStruct({ via: Schema.Literal('dashboard') }),
	strictStruct({ via: Schema.Literal('cli') }),
]);
export type ReleaseStart = Decoded<typeof releaseStart>;
export const releaseStarts = refined(
	mutableArray(releaseStart),
	starts => new Set(starts.map(start => start.via)).size === starts.length,
	'List each start channel once',
).annotate({
	identifier: 'releaseStarts',
	description:
		'Where a release of this stream starts. Starting a release also publishes it: the version bump, publication, binaries, tags and the GitHub release run, and nothing asks again.',
});
export const versionBumps = ['commit', 'pr'] as const;
export type VersionBump = typeof versionBumps[number];
export const versionBump = Schema.Literals(versionBumps).annotate({
	identifier: 'versionBump',
	description:
		'Earlier name of versionLands: commit pushes a signed bot commit to the default branch, pr opens a version PR.',
});
export const startWorkflowFile = 'start-release.yml';

export function startsFrom(starts: readonly ReleaseStart[] | undefined, via: StartChannel): ReleaseStart | undefined {
	return starts?.find(start => start.via === via);
}
export const startLabels: Record<StartChannel, string> = {
	action: 'GitHub Actions',
	dashboard: 'the dashboard',
	cli: 'the CLI',
};
export const approvalPolicies = ['required', 'merge', 'push'] as const;
export type ApprovalPolicy = typeof approvalPolicies[number];
