import { isDeepStrictEqual } from 'node:util';
import { Result } from 'effect';
import type { Document } from 'yaml';
import { isAlias, isMap, isNode, isSeq, parseDocument, visit } from 'yaml';
import { jobNeeds } from '@/automation/job-gate';
import { object, yaml, yamlData } from '@/automation/managers/helpers';
import { packageId } from '@/automation/package-identity';
import { workflowEvents } from '@/automation/release-graph/calls';
import { annotatePins, matchEnding, pinned, renderWorkflow } from '@/automation/setup-actions';
import {
	assetConflicts,
	assetSteps,
	beginJobId,
	binaryJobs,
	buildJobId,
	expression,
	gitIdentity,
	ownedBinaryJob,
	refSteps,
	releaseSteps,
} from '@/automation/setup-binaries';
import { crateOutcome, ledgerCommand, plainCrateNames } from '@/automation/setup-defaults';
import type { SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import type { Package, Snapshot } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { identifierPattern } from '@/contract/ids';
import { ledgerManagers, publishWaitMinutes } from '@/contract/ledger';
import { toDomainError } from '@/failure';

const prepareMinutes = 120;
export function publishMinutes(packages: number): number {
	return Math.min(360, publishWaitMinutes + 60 * packages);
}
export function actionRole(value: unknown): string | undefined {
	if (typeof value !== 'string') return;
	return /^(?:(?:\$|\.)\/actions\/|kjanat\/beepboop\/actions\/)(begin|prepare|report|publish)(?:@[\w./-]+)?$/.exec(
		value,
	)?.[1];
}
export function workflowEvidence(file: string, source: string): Result.Result<WorkflowEvidence, DomainError> {
	return yaml(source).pipe(Result.map(document => evidenceOf(file, document)));
}
/** Why setup cannot patch a job in place; integrate refuses the same jobs. */
export function jobObstacles(jobs: Record<string, unknown>): Record<string, string[]> {
	const result: Record<string, string[]> = Object.create(null);
	for (const [name, value] of Object.entries(jobs)) {
		const job = object(value);
		const needs = jobNeeds(job.needs).filter(need =>
			typeof need !== 'string' || !ownedBinaryJob(need, object(jobs[need]))
		);
		const reasons = [
			...(job.uses ? ['reusable workflow call'] : []),
			...(job.strategy ? ['matrix'] : []),
			...(needs.length ? [`needs ${needs.map(String).join(', ')}`] : []),
			...(job.if ? ['conditional'] : []),
			...(job.container ? ['container'] : []),
		];
		if (reasons.length) result[name] = reasons;
	}
	return result;
}
function evidenceOf(file: string, document: Record<string, unknown>): WorkflowEvidence {
	const result: WorkflowEvidence = {
		file,
		jobs: Object.keys(object(document.jobs)),
		events: workflowEvents(document),
		steps: [],
		roles: [],
		preparationJobs: [],
		reportingJobs: [],
		jobObstacles: jobObstacles(object(document.jobs)),
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
				role === 'begin' && typeof inputs.stream === 'string' && identifierPattern.test(inputs.stream)
				&& typeof inputs.operation === 'string' && identifierPattern.test(inputs.operation)
			) {
				result.roles.push({ job, stream: inputs.stream, operation: inputs.operation });
			}
			if (role === 'prepare') {
				result.prepares = true;
				if (!result.preparationJobs.includes(job)) result.preparationJobs.push(job);
			}
			if (role === 'report' || role === 'publish') {
				result.reports = true;
				if (!result.reportingJobs.includes(job)) result.reportingJobs.push(job);
			}
			if (
				typeof step.run === 'string'
				&& /\b(?:npm|pnpm|yarn|bun|jsr|cargo)\s+(?:[^\n]*\s)?publish\b|\bgoreleaser\s+release\b/.test(step.run)
			) result.publishes = true;
		}
	}
	const reports = (role: WorkflowEvidence['roles'][number]) =>
		role.operation === 'promote' && result.reportingJobs.includes(role.job);
	result.roles = result.roles.filter(role =>
		role.operation !== 'promote' || reports(role)
		|| !result.roles.some(other => other.stream === role.stream && reports(other))
	);
	return result;
}
const executionInput = expression('inputs.beepboop_execution_id');
const runName = expression('inputs.beepboop_title || github.workflow');

/** Patch only selected jobs and the dispatch contract; leave other YAML nodes and comments intact. */
export function integrateWorkflow(
	snapshot: Snapshot,
	stream: string,
	operation: string,
	choice: SetupWorkflow,
	packages: Package[],
	actionsRevision?: string,
	required: string[] = packages.map(packageId),
	release = false,
): Result.Result<Integration, DomainError> {
	const path = `.github/workflows/${choice.file}`, original = snapshot.files[path];
	const document = parseDocument(original ?? `name: ${workflowName(stream, operation)}\non: {}\njobs: {}\n`);
	if (document.errors.length) return Result.fail(precondition(`${choice.file}: invalid YAML`));
	return Result.try({
		try: () =>
			integrate(document, snapshot, original, stream, operation, choice, packages, actionsRevision, required, release),
		catch: toDomainError,
	});
}
function workflowName(stream: string, operation: string): string {
	const named = stream === 'main' ? '' : ` ${stream}`;
	if (operation === 'prepare') return `Prepare${named} release`;
	if (operation === 'promote') return named ? `Publish${named}` : 'Publish packages';
	return `Publish${named} ${operation}`;
}
interface Integration {
	content: string;
	blockers: string[];
	notes: string[];
}

/** One workflow file, dispatched separately for preparation and publication. */
export function integrateReleaseWorkflow(
	snapshot: Snapshot,
	stream: string,
	prepare: SetupWorkflow,
	promote: SetupWorkflow,
	packages: Package[],
	actionsRevision?: string,
	required: string[] = packages.map(packageId),
	published: Package[] = packages,
	release = false,
): Result.Result<Integration, DomainError> {
	return Result.gen(function*() {
		const path = `.github/workflows/${promote.file}`;
		const prepareJob = prepare.job ?? 'prepare', publishJob = promote.job ?? 'publish';
		const fail = (message: string): Integration => ({
			content: snapshot.files[path] ?? '',
			blockers: [`${promote.file}: ${message}`],
			notes: [],
		});
		if (prepare.file !== promote.file || prepareJob === publishJob) {
			return fail('preparation and publication need different jobs');
		}
		const gate = (operation: 'prepare' | 'promote') =>
			`\u0024{{ inputs.beepboop_operation == '${operation === 'promote' ? 'publish' : operation}' }}`;
		const document = parseDocument(snapshot.files[path] ?? 'name: Release\non: {}\njobs: {}\n');
		if (document.errors.length) return fail('invalid YAML');
		const existing = snapshot.files[path] !== undefined;
		const raw = yield* Result.try({ try: () => object(yamlData(document)), catch: toDomainError });
		const jobs = object(raw.jobs);
		const built = Object.keys(jobs).filter(name => ownedBinaryJob(name, object(jobs[name])));
		if (
			existing && (Object.keys(jobs).length - built.length !== 2
				|| object(jobs[prepareJob]).if !== gate('prepare') || object(jobs[publishJob]).if !== gate('promote')
				|| Object.keys(object(raw.on)).some(event => event !== 'workflow_dispatch'))
		) {
			return fail('shared workflows need separate preparation and publication jobs guarded by beepboop_operation');
		}
		for (const job of [prepareJob, publishJob]) {
			if (!existing) document.setIn(['jobs', job], document.createNode({ 'runs-on': 'ubuntu-latest', steps: [] }));
			else document.deleteIn(['jobs', job, 'if']);
		}
		const jobsNode = document.get('jobs', true);
		if (!existing && isMap(jobsNode)) jobsNode.flow = false;
		let source = matchEnding(renderWorkflow(document), snapshot.files[path]);
		const blockers: string[] = [], notes: string[] = [];
		for (const [operation, choice] of [['prepare', prepare], ['promote', promote]] as const) {
			const result = yield* integrateWorkflow(
				{ ...snapshot, files: { ...snapshot.files, [path]: source } },
				stream,
				operation,
				{ ...choice, job: operation === 'prepare' ? prepareJob : publishJob, triggers: 'review' },
				operation === 'prepare' ? packages : published,
				actionsRevision,
				required,
				operation === 'promote' && release,
			);
			source = result.content;
			blockers.push(...result.blockers);
			notes.push(...result.notes);
		}
		const combined = parseDocument(source);
		combined.setIn(['on', 'workflow_dispatch', 'inputs', 'beepboop_operation'], {
			description: 'Release step',
			type: 'choice',
			options: ['prepare', 'publish'],
			default: 'publish',
			required: true,
		});
		combined.setIn(['jobs', prepareJob, 'if'], gate('prepare'));
		combined.setIn(['jobs', publishJob, 'if'], gate('promote'));
		for (const name of promote.binaries ? [beginJobId, ...promote.binaries.builds.map(buildJobId)] : []) {
			combined.setIn(['jobs', name, 'if'], gate('promote'));
		}
		return { content: matchEnding(renderWorkflow(combined), snapshot.files[path]), blockers, notes };
	});
}
const migratableKeys = ['id', 'name', 'run', 'if', 'env', 'continue-on-error', 'timeout-minutes'];
const carriedKeys = ['if', 'continue-on-error', 'timeout-minutes'];
function migratedSettings(
	step: Record<string, unknown>,
	credentialNames: string[],
): Record<string, unknown> | undefined {
	if (Object.keys(step).some(key => !migratableKeys.includes(key))) return undefined;
	const entries = Object.entries(object(step.env));
	const fromCredentials = (value: unknown) =>
		typeof value === 'string' && value.includes('steps.beepboop_credentials.');
	if (!entries.every(([name, value]) => !fromCredentials(value) || credentialNames.includes(name))) return undefined;
	const env = entries.filter(([, value]) => !fromCredentials(value));
	return {
		...Object.fromEntries(carriedKeys.flatMap(key => step[key] === undefined ? [] : [[key, step[key]]])),
		...(env.length ? { env: Object.fromEntries(env) } : {}),
	};
}
function publicationEntries(value: unknown): { id?: unknown }[] | undefined {
	if (value === undefined || value === '') return [];
	if (typeof value !== 'string') return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) && parsed.every(entry => typeof entry === 'object' && entry !== null)
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}
function anchorsAndAliases(node: unknown): { anchors: string[]; aliases: string[] } {
	const found: { anchors: string[]; aliases: string[] } = { anchors: [], aliases: [] };
	if (!isNode(node)) return found;
	visit(node, {
		Node(_, entry) {
			if (isAlias(entry)) found.aliases.push(entry.source);
			else if (isNode(entry) && entry.anchor) found.anchors.push(entry.anchor);
		},
	});
	return found;
}
function setSteps(document: Document, jobName: string, steps: Record<string, unknown>[], previous: unknown): void {
	const path = ['jobs', jobName, 'steps'];
	const sequence = document.getIn(path, true);
	if (!isSeq(sequence) || !Array.isArray(previous)) {
		document.setIn(path, steps);
		return;
	}
	const nodes = sequence.items, taken = new Set<number>();
	const matches = steps.map(step => {
		const index = previous.findIndex((entry, at) => !taken.has(at) && isDeepStrictEqual(entry, step));
		if (index >= 0 && index < nodes.length) taken.add(index);
		return index >= 0 && index < nodes.length ? index : undefined;
	});
	const lost = new Set(nodes.flatMap((node, at) => taken.has(at) ? [] : anchorsAndAliases(node).anchors));
	let settled = false;
	while (!settled) {
		settled = true;
		for (const [position, index] of matches.entries()) {
			if (index === undefined) continue;
			const { anchors, aliases } = anchorsAndAliases(nodes[index]);
			if (!aliases.some(name => lost.has(name))) continue;
			matches[position] = undefined;
			for (const name of anchors) lost.add(name);
			settled = false;
		}
	}
	sequence.items = steps.map((step, position) => {
		const index = matches[position];
		return index === undefined ? document.createNode(step) : nodes[index];
	});
}
function integrate(
	document: Document.Parsed,
	snapshot: Snapshot,
	original: string | undefined,
	stream: string,
	operation: string,
	choice: SetupWorkflow,
	packages: Package[],
	actionsRevision: string | undefined,
	required: string[],
	release: boolean,
): Integration {
	const root = object(yamlData(document)), jobs = object(root.jobs);
	const blockers: string[] = [], notes: string[] = [];
	const fail = (message: string) => blockers.push(`${choice.file}: ${message}`);
	const jobName = choice.job || (Object.keys(jobs).length === 1 ? Object.keys(jobs)[0] : undefined)
		|| (original ? '' : operation);
	if (!jobName || (original && !jobs[jobName])) {
		fail('choose an existing job');
		return { content: original ?? '', blockers, notes };
	}
	const job = object(jobs[jobName]);
	const binaries = choice.binaries;
	if (binaries && operation !== 'promote') {
		fail('binary builds belong to the publication workflow');
		return { content: original ?? '', blockers, notes };
	}
	const jobsNode = document.get('jobs', true), jobsMap = isMap(jobsNode) ? jobsNode : undefined;
	if (binaries && !jobsMap) {
		fail('jobs must be a plain mapping, not an alias');
		return { content: original ?? '', blockers, notes };
	}
	const buildJobs = binaries?.builds.map(buildJobId) ?? [];
	const binaryJobIds = binaries ? [beginJobId, ...buildJobs] : [];
	if (binaryJobIds.includes(jobName)) {
		fail(`job ${jobName} conflicts with a binary build job`);
		return { content: original ?? '', blockers, notes };
	}
	for (const name of binaryJobIds) {
		if (jobs[name] !== undefined && !ownedBinaryJob(name, object(jobs[name]))) {
			fail(`job ${name} already exists and is not a Beepboop binary build`);
		}
	}
	for (const conflict of binaries ? assetConflicts(binaries) : []) fail(conflict);
	const stale = binaries || operation !== 'promote'
		? []
		: Object.keys(jobs).filter(name => name !== jobName && ownedBinaryJob(name, object(jobs[name])));
	for (const name of stale) document.deleteIn(['jobs', name]);
	const needs = jobNeeds(job.needs).filter(need => typeof need !== 'string' || !stale.includes(need));
	if (stale.length && !needs.length) document.deleteIn(['jobs', jobName, 'needs']);
	else if (stale.length) document.setIn(['jobs', jobName, 'needs'], needs);
	const buildNeeds = needs.length > 0 && needs.every(need => typeof need === 'string' && buildJobs.includes(need));
	if (job.uses || job.strategy || (needs.length && !buildNeeds) || job.if || job.container) {
		fail(
			'reusable, matrix, dependent, conditional or container jobs require explicit workflow integration before setup',
		);
		return { content: original ?? '', blockers, notes };
	}
	const events = workflowEvents(root);
	if (events.some(event => event !== 'workflow_dispatch') && choice.triggers !== 'dispatchOnly') {
		fail(
			'set existingTriggers to replace-with-dispatch to hand publication control to Beepboop; preserving automatic publication requires a separate workflow',
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
		notes.push(`${choice.file}: replaces ${events.join(', ')} triggers with Beepboop dispatches.`);
	}
	const existingId = object(inputs.beepboop_execution_id), existingTitle = object(inputs.beepboop_title);
	document.set('run-name', runName);
	document.set('on', {
		...trigger,
		workflow_dispatch: {
			...dispatch,
			inputs: {
				...inputs,
				beepboop_execution_id: existingId.type === 'string' && existingId.required === true
					? existingId
					: { description: 'Beepboop execution', required: true, type: 'string' },
				beepboop_title: existingTitle.type === 'string' && existingTitle.required !== true
					? existingTitle
					: { description: 'Beepboop run title', required: false, type: 'string' },
			},
		},
	});
	const permissions = job.permissions ?? root.permissions;
	if (typeof permissions === 'string') {
		fail('expand permissions to an explicit mapping before integration');
	}
	const granted = object(permissions);
	if (granted['id-token'] !== 'write' || granted.contents === undefined) {
		document.setIn(['jobs', jobName, 'permissions'], {
			...granted,
			contents: granted.contents ?? 'read',
			'id-token': 'write',
		});
	}
	if (!original) document.setIn(['jobs', jobName, 'runs-on'], 'ubuntu-latest');
	let steps = Array.isArray(job.steps) ? job.steps.map(object) : [];
	const uploaded = steps.findIndex(step => step.id === 'beepboop_binaries');
	if (!binaries && operation === 'promote' && uploaded >= 0) {
		const download = steps.findIndex(step =>
			typeof step.uses === 'string' && /^actions\/download-artifact@/.test(step.uses)
		);
		const start = download >= 0 && download < uploaded ? download : uploaded;
		steps.splice(start, uploaded - start + 1);
	}
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
		if (['action.yml', 'action.yaml'].some(file => snapshot.files[`actions/${name}/${file}`])) {
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
		const checkout = checkouts[0] ?? {};
		steps = steps.filter(step => !checkouts.includes(step));
		steps.unshift(
			{ uses: pinned('checkout'), with: { ...object(checkout.with), 'persist-credentials': false } },
			{ uses: action('begin'), id, with: { 'execution-id': executionInput, stream, operation } },
			{
				uses: pinned('checkout'),
				with: {
					...object(checkout.with),
					ref: `\u0024{{ fromJSON(steps.${id}.outputs.context).sourceSha }}`,
					'persist-credentials': false,
				},
			},
		);
	}
	const beginIndex = steps.findIndex(step => actionRole(step.uses) === 'begin');
	const sourceRef = `\u0024{{ fromJSON(steps.${id}.outputs.context).sourceSha }}`;
	if (
		existingBegin
		&& !steps.some((step, index) =>
			index > beginIndex && typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')
			&& object(step.with).ref === sourceRef
		)
	) {
		const checkouts = steps.filter(step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'));
		if (steps.slice(0, beginIndex).some(step => !checkouts.includes(step))) {
			fail(
				'steps before begin need explicit integration; prepare dependencies and build output after the planned checkout',
			);
			return { content: original ?? '', blockers, notes };
		}
		if (
			checkouts.length <= 1 && checkouts.every(step => {
				const inputs = object(step.with);
				return !inputs.path && !inputs.repository && !inputs.ref;
			})
		) {
			const checkout = checkouts[0] ?? {};
			const bootstrap = {
				...checkout,
				uses: pinned('checkout'),
				with: { ...object(checkout.with), 'persist-credentials': false },
			};
			const checkoutIndex = steps.indexOf(checkout);
			if (checkoutIndex >= 0 && checkoutIndex < beginIndex) steps[checkoutIndex] = bootstrap;
			else {
				steps = steps.filter(step => step !== checkout);
				steps.splice(steps.indexOf(existingBegin), 0, bootstrap);
			}
			steps.splice(steps.indexOf(existingBegin) + 1, 0, {
				uses: pinned('checkout'),
				with: { ...object(checkout.with), ref: sourceRef, 'persist-credentials': false },
			});
			notes.push(`${choice.file}: checks out the planned release commit after the existing begin step.`);
		}
	}
	const integratedBeginIndex = steps.findIndex(step => actionRole(step.uses) === 'begin');
	const approvedIndex = steps.findIndex((step, index) =>
		index > integratedBeginIndex && typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@')
		&& object(step.with).ref === sourceRef
	);
	if (approvedIndex < 0) fail('checkout the execution sourceSha after begin');
	const credentials = choice.credentials ?? {}, aliases = [...new Set(Object.values(credentials))];
	const mise =
		['mise.toml', '.mise.toml', '.config/mise.toml', '.tool-versions'].some(path => snapshot.files[path] !== undefined)
		&& !steps.some(step => typeof step.uses === 'string' && step.uses.startsWith('jdx/mise-action@'));
	const commandSteps = (step: Record<string, unknown>): Record<string, unknown>[] => {
		const toolchain = mise ? [{ uses: pinned('mise') }] : [];
		const script = typeof step.run === 'string' && step.run.includes('\n') && !step.run.endsWith('\n')
			? { ...step, run: `${step.run}\n` }
			: step;
		if (!aliases.length) return [...toolchain, script];
		if (steps.some(entry => entry.id === 'beepboop_credentials')) fail('step ID beepboop_credentials is already used');
		return [
			...toolchain,
			{
				id: 'beepboop_credentials',
				uses: action('credentials'),
				with: { 'execution-id': `\${{ steps.${id}.outputs.execution-id }}`, aliases: JSON.stringify(aliases) },
			},
			{
				...script,
				env: Object.fromEntries(
					Object.entries(credentials).map(([name, alias]) => [
						name,
						`\${{ fromJSON(steps.beepboop_credentials.outputs.values)['${alias}'] }}`,
					]),
				),
			},
		];
	};
	const plainStep = operation !== 'prepare' && choice.commands.trim() === ledgerCommand
		? steps.findIndex(step =>
			step.id === 'beepboop_publish' && typeof step.run === 'string' && plainCrateNames(step.run)
		)
		: -1;
	const carried = plainStep >= 0 ? migratedSettings(object(steps[plainStep]), Object.keys(credentials)) : undefined;
	if (plainStep >= 0 && carried) {
		const crates = packages.filter(pkg => pkg.manager === 'cargo').map(pkg => pkg.name).sort();
		const named = plainCrateNames(String(steps[plainStep]?.run))?.sort();
		if (named && crates.length === named.length && crates.every((name, index) => name === named[index])) {
			const recorded = new Set(
				packages.filter(pkg =>
					!choice.publicationSteps[packageId(pkg)] && ledgerManagers.some(manager => manager === pkg.manager)
				)
					.map(packageId),
			);
			const migrated = steps.flatMap((step, index) => {
				if (index === plainStep) {
					return [{
						id: 'beepboop_publish',
						name: 'Publish selected packages',
						...carried,
						uses: action('publish'),
						with: {
							'execution-id': `\${{ steps.${id}.outputs.execution-id }}`,
							...(aliases.length ? { credentials: JSON.stringify(credentials) } : {}),
						},
					}];
				}
				if (actionRole(step.uses) !== 'report') return [step];
				const reported = object(step.with);
				const results = publicationEntries(reported.publications);
				if (!results) return [step];
				const kept = results.filter(entry => !(typeof entry.id === 'string' && recorded.has(entry.id)));
				return kept.length || reported.artifacts
					? [{ ...step, with: { ...reported, publications: `${JSON.stringify(kept, null, 2)}\n` } }]
					: [];
			});
			steps = migrated.filter(step =>
				step.id !== 'beepboop_credentials'
				|| migrated.some(other => other !== step && JSON.stringify(other).includes('steps.beepboop_credentials.'))
			);
		}
	}
	if (operation === 'prepare') {
		const prepareSteps = steps.filter(step => actionRole(step.uses) === 'prepare');
		if (!prepareSteps.length) {
			if (!choice.commands.trim()) fail('supply preparation commands to update lockfiles, build and validate');
			steps.splice(approvedIndex + 1, 0, { uses: action('prepare'), with: { mode: 'apply', context } });
			if (choice.commands.trim()) steps.push(...commandSteps({ name: 'Prepare and validate', run: choice.commands }));
			steps.push({ uses: action('prepare'), with: { mode: 'submit', context } });
		} else if (
			!prepareSteps.some(step => object(step.with).mode === 'apply' && object(step.with).context === context)
			|| !prepareSteps.some(step => object(step.with).mode === 'submit' && object(step.with).context === context)
		) fail('preparation needs apply and submit steps using the begin context');
	} else if (binaries && steps.some(step => ['report', 'publish'].includes(actionRole(step.uses) ?? ''))) {
		const uses = (pattern: RegExp) => steps.findIndex(step => typeof step.uses === 'string' && pattern.test(step.uses));
		const download = uses(/^actions\/download-artifact@/), release = uses(/\/actions\/publish-release\b/);
		const tagging = steps.findIndex(step =>
			typeof step.uses === 'string' && /\/actions\/(?:token|publish-refs|publish-release)\b/.test(step.uses)
		);
		const report = steps.findIndex(step => actionRole(step.uses) === 'report');
		if (steps.some(step => step.id === 'beepboop_binaries')) {
			if (download >= 0 && download < release) {
				steps.splice(download, release - download + 1, ...releaseSteps(id, action));
			}
		} else if (tagging >= 0) {
			steps.splice(tagging, 0, ...assetSteps(id));
		} else {
			const published = steps.findIndex(step => actionRole(step.uses) === 'publish');
			steps.splice(report >= 0 ? report : published + 1, 0, ...releaseSteps(id, action));
		}
	} else if (!steps.some(step => ['report', 'publish'].includes(actionRole(step.uses) ?? ''))) {
		if (!original && !choice.commands.trim() && !binaries && !choice.tagPrefix) fail('supply publication commands');
		const ledger = choice.commands.trim() === ledgerCommand;
		if (choice.commands.trim()) {
			if (steps.some(step => step.id === 'beepboop_publish')) fail('step ID beepboop_publish is already used');
			steps.push(
				...(ledger
					? [...(mise ? [{ uses: pinned('mise') }] : []), {
						id: 'beepboop_publish',
						name: 'Publish selected packages',
						uses: action('publish'),
						with: {
							'execution-id': `\${{ steps.${id}.outputs.execution-id }}`,
							...(aliases.length ? { credentials: JSON.stringify(credentials) } : {}),
						},
					}]
					: commandSteps({ id: 'beepboop_publish', name: 'Publish selected packages', run: choice.commands })),
			);
		}
		if (binaries) steps.push(...releaseSteps(id, action));
		else if (choice.tagPrefix) steps.push(...refSteps(id, action));
		const tagged = (pkg: Package) => pkg.manager === 'go' && (binaries !== undefined || choice.tagPrefix !== undefined);
		const recorded = (pkg: Package) =>
			ledger && !choice.publicationSteps[packageId(pkg)] && ledgerManagers.some(manager => manager === pkg.manager);
		const publications = packages.filter(pkg => !recorded(pkg)).map(pkg => {
			const step = choice.publicationSteps[packageId(pkg)]
				?? (tagged(pkg) ? 'beepboop_refs' : choice.commands.trim() ? 'beepboop_publish' : '');
			if (
				!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(step)
				|| !steps.some(entry => entry.id === step && (entry.run || step === 'beepboop_refs'))
			) {
				fail(`select the publishing command step for ${packageId(pkg)}`);
			}
			return {
				id: packageId(pkg),
				manager: pkg.manager,
				name: pkg.name,
				version: `\u0024{{ fromJSON(steps.${id}.outputs.context).version }}`,
				required: required.includes(packageId(pkg)),
				outcome: step === 'beepboop_publish' && crateOutcome(choice.commands, pkg.name)
					? `\u0024{{ steps.${step}.outputs['${pkg.name}'] == 'succeeded' && 'succeeded' || 'failed' }}`
					: `\u0024{{ steps.${step}.outcome == 'success' && 'succeeded' || 'failed' }}`,
			};
		});
		if (!ledger || publications.length) {
			steps.push({
				uses: action('report'),
				if: `\u0024{{ !cancelled() && steps.${id}.outcome == 'success' }}`,
				with: {
					'execution-id': `\u0024{{ steps.${id}.outputs.execution-id }}`,
					publications: `${JSON.stringify(publications, null, 2)}\n`,
				},
			});
		}
	}
	if (
		operation === 'promote' && choice.tagPrefix && !binaries
		&& !steps.some(step => typeof step.uses === 'string' && /\/actions\/publish-refs\b/.test(step.uses))
	) {
		const reportIndex = steps.findIndex(step => actionRole(step.uses) === 'report');
		steps.splice(reportIndex < 0 ? steps.length : reportIndex, 0, ...refSteps(id, action));
	}
	steps = steps.map(step => {
		if (typeof step.uses !== 'string' || !/\/actions\/publish-refs\b/.test(step.uses)) return step;
		const env = object(step.env);
		const source = /^\$\{\{\s*steps\.([A-Za-z_][\w-]*)\.outputs\.token\s*\}\}$/.exec(String(object(step.with).token))
			?.[1];
		const issued = steps.some(entry =>
			entry.id === source && typeof entry.uses === 'string'
			&& /^(?:(?:\$|\.)\/actions\/|kjanat\/beepboop\/actions\/)token(?:@[\w./-]+)?$/.test(entry.uses)
		);
		const insert = (key: string) => /^\$\{\{\s*insert\s*\}\}$/.test(key);
		const stale = (key: string) =>
			insert(key) && /^\$\{\{\s*fromJSON\(steps\.[A-Za-z_][\w-]*\.outputs\.gitId\)\s*\}\}$/.test(String(env[key]));
		const identified = Object.keys(env).some(key => (insert(key) && !stale(key)) || key === 'GIT_COMMITTER_NAME');
		if (!source || !issued || identified) return step;
		const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !stale(key)));
		return { ...step, env: { ...kept, ...gitIdentity(source) } };
	});
	const refs = steps.findIndex(step => typeof step.uses === 'string' && /\/actions\/publish-refs\b/.test(step.uses));
	if (
		operation === 'promote' && release && refs >= 0
		&& !steps.some(step => typeof step.uses === 'string' && /\/actions\/publish-release\b/.test(step.uses))
	) {
		steps.splice(refs + 1, 0, {
			uses: action('publish-release'),
			with: { 'execution-id': `\u0024{{ steps.${id}.outputs.execution-id }}` },
		});
	}
	if (
		aliases.length && !steps.some(step => step.id === 'beepboop_credentials' || actionRole(step.uses) === 'publish')
	) {
		fail('credentials need setup commands to receive them, or a beepboop_credentials step in the job');
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
	// Only rewrite the steps sequence when integration changes it; existing steps keep comments.
	if (!existingBegin || !isDeepStrictEqual(steps, job.steps)) setSteps(document, jobName, steps, job.steps);
	if (jobsMap && (!original || binaries)) jobsMap.flow = false;
	if (binaries && jobsMap) {
		const begin = { uses: action('begin'), id, with: { 'execution-id': executionInput, stream, operation } };
		const builds = binaryJobs(binaries, begin, id);
		for (const [name, build] of Object.entries(builds)) {
			const kept = object(jobs[name])['timeout-minutes'];
			if (kept !== undefined) build['timeout-minutes'] = kept;
			jobsMap.delete(name);
		}
		jobsMap.items.unshift(
			...Object.entries(builds).map(([name, build]) => {
				const pair = document.createPair(name, build, { aliasDuplicateObjects: false });
				if (isNode(pair.value)) {
					visit(pair.value, {
						Scalar(_, scalar) {
							if (typeof scalar.value === 'string' && scalar.value.includes('\n')) scalar.type = 'BLOCK_LITERAL';
						},
					});
				}
				return pair;
			}),
		);
		document.setIn(['jobs', jobName, 'needs'], buildJobs);
		document.setIn(['jobs', jobName, 'permissions'], {
			...granted,
			contents: 'write',
			'id-token': 'write',
			attestations: 'write',
		});
	}
	if (!blockers.length && job['timeout-minutes'] === undefined) {
		document.setIn(
			['jobs', jobName, 'timeout-minutes'],
			operation === 'prepare' ? prepareMinutes : publishMinutes(packages.length),
		);
	}
	const unchanged = original !== undefined
		&& isDeepStrictEqual(yamlData(parseDocument(original)), yamlData(document));
	return {
		content: unchanged ? original : matchEnding(annotatePins(renderWorkflow(document)), original),
		blockers,
		notes,
	};
}
