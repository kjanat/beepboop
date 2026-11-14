import { object } from '@/automation/managers/helpers';
import {
	forwardInput,
	inputDefaults,
	literalBindings,
	matrixCombinations,
	staticGuard,
} from '@/automation/release-graph/bindings';
import { callLimit, liveJobs, ownWorkflow, workflowDocuments } from '@/automation/release-graph/calls';
import type { Job } from '@/automation/release-graph/workflows';
import { buildJob } from '@/automation/release-graph/workflows';
import type { Snapshot } from '@/automation/types';

export interface PublishingJob {
	file: string;
	path: string;
	document: Record<string, unknown>;
	raw: Record<string, unknown>;
	job: Job;
	oidc: boolean;
	secret(name: string): string | undefined;
}

function bind(value: unknown, inputs: Record<string, string>, matrix: Record<string, string>): unknown {
	if (Array.isArray(value)) return value.map(entry => bind(entry, inputs, matrix));
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, bind(entry, inputs, matrix)]));
	}
	return forwardInput(value, inputs, matrix);
}

const secretReference = /^\s*\$\{\{\s*secrets(?:\.([\w]+)|\[['"]([\w]+)['"]\])\s*\}\}\s*$/;

export function publishingJobs(snapshot: Snapshot, root: string): { jobs: PublishingJob[]; failures: string[] } {
	const documents = new Map(workflowDocuments(Object.entries(snapshot.files)).map(doc => [doc.file, doc]));
	const jobs: PublishingJob[] = [], failures: string[] = [];
	let visits = 0;
	const visit = (
		file: string,
		inputs: Record<string, string>,
		secret: PublishingJob['secret'],
		ceiling: boolean,
		inherited: boolean,
		trail: string[],
	) => {
		if (++visits > callLimit || trail.includes(file)) {
			failures.push(`Reusable workflow traversal cannot inspect ${[...trail, file].join(' → ')} (cycle or limit).`);
			return;
		}
		const entry = documents.get(file);
		if (!entry) {
			failures.push(`Reusable workflow ${file} is missing from the inspected revision.`);
			return;
		}
		const document = object(bind(entry.document, inputs, {}));
		for (const [id, original] of liveJobs(document)) {
			const matrix = matrixCombinations(object(object(original.strategy).matrix));
			for (const assignment of matrix.length ? matrix : [{}]) {
				if (staticGuard(original.if, { inputs, matrix: assignment }) === false) continue;
				const raw = object(bind(original, inputs, assignment));
				delete raw.strategy;
				const permissions = raw.permissions ?? document.permissions;
				const oidc = ceiling && (permissions === undefined
					? inherited
					: permissions === 'write-all' || object(permissions)['id-token'] === 'write');
				if (typeof raw.uses === 'string') {
					const target = ownWorkflow(raw.uses, snapshot.repository.name);
					if (!target || (target.ref && target.ref !== snapshot.sha)) {
						failures.push(`Cannot inspect reusable workflow ${raw.uses} from this repository revision.`);
						continue;
					}
					const callee = documents.get(target.file);
					const supplied = object(raw.with);
					const bindings = {
						...inputDefaults(object(object(callee?.document.on).workflow_call).inputs, Object.keys(supplied)),
						...literalBindings(supplied),
					};
					const forwarded: PublishingJob['secret'] = raw.secrets === 'inherit' ? secret : name => {
						const value = object(raw.secrets)[name];
						const match = typeof value === 'string' ? secretReference.exec(value) : null;
						const source = match?.[1] ?? match?.[2];
						return source ? secret(source) : undefined;
					};
					visit(target.file, bindings, forwarded, oidc, oidc, [...trail, file]);
					continue;
				}
				const job = buildJob(snapshot, entry.path, document, id, raw, inputs);
				if (job.effects.some(effect => effect.kind === 'publish' && effect.destination === 'crates-io')) {
					jobs.push({ file, path: [...trail, file, id].join(' / '), document, raw, job, oidc, secret });
				}
			}
		}
	};
	visit(root, {}, name => name, true, false, []);
	return { jobs, failures };
}
