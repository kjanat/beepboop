import { exclusionReasons, type PackagePublication } from '@/automation/package-publication';
import type { SetupChoices, SetupPlan, SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import { array, boolean, oneOf, record, string } from '@/model';

function strings(value: unknown): string[] {
	return array(value).map(string);
}
function workflow(value: unknown): SetupWorkflow {
	const data = record(value);
	return {
		file: string(data.file),
		...(data.job === undefined ? {} : { job: string(data.job) }),
		triggers: oneOf(data.triggers, ['review', 'dispatchOnly', 'preserve'], 'Invalid workflow triggers'),
		commands: string(data.commands),
		publicationSteps: Object.fromEntries(
			Object.entries(record(data.publicationSteps)).map(([id, step]) => [id, string(step)] as const),
		),
	};
}
function choices(value: unknown): SetupChoices {
	const data = record(value);
	return {
		streams: array(data.streams).map(raw => {
			const stream = record(raw);
			return {
				name: string(stream.name),
				packages: strings(stream.packages),
				versioning: oneOf(stream.versioning, ['workspace', 'independent', 'none'], 'Invalid versioning'),
				required: strings(stream.required),
				...(stream.prepare === undefined ? {} : { prepare: workflow(stream.prepare) }),
				...(stream.promote === undefined ? {} : { promote: workflow(stream.promote) }),
			};
		}),
		...(data.actionsRevision === undefined ? {} : { actionsRevision: string(data.actionsRevision) }),
	};
}
function publication(value: unknown): PackagePublication {
	const data = record(value);
	if (data.kind === 'registry') return { kind: 'registry' };
	if (data.kind !== 'excluded') throw new Error('Invalid package publication');
	return { kind: 'excluded', reason: oneOf(data.reason, exclusionReasons, 'Invalid exclusion reason') };
}
function evidence(value: unknown): WorkflowEvidence {
	const data = record(value);
	return {
		file: string(data.file),
		jobs: strings(data.jobs),
		steps: array(data.steps).map(raw => {
			const step = record(raw);
			return { job: string(step.job), id: string(step.id), label: string(step.label) };
		}),
		events: strings(data.events),
		roles: array(data.roles).map(raw => {
			const role = record(raw);
			return { job: string(role.job), stream: string(role.stream), operation: string(role.operation) };
		}),
		preparationJobs: strings(data.preparationJobs),
		reportingJobs: strings(data.reportingJobs),
		prepares: boolean(data.prepares),
		reports: boolean(data.reports),
		publishes: boolean(data.publishes),
	};
}
export function parseSetupPlan(value: unknown): SetupPlan {
	const data = record(value);
	const prior = data.prior === undefined ? undefined : record(data.prior);
	return {
		repository: string(data.repository),
		sourceSha: string(data.sourceSha),
		planId: string(data.planId),
		setupHead: data.setupHead === null ? null : string(data.setupHead),
		choices: choices(data.choices),
		inventory: {
			packages: array(record(data.inventory).packages).map(raw => {
				const pkg = record(raw);
				return { name: string(pkg.name), manifest: string(pkg.manifest), publication: publication(pkg.publication) };
			}),
		},
		packageIds: strings(data.packageIds),
		workflows: array(data.workflows).map(evidence),
		edits: array(data.edits).map(raw => {
			const edit = record(raw);
			return { path: string(edit.path), before: string(edit.before), after: string(edit.after) };
		}),
		blockers: strings(data.blockers),
		notes: strings(data.notes),
		branchConflict: data.branchConflict === true,
		...(prior ? { prior: { url: string(prior.url), superseded: boolean(prior.superseded) } } : {}),
	};
}
