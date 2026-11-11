import { z } from 'zod';
import type { ApprovalPolicy, StartChannel, VersionBump } from '@/contract/release-start';
import { startWorkflowFile } from '@/contract/release-start';

type Versioning = 'workspace' | 'independent' | 'none';
type TriggerHandover = 'review' | 'dispatchOnly' | 'preserve';

export const publishWhens = ['approved-in-beepboop', 'version-pr-merged', 'version-commit-pushed'] as const;
export type PublishWhen = typeof publishWhens[number];
export const publishWhenNames = {
	required: 'approved-in-beepboop',
	merge: 'version-pr-merged',
	push: 'version-commit-pushed',
} as const satisfies Record<ApprovalPolicy, PublishWhen>;
export const approvalOfPublishWhen = {
	'approved-in-beepboop': 'required',
	'version-pr-merged': 'merge',
	'version-commit-pushed': 'push',
} as const satisfies Record<PublishWhen, ApprovalPolicy>;
export const publishWhenSentences: Record<ApprovalPolicy, string> = {
	required:
		'You publish it: the Publish button in Beepboop or `beepboop runs publish`. Approving or merging the version PR on GitHub does not publish.',
	merge: 'Merging the version PR publishes it once the checks pass. Nobody publishes it in Beepboop.',
	push: 'A signed commit that raises the version publishes it once the checks pass, with no review.',
};
export const publishWhenQuestion = 'When a version on the default branch publishes';

export const versionLandings = ['via-version-pr', 'via-direct-commit'] as const;
export type VersionLands = typeof versionLandings[number];
export const versionLandsNames = {
	pr: 'via-version-pr',
	commit: 'via-direct-commit',
} as const satisfies Record<VersionBump, VersionLands>;
export const bumpOfVersionLands = {
	'via-version-pr': 'pr',
	'via-direct-commit': 'commit',
} as const satisfies Record<VersionLands, VersionBump>;
export const versionLandsSentences: Record<VersionBump, string> = {
	pr: 'Beepboop opens a version PR, and merging it puts the new version on the default branch.',
	commit: 'Beepboop pushes a signed commit with the new version straight to the default branch.',
};
export const versionLandsQuestion = 'How a new version reaches the default branch';

export const versionPrMerges = ['manual', 'squash', 'merge', 'rebase'] as const;
export type VersionPrMerge = typeof versionPrMerges[number];
export type AutoMergeMethod = Exclude<VersionPrMerge, 'manual'>;
export const autoMergeMethods = ['squash', 'merge', 'rebase'] as const satisfies readonly AutoMergeMethod[];
const versionPrMergeWarning =
	'With `publishWhen: version-pr-merged`, the release then publishes with nobody touching it.';
export const versionPrMergeSentences: Record<VersionPrMerge, string> = {
	manual: 'You merge the version PR yourself.',
	squash:
		`Beepboop turns on GitHub auto-merge, and GitHub squashes the version PR into one commit once its checks pass. ${versionPrMergeWarning}`,
	merge:
		`Beepboop turns on GitHub auto-merge, and GitHub merges the version PR with a merge commit once its checks pass. ${versionPrMergeWarning}`,
	rebase:
		`Beepboop turns on GitHub auto-merge, and GitHub rebases the version PR onto the default branch once its checks pass. ${versionPrMergeWarning}`,
};
export const versionPrMergeQuestion = 'Who merges the version PR';

export const startFromSentences: Record<StartChannel, string> = {
	action: `The Start release workflow in GitHub Actions (${startWorkflowFile}) starts the release.`,
	dashboard: 'The Release button in the Beepboop dashboard starts the release.',
	cli: '`beepboop release` starts the release.',
};
export const startFromEffect = 'Starting a release also publishes it, and nothing asks again.';
export const startFromQuestion = `Where a release starts. ${startFromEffect.slice(0, -1)}`;

export const versionScopes = ['one-for-stream', 'per-package', 'none'] as const;
export type VersionScope = typeof versionScopes[number];
export const versionScopeNames = {
	workspace: 'one-for-stream',
	independent: 'per-package',
	none: 'none',
} as const satisfies Record<Versioning, VersionScope>;
export const versioningOfVersionScope = {
	'one-for-stream': 'workspace',
	'per-package': 'independent',
	none: 'none',
} as const satisfies Record<VersionScope, Versioning>;
export const versionScopeSentences: Record<Versioning, string> = {
	workspace: 'Every package in the release group gets the same version.',
	independent: 'Each package gets its own version.',
	none: 'The release group carries no version.',
};
export const versionScopeQuestion = 'Which packages share a version';

export const existingTriggerChoices = ['keep-and-report', 'replace-with-dispatch', 'keep-and-block-conflicts'] as const;
export type ExistingTriggers = typeof existingTriggerChoices[number];
export const existingTriggersNames = {
	review: 'keep-and-report',
	dispatchOnly: 'replace-with-dispatch',
	preserve: 'keep-and-block-conflicts',
} as const satisfies Record<TriggerHandover, ExistingTriggers>;
export const triggersOfExistingTriggers = {
	'keep-and-report': 'review',
	'replace-with-dispatch': 'dispatchOnly',
	'keep-and-block-conflicts': 'preserve',
} as const satisfies Record<ExistingTriggers, TriggerHandover>;
export const existingTriggersSentences: Record<TriggerHandover, string> = {
	review: 'The workflow keeps its existing triggers. Beepboop reports a trigger that conflicts with its dispatch.',
	dispatchOnly: "Beepboop replaces the workflow's existing triggers with its own dispatch.",
	preserve:
		'The workflow keeps its existing triggers. Beepboop blocks the setup when a trigger cannot work with its dispatch.',
};
export const existingTriggersQuestion = 'What happens to the existing triggers of a workflow Beepboop runs';

export const mustPublishSentence = 'Packages that must publish for the release to count as successful.';
export const companionModulesSentence =
	'Go modules whose version tag is pushed on the release commit together with the stream tag, such as go/v1.2.3 beside cli-v1.2.3. Each module keeps its own stream.';

export const publishWhen = z.enum(publishWhens);
export const versionLands = z.enum(versionLandings);
export const versionScope = z.enum(versionScopes);
export const versionPrMerge = z.enum(versionPrMerges);
export const existingTriggers = z.enum(existingTriggerChoices);

function described<K extends string>(
	question: string,
	names: Readonly<Record<K, string>>,
	sentences: Readonly<Record<K, string>>,
): string {
	const keys = Object.keys(names).filter((key): key is K => Object.hasOwn(sentences, key));
	return [`${question}.`, ...keys.map(key => `${names[key]}: ${sentences[key]}`)].join(' ');
}
export const publishWhenDescription = described(publishWhenQuestion, publishWhenNames, publishWhenSentences);
export const versionLandsDescription = described(versionLandsQuestion, versionLandsNames, versionLandsSentences);
export const versionScopeDescription = described(versionScopeQuestion, versionScopeNames, versionScopeSentences);
export const versionPrMergeDescription = described(
	versionPrMergeQuestion,
	{ manual: 'manual', squash: 'squash', merge: 'merge', rebase: 'rebase' },
	versionPrMergeSentences,
);
export const existingTriggersDescription = described(
	existingTriggersQuestion,
	existingTriggersNames,
	existingTriggersSentences,
);
