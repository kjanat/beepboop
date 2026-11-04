import type { Ask, Out, SelectChoice } from '@kjanat/dreamcli';
import { publishable } from '@/automation/package-publication';
import { repositoryReference } from '@/automation/repository-name';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices, SetupPlan, SetupWorkflow } from '@/automation/setup-types';
import type { Client } from '@/cli/client';
import { emit, failure } from '@/cli/output';
import { routes } from '@/contract/routes';
import { packageLabel } from '@/domain/package-label';

function options(entries: SelectChoice[]): [SelectChoice, ...SelectChoice[]] {
	const [first, ...rest] = entries;
	if (!first) throw new Error('No choices available');
	return [first, ...rest];
}
/** Both frontends submit exactly the same policy choices to the preview/apply service. */
export async function chooseSetup(plan: SetupPlan, ask: Ask): Promise<SetupChoices> {
	const choices: SetupChoices = { streams: [] };
	const candidates = plan.inventory.packages.flatMap((pkg, index) =>
		publishable(pkg)
			? [{
				value: plan.packageIds[index] ?? '',
				label: `${packageLabel(plan.packageIds[index] ?? '')} (${pkg.manifest})`,
			}]
			: []
	);
	if (!candidates.length) {
		throw failure('No publishable packages discovered', 'NO_PACKAGES', 'Inspect the repository diagnostics first');
	}
	const chooseWorkflow = async (
		stream: string,
		operation: 'prepare' | 'promote',
		previous?: SetupWorkflow,
	): Promise<SetupWorkflow> => {
		const selected = await ask({
			kind: 'select',
			message: `${stream}: ${operation} workflow${previous ? ` (currently ${previous.file})` : ''}`,
			choices: options([...plan.workflows.map(w => ({ value: w.file, label: `${w.file} (${w.events.join(', ')})` })), {
				value: 'new',
				label: 'Create a workflow',
			}]),
		});
		const file = selected === 'new'
			? await ask({
				kind: 'input',
				message: 'Workflow filename',
				default: `${operation}-${stream}.yml`,
				validate: value => /^[A-Za-z0-9_-]+\.ya?ml$/.test(value) || 'Use a YAML filename',
			})
			: selected;
		const evidence = plan.workflows.find(w => w.file === file);
		const job = evidence
			? await ask({
				kind: 'select',
				message: 'Job to integrate',
				choices: options(evidence.jobs.map(value => ({ value }))),
			})
			: operation;
		const triggers = await ask({
			kind: 'select',
			message: 'Trigger handover',
			choices: [
				{ value: 'review', label: 'Keep unchanged and report conflicts' },
				{ value: 'dispatchOnly', label: 'Replace existing triggers with Beepboop dispatch' },
				{ value: 'preserve', label: 'Preserve existing triggers; block incompatible integration' },
			],
		});
		const integrated = operation === 'prepare'
			? evidence?.preparationJobs.includes(job)
			: evidence?.reportingJobs.includes(job);
		const commands = integrated ? '' : await ask({
			kind: 'input',
			empty: 'accept',
			message: operation === 'prepare'
				? 'Preparation commands (install, update lockfiles, build and test; blank to leave unresolved)'
				: 'Additional publication commands (blank to use existing command steps)',
		});
		const publicationSteps: Record<string, string> = {};
		if (operation === 'promote' && !integrated && !commands) {
			for (const id of choices.streams.find(row => row.name === stream)?.packages ?? []) {
				publicationSteps[id] = await ask({
					kind: 'select',
					message: `Command step publishing ${packageLabel(id)}`,
					choices: options([
						{ value: '', label: 'Unresolved — block apply' },
						...(evidence?.steps.filter(step => step.job === job).map(step => ({ value: step.id, label: step.label }))
							?? []),
					]),
				});
			}
		}
		return { file, job, triggers, commands, publicationSteps };
	};
	for (const proposed of plan.choices.streams) {
		if (!await ask({ kind: 'confirm', message: `Configure stream ${proposed.name}?`, default: true })) continue;
		const stream = { ...proposed };
		stream.packages = await ask({
			kind: 'multiselect',
			message: `${stream.name}: packages (current: ${stream.packages.map(packageLabel).join(', ') || 'none'})`,
			min: 1,
			choices: options(candidates),
		});
		stream.versioning = await ask({
			kind: 'select',
			message: 'Versioning',
			choices: [{ value: 'workspace', label: 'One version for the stream' }, {
				value: 'independent',
				label: 'Independent package versions',
			}, { value: 'none', label: 'No version' }],
		});
		stream.required = stream.packages;
		choices.streams.push(stream);
		stream.prepare = await chooseWorkflow(stream.name, 'prepare', stream.prepare);
		stream.promote = await chooseWorkflow(stream.name, 'promote', stream.promote);
	}
	while (await ask({ kind: 'confirm', message: 'Add another release stream?', default: false })) {
		const name = await ask({
			kind: 'input',
			message: 'Stream name',
			validate: value => /^[a-z][a-z0-9-]{0,63}$/.test(value) || 'Use lowercase letters, numbers and hyphens',
		});
		const packages = await ask({ kind: 'multiselect', message: 'Packages', min: 1, choices: options(candidates) });
		const versioning = await ask({
			kind: 'select',
			message: 'Versioning',
			choices: [{ value: 'workspace' }, { value: 'independent' }, { value: 'none' }],
		});
		const stream: SetupChoices['streams'][number] = { name, packages, versioning, required: packages };
		choices.streams.push(stream);
		stream.prepare = await chooseWorkflow(name, 'prepare');
		stream.promote = await chooseWorkflow(name, 'promote');
	}
	const revision = await ask({
		kind: 'input',
		message: 'Published Beepboop Actions commit (blank for local actions)',
		empty: 'accept',
		validate: value =>
			!value || /^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/.test(value) || 'Use a version tag or a full commit SHA',
	});
	if (revision) choices.actionsRevision = revision;
	return choices;
}
export async function setupRepository(
	client: Client,
	repository: string,
	flags: { choices?: string; plan?: string; apply: boolean; output?: string },
	ask: Ask,
	out: Out,
) {
	if (flags.plan) {
		if (!flags.apply || flags.choices) throw failure('Use --plan with --apply, without --choices', 'INVALID_FLAGS');
		const reviewed = parseSetupPlan(await Bun.file(flags.plan).json());
		const requested = repositoryReference(repository);
		if (
			requested.owner
				? reviewed.repository !== `${requested.owner}/${requested.name}`
				: !reviewed.repository.endsWith(`/${requested.name}`)
		) {
			throw failure('The reviewed plan belongs to another repository', 'PLAN_MISMATCH');
		}
		await emit(
			out,
			await client.call(routes.setupApply, {
				repository,
				choices: reviewed.choices,
				planId: reviewed.planId,
				sourceSha: reviewed.sourceSha,
				setupHead: reviewed.setupHead,
			}),
		);
		return;
	}
	if (flags.apply) throw failure('--apply needs --plan pointing to a reviewed preview', 'PLAN_REQUIRED');
	const initial = parseSetupPlan(await client.call(routes.setupPreview, { repository }));
	const choices: unknown = flags.choices
		? await Bun.file(flags.choices).json()
		: await chooseSetup(initial, ask);
	const preview = await client.call(routes.setupPreview, { repository, choices });
	const plan = parseSetupPlan(preview);
	if (flags.output) await Bun.write(flags.output, `${JSON.stringify(preview, null, 2)}\n`);
	if (out.jsonMode) {
		await emit(out, preview);
		return;
	}
	out.log(`Inspected commit: ${plan.sourceSha}`);
	for (const edit of plan.edits) out.log(`\n${edit.path}\nCurrent:\n${edit.before}\nProposed:\n${edit.after}`);
	for (const message of [...plan.blockers, ...plan.notes]) out.log(message);
	if (plan.blockers.length) {
		out.setExitCode(1);
		return;
	}
	if (!plan.edits.length) {
		out.log('Release setup already matches.');
		return;
	}
	if (
		!flags.choices
		&& await ask({ kind: 'confirm', message: 'Open or refresh the setup PR with these exact changes?', default: false })
	) {
		const result = await client.call(routes.setupApply, {
			repository,
			choices,
			planId: plan.planId,
			sourceSha: plan.sourceSha,
			setupHead: plan.setupHead,
		});
		out.log(result.url);
	}
}
