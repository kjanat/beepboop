import type { BinaryBuild, BinaryTarget } from '@/domain/binary-platforms.ts';
import { failsOn } from '@/domain/binary-platforms.ts';
import { packageMarkdown } from '@/domain/package-label';
import { publicationStages } from '@/domain/publication-stages';
import { onboardingBranch } from '@/domain/setup-branches.ts';
import {
	alwaysStarted,
	existingTriggersNames,
	existingTriggersQuestion,
	existingTriggersSentences,
	publishWhenNames,
	publishWhenQuestion,
	publishWhenSentences,
	startFromEffect,
	startFromQuestion,
	startFromSentences,
	versionLandsNames,
	versionLandsQuestion,
	versionLandsSentences,
	versionPrMergeQuestion,
	versionPrMergeSentences,
	versionScopeNames,
	versionScopeSentences,
} from '@/domain/setup-terms.ts';
import { listed } from '@/kernel/text/listing.ts';
import { behaviourChanges, changeDetails } from '@/setup/changes.ts';
import { startable } from '@/setup/contract.ts';
import { optionId, selected, setupOptions } from '@/setup/options.ts';
import type { SetupChoices, SetupOption, SetupPlan, SetupWorkflow, TriggerHandover } from '@/setup/types.ts';

function binaryOrigin(build: BinaryBuild): string {
	return build.toolchain === 'cargo'
		? `Cargo, \`${build.manifest}\``
		: `Go, \`${build.package === '.' ? build.module : `${build.module}/${build.package.slice(2)}`}\``;
}
function triggerSentence(handover: TriggerHandover | 'new', files: string[]): string {
	const them = files.length === 1 ? 'it' : 'them';
	return handover === 'new'
		? `${listed(files)}: this PR creates ${them}, and only Beepboop dispatches ${them}.`
		: `${listed(files)}, \`existingTriggers: ${existingTriggersNames[handover]}\`: ${
			existingTriggersSentences[handover]
		}`;
}
export const heldNote = 'Beepboop holds its release until the package has them.';
const releaseMarker = '<!-- beepboop:release-after-merge -->';
export function releaseAfterMerge(body: string): boolean {
	return /^[ \t]*[-*+] \[[xX]\] <!-- beepboop:release-after-merge -->/m.test(body);
}
export function releaseAfterMergeBox(release: boolean): string {
	return `Tick this box to release the current version when this PR merges.\n\n- [${
		release ? 'x' : ' '
	}] ${releaseMarker} Release after merge`;
}
function mentionFree(text: string): string {
	return text.replace(/(^|[\s(])(@[\w.-]+\/[\w.-]+)/g, '$1`$2`');
}
function noteMarkdown(plan: SetupPlan, note: string): string {
	const pkg = plan.inventory.packages.find(entry => note.startsWith(`${entry.name} (${entry.manifest}) `));
	return pkg
		? `\`${pkg.name}\` (\`${pkg.manifest}\`)${note.slice(`${pkg.name} (${pkg.manifest})`.length)}`
		: mentionFree(note);
}
function fixedStream(stream: SetupChoices['streams'][number]): string | undefined {
	if (!stream.promote) {
		if (stream.observe?.some(entry => entry.publications.length)) {
			return `Beepboop observes the existing publishing workflows for \`${stream.name}\`. Their own triggers start releases.`;
		}
		return `\`${stream.name}\` has no publishing workflow, so it has no \`startFrom\`, \`versionLands\` or \`publishWhen\`.`;
	}
	if (!startable(stream)) {
		return `\`${stream.name}\` versions each package on its own. Starting a release raises one version for the whole release group, so it offers no \`startFrom\`.`;
	}
	if (stream.versionSource?.kind === 'tags') {
		return `\`${stream.name}\` takes its version from \`${stream.versionSource.prefix}\` tags. A started release must publish a version tag with that prefix.`;
	}
	return undefined;
}
export interface SetupBodyContext {
	branch: string;
	defaultBranch: string;
	release?: boolean;
}
export function setupBody(plan: SetupPlan, context: SetupBodyContext): string {
	const { branch, defaultBranch, release = false } = context;
	const options = setupOptions(plan);
	const box = (indent: string, option: SetupOption, label: string) =>
		`${indent}- [${selected(option, plan.choices) ? 'x' : ' '}] <!-- beepboop:choice:${optionId(option)} --> ${label}`;
	const handovers = new Map<string, TriggerHandover | 'new'>();
	const workflow = (binding: SetupWorkflow | undefined) => {
		if (!binding) return 'none';
		const existing = plan.workflows.some(evidence => evidence.file === binding.file);
		handovers.set(binding.file, existing ? binding.triggers : 'new');
		return `\`${binding.file}\`${binding.job ? ` (job \`${binding.job}\`)` : ''}${existing ? '' : ', new in this PR'}`;
	};
	function choiceLines(stream: string): string[] {
		const own = options.filter(option => option.stream === stream);
		const approvals = own.flatMap(option =>
			option.kind === 'approval'
				? [box('    ', option, `\`${publishWhenNames[option.value]}\`: ${publishWhenSentences[option.value]}`)]
				: []
		);
		const starts = own.flatMap(option =>
			option.kind === 'start' ? [box('    ', option, `\`${option.value}\`: ${startFromSentences[option.value]}`)] : []
		);
		const bumps = own.flatMap(option =>
			option.kind === 'bump'
				? [box('    ', option, `\`${versionLandsNames[option.value]}\`: ${versionLandsSentences[option.value]}`)]
				: []
		);
		const merges = own.flatMap(option =>
			option.kind === 'versionPrMerge'
				? [box('    ', option, `\`${option.value}\`: ${versionPrMergeSentences[option.value]}`)]
				: []
		);
		return [
			...(starts.length
				? [`  - \`startFrom\`: ${startFromQuestion}. ${startFromEffect} ${alwaysStarted}`, ...starts]
				: []),
			...(bumps.length
				? [`  - \`versionLands\`: ${versionLandsQuestion}, here \`${defaultBranch}\`. Tick one.`, ...bumps]
				: []),
			...(merges.length ? [`  - \`versionPrMerge\`: ${versionPrMergeQuestion}. Tick one.`, ...merges] : []),
			...(approvals.length ? [`  - \`publishWhen\`: ${publishWhenQuestion}. Tick one.`, ...approvals] : []),
		];
	}
	function binaryLines(stream: string): string[] {
		const own = options.filter(option => option.stream === stream);
		const builds = own.flatMap(option =>
			option.kind === 'binary'
				? [box('    ', option, `\`${option.build.name}\` (${binaryOrigin(option.build)})`)]
				: []
		);
		if (!builds.length) return [];
		const release = plan.choices.streams.find(entry => entry.name === stream)?.promote?.binaries;
		const failing = (target: BinaryTarget) =>
			(release?.builds ?? []).flatMap(build => failsOn(plan.binaryCandidates, build, target) ? [build.name] : []);
		const targets = own.flatMap(option => {
			if (option.kind !== 'target') return [];
			const names = failing(option.target);
			return [
				box('    ', option, names.length ? `${option.target} (${listed(names)} expected to fail)` : option.target),
			];
		});
		return ['  - Release binaries', ...builds, '  - Binary targets', ...targets];
	}
	const streams = plan.choices.streams.map(stream => {
		const packages = options.flatMap(option =>
			option.kind === 'package' && option.stream === stream.name
				? [box('    ', option, packageMarkdown(option.package))]
				: []
		);
		const fixed = fixedStream(stream);
		return [
			`- **${stream.name}**`,
			...(packages.length ? ['  - Packages', ...packages] : []),
			...(fixed ? [`  - ${fixed}`] : []),
			...choiceLines(stream.name),
			`  - \`versionScope: ${versionScopeNames[stream.versioning]}\`: ${versionScopeSentences[stream.versioning]}`,
			`  - Preparation: ${workflow(stream.prepare)}`,
			`  - Publication: ${
				stream.promote ? workflow(stream.promote) : stream.observe?.some(entry => entry.publications.length)
					? [...new Set(stream.observe.filter(entry => entry.publications.length).map(entry => entry.file))].map(file =>
						`observes \`${file}\``
					).join(
						', ',
					)
					: 'none'
			}`,
			...binaryLines(stream.name),
			...(stream.operations ?? []).map(entry =>
				`  - After ${
					entry.needs.map(name => {
						const jobs = entry.needsJobs?.[name];
						return jobs ? `jobs ${jobs.map(job => `\`${job}\``).join(', ')} of \`${name}\`` : `\`${name}\``;
					}).join(', ')
				}: ${workflow(entry)}`
			),
			...(stream.needs && Object.keys(stream.needs).length
				? [
					'  - Publication order',
					...publicationStages(
						[...stream.packages, ...(stream.observe ?? []).flatMap(entry => entry.publications)],
						stream.needs,
					).map((stage, index) =>
						`    ${index + 1}. ${stage.length > 1 ? 'In parallel: ' : ''}${stage.map(packageMarkdown).join(', ')}`
					),
				]
				: []),
		].join('\n');
	}).join('\n');
	const grouped = new Map<TriggerHandover | 'new', string[]>();
	for (const [file, handover] of handovers) grouped.set(handover, [...(grouped.get(handover) ?? []), `\`${file}\``]);
	const triggers = [...grouped].map(([handover, files]) => triggerSentence(handover, files));
	const update = branch !== onboardingBranch;
	const changes = update ? behaviourChanges(plan.edits) : [];
	const held = plan.notes.filter(note => note.endsWith(heldNote));
	const notes = plan.notes.filter(note => !note.endsWith(heldNote));
	const commit = `https://github.com/${plan.repository}/commit/${plan.sourceSha}`;
	const sections = [
		`Beepboop inspected [\`${plan.sourceSha.slice(0, 12)}\`](${commit}), the head of \`${defaultBranch}\`.`,
		...(changes.length ? [`### What changes\n\n${changes.join('\n')}`] : []),
		...(held.length ? [`### Held packages\n\n${held.map(note => `- ${noteMarkdown(plan, note)}`).join('\n')}`] : []),
		'### Choices',
		'Tick or untick packages to change this proposal. Every ticked package is in `mustPublish`: it must publish for the release to count as successful. Beepboop rebuilds the proposal 5 seconds after the last edit.',
		streams,
		...(triggers.length ? [`${existingTriggersQuestion}:\n\n${triggers.map(line => `- ${line}`).join('\n')}`] : []),
		'Change `versionScope`, workflows and `existingTriggers` in Beepboop under Repositories, Edit release setup.',
		releaseAfterMergeBox(release),
		...(plan.adoption?.length ? [mentionFree(plan.adoption.join('\n').trimEnd())] : []),
		...(notes.length ? [notes.map(note => `- ${noteMarkdown(plan, note)}`).join('\n')] : []),
		...(update && plan.edits.length ? [changeDetails(plan.edits)] : []),
	];
	return `${sections.join('\n\n')}\n`;
}
