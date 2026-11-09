import { parse } from 'yaml';
import type { Edit, Snapshot } from '@/automation/types';

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
			text: `job \`${job}\`, step \`${key}\`: inserts the token step's gitId with a fallback for a skipped token step`,
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
function leaves(value: unknown, prefix = ''): Map<string, string> {
	const out = new Map<string, string>();
	if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			for (const [path, leaf] of leaves(child, prefix ? `${prefix}.${key}` : key)) out.set(path, leaf);
		}
	} else out.set(prefix, JSON.stringify(value));
	return out;
}
function configurationChanges(before: Record<string, unknown>, after: Record<string, unknown>): Change[] {
	const old = leaves(before), next = leaves(after);
	const paths = [...new Set([...old.keys(), ...next.keys()])].filter(path => old.get(path) !== next.get(path));
	return paths.map(path => ({
		text: `${next.has(path) ? old.has(path) ? 'changes' : 'adds' : 'removes'} \`${path}\``,
		label: 'release configuration',
	}));
}
export function describeEdits(edits: Edit[]): FileChanges[] {
	return edits.map(edit => {
		if (!edit.before) return { path: edit.path, changes: [{ text: 'adds the file' }] };
		const before = document(edit.before), after = document(edit.after);
		if (!before || !after) return { path: edit.path, changes: [{ text: 'changes the file' }] };
		const changes = edit.path.endsWith('.json') ? configurationChanges(before, after) : workflowChanges(before, after);
		return { path: edit.path, changes: changes.length ? changes : [{ text: 'changes formatting' }] };
	});
}
export function setupTitle(branch: string, edits: Edit[]): string {
	if (branch === onboardingBranch) return 'chore: configure release automation';
	const labels = [
		...new Set(
			describeEdits(edits).flatMap(file => file.changes.flatMap(change => change.label ? [change.label] : [])),
		),
	];
	const title = `chore: update release setup (${labels.join(', ')})`;
	return labels.length && title.length <= longestTitle ? title : 'chore: update release setup';
}
export function changeSummary(branch: string, edits: Edit[], defaultBranch: string): string {
	if (branch === onboardingBranch) return '';
	return `Changes against the release setup on \`${defaultBranch}\`:\n\n${
		describeEdits(edits).map(file =>
			`- \`${file.path}\`\n${file.changes.map(change => `  - ${change.text}`).join('\n')}`
		).join('\n')
	}\n\n`;
}
