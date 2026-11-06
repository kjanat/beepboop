import { Result } from 'effect';
import { object, yaml } from '@/automation/managers/helpers';
import {
	bindInputs,
	disabled,
	inputDefaults,
	literalBindings,
	matrixCombinations,
	substitute,
} from '@/automation/release-graph/bindings';
import { escapeRegExp } from '@/automation/release-graph/shell';

export interface WorkflowDocument {
	file: string;
	path: string;
	document: Record<string, unknown>;
}
export interface WorkflowCall {
	root: string;
	caller: string;
	job: string;
	callee: WorkflowDocument;
	bindings: Record<string, string>;
}

const workflowPath = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export function workflowDocuments(files: Iterable<readonly [string, string]>): WorkflowDocument[] {
	return [...files].flatMap(([path, source]) => {
		if (!workflowPath.test(path)) return [];
		const parsed = yaml(source);
		return Result.isFailure(parsed)
			? []
			: [{ file: path.slice('.github/workflows/'.length), path, document: parsed.success }];
	});
}

export function workflowEvents(document: Record<string, unknown>): string[] {
	const trigger = document.on;
	return typeof trigger === 'string'
		? [trigger]
		: Array.isArray(trigger)
		? trigger.map(String)
		: Object.keys(object(trigger));
}

export function ownWorkflow(uses: string, repository: string): { file: string; ref?: string } | undefined {
	const match = new RegExp(`^(?:\\./|\\$/|${escapeRegExp(repository)}/)\\.github/workflows/([^@]+?)(?:@(.+))?$`, 'i')
		.exec(
			uses,
		);
	return match?.[1] ? { file: match[1], ...(match[2] ? { ref: match[2] } : {}) } : undefined;
}

export function localAction(uses: string): string | undefined {
	return /^(?:\.\/|\$\/)(.+?)\/?$/.exec(uses)?.[1];
}

export function liveJobs(document: Record<string, unknown>): [string, Record<string, unknown>][] {
	return Object.entries(object(document.jobs)).flatMap(([id, value]) => {
		const job = object(value);
		return disabled(job.if) ? [] : [[id, job] as [string, Record<string, unknown>]];
	});
}

export function workflowCalls(documents: readonly WorkflowDocument[], repository: string): WorkflowCall[] {
	const byFile = new Map(documents.map(entry => [entry.file, entry] as const));
	const target = (job: Record<string, unknown>) =>
		typeof job.uses === 'string' ? ownWorkflow(job.uses, repository)?.file : undefined;
	const called = new Set(documents.flatMap(entry => liveJobs(entry.document).flatMap(([, job]) => target(job) ?? [])));
	const calls: WorkflowCall[] = [];
	const visit = (root: string, file: string, inherited: Readonly<Record<string, string>>, trail: readonly string[]) => {
		const caller = byFile.get(file);
		if (!caller) return;
		for (const [id, job] of liveJobs(caller.document)) {
			const name = target(job);
			const callee = name === undefined ? undefined : byFile.get(name);
			if (!callee || trail.includes(callee.file)) continue;
			const assignments = matrixCombinations(object(object(job.strategy).matrix)).slice(0, 64);
			for (const assignment of assignments.length ? assignments : [{}]) {
				const supplied = Object.fromEntries(
					Object.entries(object(job.with)).map((
						[key, input],
					) => [key, typeof input === 'string' ? substitute(bindInputs(input, inherited), assignment) : input]),
				);
				const bindings = {
					...inputDefaults(object(object(callee.document.on).workflow_call).inputs, Object.keys(supplied)),
					...literalBindings(supplied),
				};
				calls.push({ root, caller: file, job: id, callee, bindings });
				visit(root, callee.file, bindings, [...trail, callee.file]);
			}
		}
	};
	for (const { file, document } of documents) {
		if (!called.has(file) || workflowEvents(document).some(event => event !== 'workflow_call')) {
			visit(file, file, {}, [file]);
		}
	}
	return calls;
}

export function actionBindings(
	source: string | undefined,
	supplied: Readonly<Record<string, unknown>>,
): { definition: Record<string, unknown>; bindings: Record<string, string> } {
	const parsed = source === undefined ? undefined : yaml(source);
	const manifest = parsed && Result.isSuccess(parsed) ? parsed.success : {};
	return {
		definition: object(manifest.runs),
		bindings: { ...inputDefaults(manifest.inputs, Object.keys(supplied)), ...literalBindings(supplied) },
	};
}
