import { z } from 'zod';
import { workflowFilePattern } from '@/contract/catalog';

export const startChannels = ['action', 'dashboard', 'cli'] as const;
export type StartChannel = typeof startChannels[number];
export const startChannel = z.enum(startChannels);
export const releaseStart = z.discriminatedUnion('via', [
	z.strictObject({ via: z.literal('action'), workflow: z.string().regex(workflowFilePattern) }),
	z.strictObject({ via: z.literal('dashboard') }),
	z.strictObject({ via: z.literal('cli') }),
]);
export type ReleaseStart = z.output<typeof releaseStart>;
export const releaseStarts = z.array(releaseStart).refine(
	starts => new Set(starts.map(start => start.via)).size === starts.length,
	'List each start channel once',
).meta({
	id: 'releaseStarts',
	description:
		'Where a release of this stream starts. Starting a release also publishes it: the version bump, publication, binaries, tags and the GitHub release run, and nothing asks again.',
});
export const versionBumps = ['commit', 'pr'] as const;
export type VersionBump = typeof versionBumps[number];
export const versionBump = z.enum(versionBumps).meta({
	id: 'versionBump',
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
