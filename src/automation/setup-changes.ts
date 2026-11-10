import { parse } from 'yaml';
import { readableConfiguration } from '@/automation/configuration-names';
import { listed } from '@/automation/setup-summary';
import type { Edit, Snapshot } from '@/automation/types';
import {
	approvalOfPublishWhen,
	bumpOfVersionLands,
	publishWhenSentences,
	startFromEffect,
	versionLandsSentences,
	versionPrMergeSentences,
	versionPrMerges,
} from '@/contract/setup-terms';

export const onboardingBranch = 'automation/onboarding';
export const updateBranch = 'automation/setup-update';
export const setupBranches: readonly string[] = [onboardingBranch, updateBranch];
const configurationPath = '.github/beepboop.json';
const longestTitle = 72;

export function setupBranch(snapshot: Snapshot): string {
	return snapshot.files[configurationPath] === undefined ? onboardingBranch : updateBranch;
}

interface Change {
	text: string;
	label?: string;
}
interface FileChanges {
	path: string;
	changes: Change[];
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}
function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
function document(source: string): Record<string, unknown> | undefined {
	try {
		return record(parse(source));
	} catch {
		return undefined;
	}
}
function stepKey(step: Record<string, unknown>, index: number): string {
	const run = typeof step.run === 'string' ? step.run.split('\n')[0] : undefined;
	return String(step.id ?? step.name ?? step.uses ?? run ?? `#${index + 1}`);
}
function stepChange(
	job: string,
	key: string,
	before: Record<string, unknown>,
	after: Record<string, unknown>,
): Change[] {
	const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name =>
		!same(before[name], after[name])
	);
	if (!changed.length) return [];
	const gitId = changed.includes('env') && JSON.stringify(after.env ?? {}).includes('outputs.gitId');
	if (gitId) {
		return [{
			text:
				`job \`${job}\`, step \`${key}\`: reads the git identity from the token step and uses an empty identity when that step is skipped`,
			label: 'gitId fallback',
		}];
	}
	if (changed.length === 1 && changed[0] === 'uses') {
		return [{ text: `job \`${job}\`, step \`${key}\`: uses \`${String(after.uses)}\``, label: 'action references' }];
	}
	return [{ text: `job \`${job}\`, step \`${key}\`: changes ${changed.map(name => `\`${name}\``).join(', ')}` }];
}
function jobChanges(name: string, before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
	const changes: Change[] = [];
	for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
		if (key === 'steps' || same(before[key], after[key])) continue;
		if (key === 'timeout-minutes') {
			changes.push({
				text: `job \`${name}\`: ${
					after[key] === undefined ? 'removes `timeout-minutes`' : `sets \`timeout-minutes\` to ${String(after[key])}`
				}, which stops a hung run`,
				label: 'job timeouts',
			});
		} else {
			changes.push({
				text: `job \`${name}\`: ${
					after[key] === undefined ? 'removes' : before[key] === undefined ? 'adds' : 'changes'
				} \`${key}\``,
			});
		}
	}
	const steps = (value: unknown) =>
		Array.isArray(value) ? value.map(record).map((step, index) => [stepKey(step, index), step] as const) : [];
	const old = new Map(steps(before.steps)), next = new Map(steps(after.steps));
	for (const [key, step] of next) {
		const previous = old.get(key);
		if (!previous) changes.push({ text: `job \`${name}\`: adds step \`${key}\`` });
		else changes.push(...stepChange(name, key, previous, step));
	}
	for (const key of old.keys()) if (!next.has(key)) changes.push({ text: `job \`${name}\`: removes step \`${key}\`` });
	if (!changes.length && !same(before.steps, after.steps)) {
		changes.push({ text: `job \`${name}\`: reorders its steps` });
	}
	return changes;
}
function workflowChanges(before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
	const changes: Change[] = [];
	for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
		if (key !== 'jobs' && !same(before[key], after[key])) changes.push({ text: `changes \`${key}\`` });
	}
	const oldJobs = record(before.jobs), newJobs = record(after.jobs);
	for (const [name, job] of Object.entries(newJobs)) {
		if (oldJobs[name] === undefined) changes.push({ text: `adds job \`${name}\`` });
		else changes.push(...jobChanges(name, record(oldJobs[name]), record(job)));
	}
	for (const name of Object.keys(oldJobs)) {
		if (newJobs[name] === undefined) changes.push({ text: `removes job \`${name}\`` });
	}
	return changes;
}
function leaves(value: unknown, prefix = ''): Map<string, unknown> {
	const out = new Map<string, unknown>();
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			for (const [path, leaf] of leaves(child, prefix ? `${prefix}.${key}` : key)) out.set(path, leaf);
		}
	} else out.set(prefix, value);
	return out;
}
interface LeafChange {
	path: string;
	before: unknown;
	after: unknown;
}
function leafChanges(before: Record<string, unknown>, after: Record<string, unknown>): LeafChange[] {
	const old = leaves(before), next = leaves(after);
	return [...new Set([...old.keys(), ...next.keys()])]
		.filter(path => !same(old.get(path), next.get(path)))
		.map(path => ({ path, before: old.get(path), after: next.get(path) }));
}
const setupPath = /(?:^|\.)setup(?:\.|$)/;
const renamedLine =
	'Renames the settings to their current names: `publishWhen`, `versionLands`, `startFrom`, `mustPublish`, `versionScope` and `existingTriggers`.';
function readable(source: string): Record<string, unknown> {
	return record(readableConfiguration(document(source)));
}
function renamesSettings(source: string): boolean {
	return !!source && !same(record(document(source)), readable(source));
}
const labelled: { pattern: RegExp; label: string }[] = [
	{ pattern: /^streams\.[^.]+\.promote\.publishWhen$/, label: 'publishWhen' },
	{ pattern: /^streams\.[^.]+\.startFrom$/, label: 'startFrom' },
	{ pattern: /^streams\.[^.]+\.prepare\.versionLands$/, label: 'versionLands' },
	{ pattern: /^streams\.[^.]+\.prepare\.versionPrMerge$/, label: 'versionPrMerge' },
	{ pattern: /(?:^|\.)publications$|^managers$/, label: 'publications' },
	{ pattern: /^streams\.[^.]+\.workflows\.[^.]+\.needs(?:Jobs)?$/, label: 'workflow order' },
];
function configurationLabel(path: string): string {
	if (setupPath.test(path)) return 'setup in beepboop.json';
	return labelled.find(entry => entry.pattern.test(path))?.label ?? 'release configuration';
}
function configurationChanges(before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
	return leafChanges(before, after).map(({ path, before, after }) => ({
		text: `${after === undefined ? 'removes' : before === undefined ? 'adds' : 'changes'} \`${path}\``,
		label: configurationLabel(path),
	}));
}
function item(value: unknown): string {
	const entry = record(value);
	if (typeof entry.via === 'string') {
		return `\`${entry.via}\`${typeof entry.workflow === 'string' ? ` (\`${entry.workflow}\`)` : ''}`;
	}
	return `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``;
}
function shown(value: unknown): string {
	if (value === undefined) return 'none';
	if (Array.isArray(value)) return value.length ? value.map(item).join(', ') : 'none';
	return item(value);
}
function valueChange(before: unknown, after: unknown): string {
	if (Array.isArray(before) && Array.isArray(after)) {
		const missing = (from: unknown[], to: unknown[]) => from.filter(value => !to.some(other => same(value, other)));
		const added = missing(after, before), removed = missing(before, after);
		const parts = [
			...(added.length ? [`adds ${added.map(item).join(', ')}`] : []),
			...(removed.length ? [`removes ${removed.map(item).join(', ')}`] : []),
		];
		return parts.length ? parts.join(' and ') : 'reorders its entries';
	}
	return `${shown(before)} → ${shown(after)}`;
}
function effect(path: string, after: unknown): string | undefined {
	if (path.endsWith('.promote.publishWhen')) {
		const policy = Object.entries(approvalOfPublishWhen).find(([name]) => name === after)?.[1];
		return policy && publishWhenSentences[policy];
	}
	if (path.endsWith('.prepare.versionLands')) {
		const bump = Object.entries(bumpOfVersionLands).find(([name]) => name === after)?.[1];
		return bump && versionLandsSentences[bump];
	}
	if (path.endsWith('.prepare.versionPrMerge')) {
		const merge = versionPrMerges.find(value => value === after);
		return merge && versionPrMergeSentences[merge];
	}
	if (/\.startFrom$/.test(path) && Array.isArray(after) && after.length) return startFromEffect;
	if (
		path.endsWith('publications') && Array.isArray(after)
		&& after.some(value => typeof value === 'string' && value.startsWith('github-release:'))
	) return 'This workflow now publishes the GitHub release.';
	return undefined;
}
function behaviour({ path, before, after }: LeafChange): string {
	const subject = `\`${path.replace(/^streams\.[^.]+\./, '')}\``;
	if (path.split('.').includes('credentials')) return `${subject} changes.`;
	const consequence = effect(path, after);
	return `${subject}: ${valueChange(before, after)}.${consequence ? ` ${consequence}` : ''}`;
}
const workflowEffects: Record<string, string> = {
	'job timeouts': 'Jobs get timeouts that stop a hung run.',
	'gitId fallback': 'The ref-publishing step keeps its git identity when the token step is skipped.',
	'action references': 'Workflow steps move to newer Beepboop action references.',
};
export function behaviourChanges(edits: Edit[]): string[] {
	const groups = new Map<string, string[]>();
	const add = (group: string, line: string) => groups.set(group, [...(groups.get(group) ?? []), line]);
	for (const edit of edits) {
		if (edit.path === configurationPath) {
			for (const change of leafChanges(readable(edit.before), readable(edit.after))) {
				if (setupPath.test(change.path)) continue;
				const stream = /^streams\.([^.]+)\./.exec(change.path)?.[1];
				add(stream ? `\`${stream}\`` : 'Repository', behaviour(change));
			}
			if (renamesSettings(edit.before)) add('Repository', renamedLine);
			continue;
		}
		if (!edit.before) {
			add('Workflows', `Adds \`${edit.path}\`.`);
			continue;
		}
		const file = edit.path.split('/').at(-1) ?? edit.path;
		const before = buildJobs(edit.before), after = buildJobs(edit.after);
		const built = [...after].filter(name => !before.has(name)), dropped = [...before].filter(name => !after.has(name));
		if (built.length) {
			add('Workflows', `\`${file}\` builds the ${listed(built.map(name => `\`${name}\``))} release binaries.`);
		}
		if (dropped.length) {
			add(
				'Workflows',
				`\`${file}\` stops building the ${listed(dropped.map(name => `\`${name}\``))} release binaries.`,
			);
		}
	}
	const labels = new Set(
		describeEdits(edits.filter(edit => edit.path !== configurationPath && edit.before)).flatMap(file =>
			file.changes.flatMap(change => change.label ? [change.label] : [])
		),
	);
	for (const label of labels) {
		const line = workflowEffects[label];
		if (line) add('Workflows', line);
	}
	const configuration = edits.find(edit => edit.path === configurationPath);
	if (
		configuration
		&& leafChanges(readable(configuration.before), readable(configuration.after)).some(change =>
			setupPath.test(change.path)
		)
	) add('Repository', '`.github/beepboop.json` records the setup input that generates its workflows.');
	return [...groups].flatMap(([group, lines]) => [`- ${group}`, ...lines.map(line => `  - ${line}`)]);
}
function buildJobs(source: string): Set<string> {
	return new Set(
		Object.keys(record(record(document(source)).jobs)).flatMap(job =>
			job.startsWith('build-') ? [job.slice('build-'.length)] : []
		),
	);
}
export function describeEdits(edits: Edit[]): FileChanges[] {
	return edits.map(edit => {
		if (!edit.before) return { path: edit.path, changes: [{ text: 'adds the file' }] };
		const before = document(edit.before), after = document(edit.after);
		if (!before || !after) return { path: edit.path, changes: [{ text: 'changes the file' }] };
		const changes = edit.path === configurationPath
			? [
				...(renamesSettings(edit.before) ? [{ text: renamedLine, label: 'setting names' }] : []),
				...configurationChanges(readable(edit.before), readable(edit.after)),
			]
			: edit.path.endsWith('.json')
			? configurationChanges(before, after)
			: workflowChanges(before, after);
		return { path: edit.path, changes: changes.length ? changes : [{ text: 'changes formatting' }] };
	});
}
export function setupTitle(branch: string, edits: Edit[]): string {
	if (branch === onboardingBranch) return 'chore: configure release automation';
	const workflows = edits.filter(edit => edit.path.startsWith('.github/workflows/'));
	const before = new Set(workflows.flatMap(edit => [...buildJobs(edit.before)]));
	const after = new Set(workflows.flatMap(edit => [...buildJobs(edit.after)]));
	const added = [...after].filter(name => !before.has(name)), removed = [...before].filter(name => !after.has(name));
	const labels = [
		...new Set(
			describeEdits(edits).flatMap(file => file.changes.flatMap(change => change.label ? [change.label] : [])),
		),
	];
	if (!labels.some(label => !upkeep.has(label))) {
		if (added.length) return `chore: build ${listed(added)} release binaries`;
		if (removed.length) return `chore: stop building ${listed(removed)} release binaries`;
	}
	const named = [...(added.length || removed.length ? ['release binaries'] : []), ...labels];
	const title = `chore: update release setup (${named.join(', ')})`;
	return named.length && title.length <= longestTitle ? title : 'chore: update release setup';
}
const upkeep = new Set(['setup in beepboop.json', 'job timeouts', 'gitId fallback', 'action references']);
export function changeDetails(edits: Edit[]): string {
	return `<details>\n<summary>Every changed file and path</summary>\n\n${
		describeEdits(edits).map(file =>
			`- \`${file.path}\`\n${file.changes.map(change => `  - ${change.text}`).join('\n')}`
		).join('\n')
	}\n\n</details>`;
}
