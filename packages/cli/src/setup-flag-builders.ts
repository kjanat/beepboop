import type { FlagBuilder, FlagConfig } from '@kjanat/dreamcli';
import { flag } from '@kjanat/dreamcli';
import { binaryCandidates, packageCandidates } from '@/cli/setup-complete';
import type { SetupFlagPath } from '@/cli/setup-flags';
import { setupFlagPaths } from '@/cli/setup-flags';
import { streamVersionings } from '@/contract/setup';
import { binaryTargets } from '@/domain/binary-platforms.ts';
import { approvalPolicies, configurableStarts, versionBumps } from '@/domain/release-start.ts';
import {
	companionModulesSentence,
	existingTriggerChoices,
	existingTriggersQuestion,
	mustPublishSentence,
	publishWhenQuestion,
	publishWhens,
	startFromQuestion,
	versionLandings,
	versionLandsQuestion,
	versionPrMergeQuestion,
	versionPrMerges,
	versionScopeQuestion,
	versionScopes,
} from '@/domain/setup-terms.ts';
import { workflowTriggers } from '@/domain/workflow-setup.ts';

export const describedSetupFlags = {
	stream: flag.string().describe('Release group the setup flags change; needed when the proposal has several'),
	package: flag.array(flag.string()).complete(packageCandidates).describe(
		'Package to release, by name or package URL; repeat it',
	),
	'must-publish': flag.array(flag.string()).complete(packageCandidates).describe(
		`${mustPublishSentence.slice(0, -1)}; repeat it; defaults to --package`,
	),
	'version-scope': flag.enum(versionScopes).describe(versionScopeQuestion),
	'start-from': flag.array(flag.enum(configurableStarts)).describe(startFromQuestion),
	'version-lands': flag.enum(versionLandings).describe(versionLandsQuestion),
	'publish-when': flag.enum(publishWhens).describe(publishWhenQuestion),
	'version-pr-merge': flag.enum(versionPrMerges).describe(versionPrMergeQuestion),
	required: flag.array(flag.string()).deprecated('Use --must-publish'),
	versioning: flag.enum(streamVersionings).deprecated('Use --version-scope'),
	start: flag.array(flag.enum(configurableStarts)).deprecated('Use --start-from'),
	bump: flag.enum(versionBumps).deprecated('Use --version-lands'),
	approval: flag.enum(approvalPolicies).deprecated('Use --publish-when'),
	'version-source': flag.string().describe('Advanced: versionSource as JSON'),
	'version-files': flag.string().describe('Advanced: versionFiles as JSON'),
	'companion-module': flag.array(flag.string()).describe(`${companionModulesSentence.slice(0, -1)}; repeat it`),
	observe: flag.string().describe('Advanced: observed workflows as JSON'),
	needs: flag.string().describe('Advanced: package dependencies as JSON'),
	operations: flag.string().describe('Advanced: extra operations as JSON'),
	'prepare-file': flag.string().describe('Preparation workflow file'),
	'prepare-job': flag.string().describe('Job in the preparation workflow'),
	'prepare-existing-triggers': flag.enum(existingTriggerChoices).describe(
		`Preparation workflow: ${existingTriggersQuestion}`,
	),
	'prepare-triggers': flag.enum(workflowTriggers).deprecated('Use --prepare-existing-triggers'),
	'prepare-commands': flag.string().describe('Bash commands of the preparation job'),
	'prepare-publication-steps': flag.string().describe('Advanced: preparation publicationSteps as JSON'),
	'prepare-credentials': flag.string().describe('Advanced: preparation credentials as JSON'),
	'prepare-tag-prefix': flag.string().describe('Version tag prefix of the preparation workflow'),
	'prepare-binaries': flag.string().describe('Advanced: preparation binaries as JSON'),
	'promote-file': flag.string().describe('Publishing workflow file'),
	'promote-job': flag.string().describe('Job in the publishing workflow'),
	'promote-existing-triggers': flag.enum(existingTriggerChoices).describe(
		`Publishing workflow: ${existingTriggersQuestion}`,
	),
	'promote-triggers': flag.enum(workflowTriggers).deprecated('Use --promote-existing-triggers'),
	'promote-commands': flag.string().describe('Bash commands of the publishing job'),
	'promote-publication-steps': flag.string().describe('Advanced: publicationSteps as JSON'),
	'promote-credentials': flag.string().describe('Advanced: publishing credentials as JSON'),
	'promote-tag-prefix': flag.string().describe('Version tag prefix of the publishing workflow'),
	binary: flag.array(flag.string()).complete(binaryCandidates).describe(
		'Binary to build for the GitHub release; repeat it',
	),
	target: flag.array(flag.enum(binaryTargets)).describe('Binary target to build; repeat it'),
	'actions-revision': flag.string().describe('Advanced: Actions version tag or full commit'),
};

export function setupFlagRecord(
	paths: readonly SetupFlagPath[] = setupFlagPaths,
	described: Readonly<Record<string, FlagBuilder<FlagConfig>>> = describedSetupFlags,
): Record<string, FlagBuilder<FlagConfig>> {
	const derived = paths.flatMap(({ path, kind, names }) =>
		names.filter(name => !Object.hasOwn(described, name)).map((name): [string, FlagBuilder<FlagConfig>] => [
			name,
			kind === 'list' || kind === 'packages' || kind === 'binaries'
				? flag.array(flag.string()).describe(`${path}; repeat it`)
				: flag.string().describe(kind === 'json' ? `Advanced: ${path} as JSON` : path),
		])
	);
	return { ...Object.fromEntries(derived), ...described };
}
