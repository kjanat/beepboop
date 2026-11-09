import { Result } from 'effect';
import { matchesPackage, parseReleaseIdentity, publishablePackages } from '@/automation/package-identity';
import type { Configuration, Inventory, Snapshot, Stream } from '@/automation/types';
import type { Diagnostic, DiagnosticSubject } from '@/contract/diagnostics';
import { operations as operationsOf } from '@/domain/configuration';

function versioned(reference: string): boolean {
	if (!reference.startsWith('pkg:')) return false;
	const identity = parseReleaseIdentity(reference);
	return Result.isSuccess(identity) && identity.success.version !== undefined;
}

function releaseDispatches(stream: Stream): Set<string> {
	const operations = operationsOf(stream);
	const dispatched = new Set<string>();
	const visit = (name: string): void => {
		if (dispatched.has(name)) return;
		const binding = operations.get(name);
		if (!binding) return;
		dispatched.add(name);
		for (const dependency of binding.needs ?? []) visit(dependency);
	};
	visit('prepare');
	visit('promote');
	for (const [name, binding] of operations) if (binding.each === 'package') visit(name);
	return dispatched;
}

export function validateAgainst(
	configuration: Configuration,
	inventory: Inventory,
	snapshot: Pick<Snapshot, 'paths'>,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const report = (
		severity: Diagnostic['severity'],
		code: Diagnostic['code'],
		subject: DiagnosticSubject,
		message: string,
	): void => {
		diagnostics.push({ code, severity, subject, message });
	};
	const paths = new Set(snapshot.paths);
	for (const [name, stream] of Object.entries(configuration.streams)) {
		const subject: DiagnosticSubject = { kind: 'stream', name };
		const operations = [...operationsOf(stream)];
		const dispatched = releaseDispatches(stream);
		const references: [string, string][] = [
			...(stream.packages ?? []).map((reference): [string, string] => ['packages', reference]),
			...stream.required.map((reference): [string, string] => ['required', reference]),
			...operations.flatMap(([operation, binding]) =>
				(binding.publications ?? []).map((reference): [string, string] => [`${operation} publications`, reference])
			),
		];
		for (const [field, reference] of references) {
			if (versioned(reference)) {
				report(
					'warning',
					'versioned-reference',
					subject,
					`Stream ${name} ${field} names ${reference} with a version; package references are versionless`,
				);
			}
		}
		for (const reference of stream.packages ?? []) {
			if (!inventory.packages.some(pkg => matchesPackage(reference, pkg))) {
				report(
					'blocking',
					'unknown-reference',
					subject,
					`Stream ${name} packages names ${reference}, which discovery did not find`,
				);
			}
		}
		for (const [operation, binding] of operations) {
			const at: DiagnosticSubject = { kind: 'binding', stream: name, operation };
			const severity = dispatched.has(operation) ? 'blocking' : 'warning';
			if (!paths.has(`.github/workflows/${binding.file}`)) {
				report(
					severity,
					'binding-missing',
					at,
					`Stream ${name} ${operation} uses .github/workflows/${binding.file}, which does not exist`,
				);
				continue;
			}
			if (binding.mode === 'observe') continue;
			const workflow = inventory.workflows.find(candidate => candidate.file === binding.file);
			if (
				workflow
				&& (!workflow.events.includes('workflow_dispatch')
					|| !workflow.dispatchInputs.includes('beepboop_execution_id'))
			) {
				report(
					severity,
					'binding-not-dispatchable',
					at,
					`Stream ${name} ${operation}: ${binding.file} needs a workflow_dispatch trigger with a beepboop_execution_id input`,
				);
			}
			if (binding.ref?.includes('*')) {
				report(
					severity,
					'wildcard-ref',
					at,
					`Stream ${name} ${operation} dispatches ${binding.ref}; dispatch needs an exact ref`,
				);
			}
			if (workflow && binding.each === 'package' && !workflow.dispatchInputs.includes('package')) {
				report(
					'blocking',
					'each-package-input',
					at,
					`Stream ${name} ${operation} runs once per package; ${binding.file} needs a package input`,
				);
			}
		}
		for (const rule of stream.versionFiles ?? []) {
			if (!paths.has(rule.path)) {
				report(
					'blocking',
					'version-file-missing',
					{ kind: 'file', path: rule.path },
					`Stream ${name} edits ${rule.path}, which does not exist`,
				);
			}
		}
		const selected = publishablePackages(inventory.packages, stream.packages);
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
				report(
					'warning',
					'required-uncovered',
					subject,
					`Stream ${name} requires ${reference}; no operation lists it under publications`,
				);
			}
		}
	}
	return diagnostics;
}
