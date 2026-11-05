import type { Ask, CLIError, Out, SelectChoice } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { publishable } from '@/automation/package-publication';
import { repositoryReference } from '@/automation/repository-name';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices, SetupPlan, SetupWorkflow } from '@/automation/setup-types';
import type { Client } from '@/cli/client';
import { emit, failure } from '@/cli/output';
import { routes } from '@/contract/routes';
import { packageLabel } from '@/domain/package-label';

function options(entries: SelectChoice[]): Effect.Effect<[SelectChoice, ...SelectChoice[]], CLIError> {
	const [first, ...rest] = entries;
	return first ? Effect.succeed([first, ...rest]) : Effect.fail(failure('No choices available', 'NO_CHOICES'));
}
function readJson(path: string): Effect.Effect<unknown, CLIError> {
	return Effect.tryPromise({
		try: (): Promise<unknown> => Bun.file(path).json(),
		catch: () => failure(`${path} is not readable JSON`, 'INVALID_FILE'),
	});
}
function parsePlan(value: unknown): Effect.Effect<SetupPlan, CLIError> {
	return parseSetupPlan(value).pipe(Effect.mapError(error => failure(error.message, 'INVALID_PLAN')));
}
/** Both frontends submit exactly the same policy choices to the preview/apply service. */
export function chooseSetup(plan: SetupPlan, ask: Ask): Effect.Effect<SetupChoices, CLIError> {
	return Effect.gen(function*() {
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
			return yield* Effect.fail(
				failure('No publishable packages discovered', 'NO_PACKAGES', 'Inspect the repository diagnostics first'),
			);
		}
		const packageChoices = yield* options(candidates);
		const chooseWorkflow = (
			stream: string,
			operation: 'prepare' | 'promote',
			previous?: SetupWorkflow,
		): Effect.Effect<SetupWorkflow | undefined, CLIError> =>
			Effect.gen(function*() {
				const workflowChoices = yield* options([
					...(operation === 'prepare' ? [{ value: 'managed', label: 'Beepboop prepares the PR (no workflow)' }] : []),
					...plan.workflows.map(w => ({ value: w.file, label: `${w.file} (${w.events.join(', ')})` })),
					{ value: 'new', label: 'Create a workflow' },
				]);
				const selected = yield* Effect.promise(() =>
					ask({
						kind: 'select',
						message: `${stream}: ${operation} workflow${previous ? ` (currently ${previous.file})` : ''}`,
						choices: workflowChoices,
					})
				);
				if (selected === 'managed') return undefined;
				const file = selected === 'new'
					? yield* Effect.promise(() =>
						ask({
							kind: 'input',
							message: 'Workflow filename',
							default: `${operation}-${stream}.yml`,
							validate: value => /^[A-Za-z0-9_-]+\.ya?ml$/.test(value) || 'Use a YAML filename',
						})
					)
					: selected;
				const evidence = plan.workflows.find(w => w.file === file);
				const jobChoices = evidence ? yield* options(evidence.jobs.map(value => ({ value }))) : undefined;
				const job = jobChoices
					? yield* Effect.promise(() => ask({ kind: 'select', message: 'Job to integrate', choices: jobChoices }))
					: operation;
				const triggers = yield* Effect.promise(() =>
					ask({
						kind: 'select',
						message: 'Trigger handover',
						choices: [
							{ value: 'review', label: 'Keep unchanged and report conflicts' },
							{ value: 'dispatchOnly', label: 'Replace existing triggers with Beepboop dispatch' },
							{ value: 'preserve', label: 'Preserve existing triggers; block incompatible integration' },
						],
					})
				);
				const integrated = operation === 'prepare'
					? evidence?.preparationJobs.includes(job)
					: evidence?.reportingJobs.includes(job);
				const commands = integrated ? '' : yield* Effect.promise(() =>
					ask({
						kind: 'input',
						empty: 'accept',
						message: operation === 'prepare'
							? 'Preparation commands (install, update lockfiles, build and test; blank to leave unresolved)'
							: 'Additional publication commands (blank to use existing command steps)',
					})
				);
				const publicationSteps: Record<string, string> = {};
				if (operation === 'promote' && !integrated && !commands) {
					for (const id of choices.streams.find(row => row.name === stream)?.packages ?? []) {
						const stepChoices = yield* options([
							{ value: '', label: 'Unresolved — block apply' },
							...(evidence?.steps.filter(step => step.job === job).map(step => ({
								value: step.id,
								label: step.label,
							})) ?? []),
						]);
						publicationSteps[id] = yield* Effect.promise(() =>
							ask({ kind: 'select', message: `Command step publishing ${packageLabel(id)}`, choices: stepChoices })
						);
					}
				}
				return { file, job, triggers, commands, publicationSteps };
			});
		for (const proposed of plan.choices.streams) {
			const configure = yield* Effect.promise(() =>
				ask({ kind: 'confirm', message: `Configure stream ${proposed.name}?`, default: true })
			);
			if (!configure) continue;
			const stream = { ...proposed };
			stream.packages = yield* Effect.promise(() =>
				ask({
					kind: 'multiselect',
					message: `${stream.name}: packages (current: ${stream.packages.map(packageLabel).join(', ') || 'none'})`,
					min: 1,
					choices: packageChoices,
				})
			);
			stream.versioning = yield* Effect.promise(() =>
				ask({
					kind: 'select',
					message: 'Versioning',
					choices: [{ value: 'workspace', label: 'One version for the stream' }, {
						value: 'independent',
						label: 'Independent package versions',
					}, { value: 'none', label: 'No version' }],
				})
			);
			stream.required = stream.packages;
			choices.streams.push(stream);
			stream.prepare = yield* chooseWorkflow(stream.name, 'prepare', stream.prepare);
			stream.promote = yield* chooseWorkflow(stream.name, 'promote', stream.promote);
		}
		while (
			yield* Effect.promise(() => ask({ kind: 'confirm', message: 'Add another release stream?', default: false }))
		) {
			const name = yield* Effect.promise(() =>
				ask({
					kind: 'input',
					message: 'Stream name',
					validate: value => /^[a-z][a-z0-9-]{0,63}$/.test(value) || 'Use lowercase letters, numbers and hyphens',
				})
			);
			const packages = yield* Effect.promise(() =>
				ask({ kind: 'multiselect', message: 'Packages', min: 1, choices: packageChoices })
			);
			const versioning = yield* Effect.promise(() =>
				ask({
					kind: 'select',
					message: 'Versioning',
					choices: [{ value: 'workspace' }, { value: 'independent' }, { value: 'none' }],
				})
			);
			const stream: SetupChoices['streams'][number] = { name, packages, versioning, required: packages };
			choices.streams.push(stream);
			stream.prepare = yield* chooseWorkflow(name, 'prepare');
			stream.promote = yield* chooseWorkflow(name, 'promote');
		}
		const revision = yield* Effect.promise(() =>
			ask({
				kind: 'input',
				message: 'Published Beepboop Actions commit (blank for local actions)',
				empty: 'accept',
				validate: value =>
					!value || /^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/.test(value) || 'Use a version tag or a full commit SHA',
			})
		);
		if (revision) choices.actionsRevision = revision;
		return choices;
	});
}
export function setupRepository(
	client: Client,
	repository: string,
	flags: { choices?: string; plan?: string; apply: boolean; output?: string },
	ask: Ask,
	out: Out,
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		if (flags.plan) {
			if (!flags.apply || flags.choices) {
				return yield* Effect.fail(failure('Use --plan with --apply, without --choices', 'INVALID_FLAGS'));
			}
			const reviewed = yield* parsePlan(yield* readJson(flags.plan));
			const requested = yield* repositoryReference(repository).pipe(
				Effect.mapError(error => failure(error.message, 'INVALID_REPOSITORY')),
			);
			if (
				requested.owner
					? reviewed.repository !== `${requested.owner}/${requested.name}`
					: !reviewed.repository.endsWith(`/${requested.name}`)
			) {
				return yield* Effect.fail(failure('The reviewed plan belongs to another repository', 'PLAN_MISMATCH'));
			}
			yield* emit(
				out,
				yield* client.call(routes.setupApply, {
					repository,
					choices: reviewed.choices,
					planId: reviewed.planId,
					sourceSha: reviewed.sourceSha,
					setupHead: reviewed.setupHead,
				}),
			);
			return;
		}
		if (flags.apply) {
			return yield* Effect.fail(failure('--apply needs --plan pointing to a reviewed preview', 'PLAN_REQUIRED'));
		}
		const initial = yield* parsePlan(yield* client.call(routes.setupPreview, { repository }));
		const choices: unknown = flags.choices ? yield* readJson(flags.choices) : yield* chooseSetup(initial, ask);
		const preview = yield* client.call(routes.setupPreview, { repository, choices });
		const plan = yield* parsePlan(preview);
		const output = flags.output;
		if (output) yield* Effect.promise(() => Bun.write(output, `${JSON.stringify(preview, null, 2)}\n`));
		if (out.jsonMode) return yield* emit(out, preview);
		out.log(`Inspected commit: ${plan.sourceSha}`);
		for (const edit of plan.edits) out.log(`\n${edit.path}\nCurrent:\n${edit.before}\nProposed:\n${edit.after}`);
		for (const message of [...plan.blockers, ...plan.notes]) out.log(message);
		if (plan.blockers.length) return out.setExitCode(1);
		if (!plan.edits.length) return out.log('Release setup already matches.');
		if (
			!flags.choices
			&& (yield* Effect.promise(() =>
				ask({ kind: 'confirm', message: 'Open or refresh the setup PR with these exact changes?', default: false })
			))
		) {
			const result = yield* client.call(routes.setupApply, {
				repository,
				choices,
				planId: plan.planId,
				sourceSha: plan.sourceSha,
				setupHead: plan.setupHead,
			});
			out.log(result.url);
		}
	});
}
