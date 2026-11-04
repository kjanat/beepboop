import { matchesPackage, releaseIdentity } from '@/automation/package-identity';
import { publishable } from '@/automation/package-publication';
import type { Configuration, Inventory, Snapshot, Stream, WorkflowBinding } from '@/automation/types';
import type { Diagnostic, DiagnosticSubject } from '@/contract/diagnostics';

function bindings(stream: Stream): [string, WorkflowBinding][] {
	return [
		...Object.entries(stream.workflows).filter(([name]) => name !== 'prepare' && name !== 'promote'),
		...(stream.prepare.workflow ? [['prepare', stream.prepare.workflow] satisfies [string, WorkflowBinding]] : []),
		...(stream.promote.workflow ? [['promote', stream.promote.workflow] satisfies [string, WorkflowBinding]] : []),
	];
}

function versioned(reference: string): boolean {
	if (!reference.startsWith('pkg:')) return false;
	try {
		return releaseIdentity(reference).version !== undefined;
	} catch {
		return false;
	}
}

export function validateAgainst(
	configuration: Configuration,
	inventory: Inventory,
	snapshot: Pick<Snapshot, 'paths'>,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const problem = (code: Diagnostic['code'], subject: DiagnosticSubject, message: string): void => {
		diagnostics.push({ code, severity: 'blocking', subject, message });
	};
	const paths = new Set(snapshot.paths);
	for (const [name, stream] of Object.entries(configuration.streams)) {
		const subject: DiagnosticSubject = { kind: 'stream', name };
		const operations = bindings(stream);
		const references: [string, string][] = [
			...(stream.packages ?? []).map((reference): [string, string] => ['packages', reference]),
			...stream.required.map((reference): [string, string] => ['required', reference]),
			...operations.flatMap(([operation, binding]) =>
				(binding.publications ?? []).map((reference): [string, string] => [`${operation} publications`, reference])
			),
		];
		for (const [field, reference] of references) {
			if (versioned(reference)) {
				problem(
					'versioned-reference',
					subject,
					`Stream ${name} ${field} names ${reference} with a version; package references are versionless`,
				);
			}
		}
		for (const reference of stream.packages ?? []) {
			if (!inventory.packages.some(pkg => matchesPackage(reference, pkg))) {
				problem(
					'unknown-reference',
					subject,
					`Stream ${name} packages names ${reference}, which discovery did not find`,
				);
			}
		}
		for (const [operation, binding] of operations) {
			const at: DiagnosticSubject = { kind: 'binding', stream: name, operation };
			const workflow = inventory.workflows.find(candidate => candidate.file === binding.file);
			if (!workflow) {
				problem(
					'binding-missing',
					at,
					`Stream ${name} ${operation} uses .github/workflows/${binding.file}, which does not exist`,
				);
				continue;
			}
			if (binding.mode === 'observe') continue;
			if (
				!workflow.events.includes('workflow_dispatch') || !workflow.dispatchInputs.includes('beepboop_execution_id')
			) {
				problem(
					'binding-not-dispatchable',
					at,
					`Stream ${name} ${operation}: ${binding.file} needs a workflow_dispatch trigger with a beepboop_execution_id input`,
				);
			}
			if (binding.ref?.includes('*')) {
				problem(
					'wildcard-ref',
					at,
					`Stream ${name} ${operation} dispatches ${binding.ref}; dispatch needs an exact ref`,
				);
			}
			if (binding.each === 'package' && !workflow.dispatchInputs.includes('package')) {
				problem(
					'each-package-input',
					at,
					`Stream ${name} ${operation} runs once per package; ${binding.file} needs a package input`,
				);
			}
		}
		for (const rule of stream.versionFiles ?? []) {
			if (!paths.has(rule.path)) {
				problem(
					'version-file-missing',
					{ kind: 'file', path: rule.path },
					`Stream ${name} edits ${rule.path}, which does not exist`,
				);
			}
		}
		const selected = inventory.packages.filter(pkg =>
			publishable(pkg) && (!stream.packages || stream.packages.some(reference => matchesPackage(reference, pkg)))
		);
		const declared = operations.flatMap(([operation, binding]) => [
			...(binding.publications ?? []),
			...(binding.refs ? [`refs:${operation}`] : []),
		]);
		const implicit = operations.some(([operation, binding]) => operation === 'publish' && !binding.publications);
		const same = (left: string, right: string): boolean =>
			left === right
			|| inventory.packages.some(pkg => matchesPackage(left, pkg) && matchesPackage(right, pkg));
		for (const reference of stream.required) {
			const grouped = stream.versioning === 'independent' && selected.some(pkg => matchesPackage(reference, pkg));
			if (!implicit && !grouped && !declared.some(entry => same(entry, reference))) {
				problem(
					'required-uncovered',
					subject,
					`Stream ${name} requires ${reference}; no operation lists it under publications`,
				);
			}
		}
	}
	return diagnostics;
}
