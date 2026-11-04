import { parseDocument } from 'yaml';
import { object, yaml } from '@/automation/managers/helpers';
import { packageId } from '@/automation/package-identity';
import type { SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import type { Package, Snapshot } from '@/automation/types';

export function actionRole(value: unknown): string | undefined {
	if (typeof value !== 'string') return;
	return /^(?:(?:\$|\.)\/actions\/|kjanat\/beepboop\/actions\/)(begin|prepare|report)(?:@[\w./-]+)?$/.exec(value)?.[1];
}
export function workflowEvidence(file: string, source: string): WorkflowEvidence {
	const document = yaml(source), trigger = document.on;
	const result: WorkflowEvidence = {
		file,
		jobs: Object.keys(object(document.jobs)),
		events: typeof trigger === 'string'
			? [trigger]
			: Array.isArray(trigger)
			? trigger.map(String)
			: Object.keys(object(trigger)),
		steps: [],
		roles: [],
		preparationJobs: [],
		reportingJobs: [],
		prepares: false,
		reports: false,
		publishes: false,
	};
	for (const [job, value] of Object.entries(object(document.jobs))) {
		const steps = object(value).steps;
		if (!Array.isArray(steps)) continue;
		for (const entry of steps) {
			const step = object(entry), role = actionRole(step.uses), inputs = object(step.with);
			if (typeof step.id === 'string' && step.run) {
				result.steps.push({ job, id: step.id, label: String(step.name ?? step.id) });
			}
			if (
				role === 'begin' && typeof inputs.stream === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(inputs.stream)
				&& (inputs.operation === 'prepare' || inputs.operation === 'promote')
			) {
				result.roles.push({ job, stream: inputs.stream, operation: inputs.operation });
			}
			if (role === 'prepare') {
				result.prepares = true;
				if (!result.preparationJobs.includes(job)) result.preparationJobs.push(job);
			}
			if (role === 'report') {
				result.reports = true;
				if (!result.reportingJobs.includes(job)) result.reportingJobs.push(job);
			}
			if (
				typeof step.run === 'string'
				&& /\b(?:npm|pnpm|yarn|bun|jsr|cargo)\s+(?:[^\n]*\s)?publish\b|\bgoreleaser\s+release\b/.test(step.run)
			) result.publishes = true;
		}
	}
	return result;
}
// GitHub expression, evaluated by Actions rather than JavaScript.
const executionInput = '$' + '{{ inputs.beepboop_execution_id }}';
const runName = '$' + '{{ inputs.beepboop_title || github.workflow }}';

/** Patch only selected jobs and the dispatch contract; leave other YAML nodes and comments intact. */
export function integrateWorkflow(
	snapshot: Snapshot,
	stream: string,
	operation: 'prepare' | 'promote',
	choice: SetupWorkflow,
	packages: Package[],
	actionsRevision?: string,
	required: string[] = packages.map(packageId),
): { content: string; blockers: string[]; notes: string[] } {
	const path = `.github/workflows/${choice.file}`, original = snapshot.files[path];
	const document = parseDocument(original ?? 'name: Prepare release\non: {}\njobs: {}\n');
	if (document.errors.length) throw new Error(`${choice.file}: invalid YAML`);
	const root = object(document.toJS({ maxAliasCount: 100 })), jobs = object(root.jobs);
	const blockers: string[] = [], notes: string[] = [];
	const fail = (message: string) => blockers.push(`${choice.file}: ${message}`);
	const jobName = choice.job || (Object.keys(jobs).length === 1 ? Object.keys(jobs)[0] : undefined)
		|| (original ? '' : operation);
	if (!jobName || (original && !jobs[jobName])) {
		fail('choose an existing job');
		return { content: original ?? '', blockers, notes };
	}
	const job = object(jobs[jobName]);
	if (job.uses || job.strategy || job.needs || job.if || job.container) {
		fail(
			'reusable, matrix, dependent, conditional or container jobs require explicit workflow integration before setup',
		);
		return { content: original ?? '', blockers, notes };
	}
	const events = typeof root.on === 'string'
		? [root.on]
		: Array.isArray(root.on)
		? root.on.map(String)
		: Object.keys(object(root.on));
	if (events.some(event => event !== 'workflow_dispatch') && choice.triggers !== 'dispatchOnly') {
		fail(
			'choose dispatch-only triggers to hand publication control to Beepboop; preserving automatic publication requires a separate workflow',
		);
	}
	if (
		choice.triggers === 'dispatchOnly' && Object.keys(jobs).length > 1
		&& events.some(event => event !== 'workflow_dispatch')
	) {
		fail('changing triggers would affect other jobs; split the selected job into a dedicated dispatch workflow first');
	}
	const trigger = choice.triggers === 'dispatchOnly' ? {} : object(root.on);
	const dispatch = object(trigger.workflow_dispatch), inputs = object(dispatch.inputs);
	for (const [name, value] of Object.entries(inputs)) {
		if (name !== 'beepboop_execution_id' && object(value).required === true && object(value).default === undefined) {
			fail(`required dispatch input ${name} needs a configured default`);
		}
	}
	if (events.some(event => event !== 'workflow_dispatch') && choice.triggers === 'dispatchOnly') {
		notes.push(`${choice.file}: replaces ${events.join(', ')} triggers with approved dispatches.`);
	}
	document.set('run-name', runName);
	document.set('on', {
		...trigger,
		workflow_dispatch: {
			...dispatch,
			inputs: {
				...inputs,
				beepboop_execution_id: { description: 'Beepboop execution', required: true, type: 'string' },
				beepboop_title: { description: 'Beepboop run title', required: false, type: 'string' },
			},
		},
	});
	const permissions = job.permissions ?? root.permissions;
	if (typeof permissions === 'string') {
		fail('expand permissions to an explicit mapping before integration');
	}
	document.setIn(['jobs', jobName, 'permissions'], {
		...object(permissions),
		contents: object(permissions).contents ?? 'read',
		'id-token': 'write',
	});
	if (!original) document.setIn(['jobs', jobName, 'runs-on'], 'ubuntu-latest');
	let steps = Array.isArray(job.steps) ? job.steps.map(object) : [];
	if (steps.filter(step => actionRole(step.uses) === 'begin').length > 1) {
		fail('multiple begin steps need manual integration');
	}
	if (operation === 'promote' && steps.some(step => actionRole(step.uses) === 'prepare')) {
		fail('a preparation job cannot also be the publication job');
	}
	if (operation === 'prepare' && steps.some(step => actionRole(step.uses) === 'report')) {
		fail('a publication job cannot also be the preparation job');
	}
	const existingBegin = steps.find(step => actionRole(step.uses) === 'begin');
	const id = typeof existingBegin?.id === 'string' ? existingBegin.id : 'beepboop';
	if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) fail('begin action needs a static step ID');
	if (!existingBegin && steps.some(step => step.id === id)) fail(`step ID ${id} is already used`);
	const context = `\u0024{{ steps.${id}.outputs.context }}`;
	const action = (name: string) => {
		// A local integration is evidence, not a repository-name special case.
		if (snapshot.files[`actions/${name}/action.yml`]) {
			return `$/actions/${name}`;
		}
		return `kjanat/beepboop/actions/${name}@${actionsRevision ?? 'v1'}`;
	};
	if (existingBegin) {
		if (object(existingBegin.with).stream !== stream || object(existingBegin.with).operation !== operation) {
			fail('existing begin action belongs to a different stream or operation');
		}
		if (object(existingBegin.with)['execution-id'] !== executionInput) {
			fail('existing begin action must take inputs.beepboop_execution_id');
		}
	} else {
		const checkouts = steps.filter(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'));
		if (checkouts.length > 1 || checkouts.some(step => object(step.with).path || object(step.with).repository)) {
			fail('multiple or non-root checkouts need manual integration');
		}
		const checkout = checkouts[0] ?? { uses: 'actions/checkout@v7' };
		steps = steps.filter(step => !checkouts.includes(step));
		steps.unshift(
			{ uses: checkout.uses, with: { ...object(checkout.with), 'persist-credentials': false } },
			{ uses: action('begin'), id, with: { 'execution-id': executionInput, stream, operation } },
			{
				uses: checkout.uses,
				with: {
					...object(checkout.with),
					ref: `\u0024{{ fromJSON(steps.${id}.outputs.context).sourceSha }}`,
					'persist-credentials': false,
				},
			},
		);
	}
	const beginIndex = steps.findIndex(step => actionRole(step.uses) === 'begin');
	const approvedIndex = steps.findIndex((step, index) =>
		index > beginIndex && typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')
		&& object(step.with).ref === `\u0024{{ fromJSON(steps.${id}.outputs.context).sourceSha }}`
	);
	if (approvedIndex < 0) fail('checkout the execution sourceSha after begin');
	if (operation === 'prepare') {
		const prepareSteps = steps.filter(step => actionRole(step.uses) === 'prepare');
		if (!prepareSteps.length) {
			if (!choice.commands.trim()) fail('supply preparation commands to update lockfiles, build and validate');
			steps.splice(approvedIndex + 1, 0, { uses: action('prepare'), with: { mode: 'apply', context } });
			if (choice.commands.trim()) steps.push({ name: 'Prepare and validate', run: choice.commands });
			steps.push({ uses: action('prepare'), with: { mode: 'submit', context } });
		} else if (
			!prepareSteps.some(step => object(step.with).mode === 'apply' && object(step.with).context === context)
			|| !prepareSteps.some(step => object(step.with).mode === 'submit' && object(step.with).context === context)
		) fail('preparation needs apply and submit steps using the begin context');
	} else if (!steps.some(step => actionRole(step.uses) === 'report')) {
		if (!original && !choice.commands.trim()) fail('supply publication commands');
		if (choice.commands.trim()) {
			if (steps.some(step => step.id === 'beepboop_publish')) fail('step ID beepboop_publish is already used');
			steps.push({ id: 'beepboop_publish', name: 'Publish selected packages', run: choice.commands });
		}
		const publications = packages.map(pkg => {
			const step = choice.publicationSteps[packageId(pkg)] ?? (choice.commands.trim() ? 'beepboop_publish' : '');
			if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(step) || !steps.some(entry => entry.id === step && entry.run)) {
				fail(`select the publishing command step for ${packageId(pkg)}`);
			}
			return {
				id: packageId(pkg),
				manager: pkg.manager,
				name: pkg.name,
				version: `\u0024{{ fromJSON(steps.${id}.outputs.context).version }}`,
				required: required.includes(packageId(pkg)),
				outcome: `\u0024{{ steps.${step}.outcome == 'success' && 'succeeded' || 'failed' }}`,
			};
		});
		steps.push({
			uses: action('report'),
			if: `\u0024{{ !cancelled() && steps.${id}.outcome == 'success' }}`,
			with: {
				'execution-id': `\u0024{{ steps.${id}.outputs.execution-id }}`,
				publications: JSON.stringify(publications),
			},
		});
	}
	const report = steps.find(step => actionRole(step.uses) === 'report');
	if (
		operation === 'promote' && report && (!object(report.with).publications
			|| object(report.with)['execution-id'] !== `\u0024{{ steps.${id}.outputs.execution-id }}`)
	) {
		fail('report must provide publication results and the begin execution ID');
	}
	if (operation === 'prepare') {
		const applyIndex = steps.findIndex(step =>
			actionRole(step.uses) === 'prepare' && object(step.with).mode === 'apply'
		);
		const submitIndex = steps.findIndex(step =>
			actionRole(step.uses) === 'prepare' && object(step.with).mode === 'submit'
		);
		if (applyIndex <= approvedIndex || submitIndex <= applyIndex) {
			fail('preparation must apply after checkout and submit after validation');
		}
	}
	// Only rewrite the steps sequence when inserting integration; existing steps keep comments.
	if (
		!existingBegin || (operation === 'prepare' && !Array.isArray(job.steps))
		|| steps.length !== (Array.isArray(job.steps) ? job.steps.length : 0)
	) document.setIn(['jobs', jobName, 'steps'], steps);
	return { content: document.toString(), blockers, notes };
}
