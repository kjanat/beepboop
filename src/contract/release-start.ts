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
		'Where a release of this stream can start. A start approves the whole release: the version bump, publication, binaries, tags and the GitHub release run without another approval.',
});
export const versionBumps = ['commit', 'pr'] as const;
export type VersionBump = typeof versionBumps[number];
export const versionBump = z.enum(versionBumps).meta({
	id: 'versionBump',
	description:
		'How Beepboop applies a version bump: commit pushes a signed bot commit to the default branch, pr opens a version PR.',
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
export const startChoiceLabels: Record<StartChannel, string> = {
	action: `the Start release workflow in GitHub Actions (${startWorkflowFile})`,
	dashboard: 'the Release button in the Beepboop dashboard',
	cli: '`beepboop release`',
};
export const bumpChoiceLabels: Record<VersionBump, string> = {
	commit: 'Beepboop pushes a signed commit to the default branch',
	pr: 'Beepboop opens a version PR, and merging it continues the release',
};
export const approvalPolicies = ['required', 'merge', 'push'] as const;
export type ApprovalPolicy = typeof approvalPolicies[number];
export const approvalChoiceLabels: Record<ApprovalPolicy, string> = {
	required: 'After you approve it in Beepboop',
	merge: 'When its version PR merges',
	push: 'When a signed commit with passing checks raises it, without approval',
};
