import { isDeepStrictEqual } from 'node:util';
import type { Ask, CLIError, Out, SelectChoice } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { publishable } from '@/automation/package-publication';
import type { Selection } from '@/automation/setup-defaults';
import { preparationReasons, suggestedCommands, suggestedWorkflowFile, ungenerated } from '@/automation/setup-defaults';
import { streamSummary } from '@/automation/setup-summary';
import type { SetupChoices, SetupPlan, SetupWorkflow } from '@/automation/setup-types';
import { failure } from '@/cli/output';
import { workflowFilePattern } from '@/contract/catalog';
import { packageLabel } from '@/domain/package-label';

function select(ask: Ask, message: string, entries: SelectChoice[]): Effect.Effect<string, CLIError> {
	const [first, ...rest] = entries;
	return first
		? Effect.promise(() => ask({ kind: 'select', message, choices: [first, ...rest] }))
		: Effect.fail(failure('No choices available', 'NO_CHOICES'));
}

function typedCommands(ask: Ask, packages: string, purpose: string): Effect.Effect<string, CLIError> {
	return Effect.gen(function*() {
		const lines: string[] = [];
		for (;;) {
			const line = yield* Effect.promise(() =>
				ask({
					kind: 'input',
					message: lines.length
						? 'Next command (empty line ends)'
						: `Beepboop cannot generate ${purpose} commands for ${packages}. Enter them one line at a time, then an empty line.`,
					empty: 'accept',
					trim: false,
				})
			);
			if (!line.trim()) break;
			lines.push(line);
		}
		if (!lines.length) {
			return yield* Effect.fail(
				failure(
					`No ${purpose} commands for ${packages}`,
					'COMMANDS_REQUIRED',
					'Enter their commands, or leave those packages out',
				),
			);
		}
		return lines.join('\n');
	});
}
/** Interactive choices use the same defaults and reviewed API as the dashboard. */
export function chooseSetup(plan: SetupPlan, ask: Ask, out: Out): Effect.Effect<SetupChoices, CLIError> {
	return Effect.gen(function*() {
		const choices: SetupChoices = {
			streams: [],
			...(plan.choices.actionsRevision ? { actionsRevision: plan.choices.actionsRevision } : {}),
		};
		const candidates = plan.inventory.packages.flatMap((pkg, index) => {
			const id = plan.packageIds[index];
			return id && publishable(pkg) ? [{ ...pkg, id }] : [];
		});
		const packageChoices = candidates.map(pkg => ({
			value: pkg.id,
			label: `${packageLabel(pkg.id)} (${pkg.manifest})`,
		}));
		if (!packageChoices.length && !plan.choices.streams.some(stream => stream.observe?.length)) {
			return yield* Effect.fail(
				failure('No publishable packages discovered', 'NO_PACKAGES', 'Inspect the repository diagnostics first'),
			);
		}
		const created: { choice: SetupWorkflow; stream: SetupChoices['streams'][number]; role: 'prepare' | 'promote' }[] =
			[];
		const files = () =>
			choices.streams.flatMap(stream =>
				[stream.prepare?.file, stream.promote?.file].filter((file): file is string => !!file)
			);
		const selection = (stream: SetupChoices['streams'][number]): Selection => ({
			name: stream.name,
			packages: candidates.filter(pkg => stream.packages.includes(pkg.id)),
		});
		const packages = (name: string, current: string[]) =>
			Effect.gen(function*() {
				const [only, ...more] = packageChoices;
				if (!only) {
					return yield* Effect.fail(
						failure('No publishable packages discovered', 'NO_PACKAGES', 'Inspect the repository diagnostics first'),
					);
				}
				if (!more.length) return [only.value];
				if (current.length) {
					out.log(`${name}: ${current.map(packageLabel).join(', ')}`);
					if (
						yield* Effect.promise(() => ask({ kind: 'confirm', message: 'Use these packages?', default: true }))
					) return [...current];
				}
				return yield* Effect.promise(() =>
					ask({ kind: 'multiselect', message: `${name}: packages to release`, min: 1, choices: [only, ...more] })
				);
			});
		const chooseWorkflow = (
			stream: SetupChoices['streams'][number],
			role: 'prepare' | 'promote',
			previous?: SetupWorkflow,
			previousPackages: readonly string[] = [],
		): Effect.Effect<SetupWorkflow | undefined, CLIError> =>
			Effect.gen(function*() {
				const preparing = role === 'prepare', selectedPackages = selection(stream);
				const reasons = preparationReasons(plan, selectedPackages);
				const paired = preparing && previous?.file === stream.promote?.file;
				const canShare = preparing && (paired || created.some(entry => entry.choice === stream.promote));
				const existing = previous && plan.workflows.some(w => w.file === previous.file) ? previous.file : undefined;
				const preferred = paired
					? 'same'
					: existing ?? (preparing ? reasons.length ? canShare ? 'same' : 'new' : 'managed' : 'new');
				if (preparing) {
					out.log(
						reasons.length
							? reasons.join(' ')
							: 'Beepboop can edit version files and open the release PR without a preparation job.',
					);
				}
				const entries: SelectChoice[] = [
					...(preparing && !reasons.length
						? [{ value: 'managed', label: 'Beepboop opens the version PR (no preparation job)' }]
						: []),
					...(canShare ? [{ value: 'same', label: 'Add a preparation job to the publishing workflow' }] : []),
					{ value: 'new', label: preparing ? 'Create a separate preparation workflow' : 'Create a release workflow' },
					...plan.workflows.map(w => ({ value: w.file, label: `${w.file} (${w.events.join(', ')})` })),
				];
				const selected = yield* select(
					ask,
					`${stream.name}: ${preparing ? 'prepare release changes' : 'publish packages'}`,
					[
						...entries.filter(entry => entry.value === preferred),
						...entries.filter(entry => entry.value !== preferred),
					],
				);
				if (selected === 'managed') return undefined;
				const file = selected === 'same' ? stream.promote?.file ?? '' : selected === 'new'
					? previous && !existing ? previous.file : suggestedWorkflowFile(role, selectedPackages, plan, files())
					: selected;
				const evidence = plan.workflows.find(w => w.file === file);
				const roles = evidence?.roles.filter(entry => entry.stream === stream.name && entry.operation === role) ?? [];
				const inferred = previous?.file === file && previous.job && (!evidence || evidence.jobs.includes(previous.job))
					? previous.job
					: roles.length === 1
					? roles[0]?.job
					: evidence?.jobs.length === 1
					? evidence.jobs[0]
					: undefined;
				const job = inferred ?? (evidence
					? yield* select(
						ask,
						`Which job in ${file} ${preparing ? 'prepares the release' : 'publishes these packages'}?`,
						evidence.jobs.map(value => ({ value })),
					)
					: preparing
					? 'prepare'
					: 'publish');
				out.log(`${stream.name}: ${file}, ${job} job${selected === 'new' ? ' (generated)' : ''}.`);
				let triggers: SetupWorkflow['triggers'] = 'review';
				if (selected !== 'same' && evidence?.events.some(event => event !== 'workflow_dispatch')) {
					const prior = previous?.file === file ? previous.triggers : 'review';
					const entries = [
						{ value: 'review', label: 'Keep current triggers and check compatibility in preview' },
						{ value: 'dispatchOnly', label: 'Beepboop only (replace current automatic triggers)' },
						...(prior === 'preserve'
							? [{ value: 'preserve', label: 'Preserve current triggers and check compatibility in preview' }]
							: []),
					];
					const trigger = yield* select(ask, `${file}: who starts this workflow?`, [
						...entries.filter(entry => entry.value === prior),
						...entries.filter(entry => entry.value !== prior),
					]);
					triggers = trigger === 'dispatchOnly' ? 'dispatchOnly' : trigger === 'preserve' ? 'preserve' : 'review';
				}
				const integrated = preparing ? evidence?.preparationJobs.includes(job) : evidence?.reportingJobs.includes(job);
				const publicationSteps: Record<string, string> = {};
				const steps = evidence?.steps.filter(step => step.job === job) ?? [];
				if (!preparing && !integrated && steps.length) {
					for (const pkg of selectedPackages.packages) {
						const prior = previous?.file === file && previous.job === job
							? previous.publicationSteps[pkg.id]
							: undefined;
						const entries = [
							{ value: '', label: 'Add Bash publishing commands' },
							...steps.map(step => ({ value: step.id, label: step.label })),
						];
						const step = yield* select(
							ask,
							`Existing step that publishes ${packageLabel(pkg.id)} (choose explicitly for each package)`,
							[
								...entries.filter(entry => entry.value === prior),
								...entries.filter(entry => entry.value !== prior),
							],
						);
						if (step) publicationSteps[pkg.id] = step;
					}
				}
				const remaining = selectedPackages.packages.filter(pkg => !publicationSteps[pkg.id]);
				const unchanged = previous?.file === file && previous.job === job
					&& isDeepStrictEqual([...previousPackages].sort(), [...stream.packages].sort())
					&& isDeepStrictEqual(previous.publicationSteps, publicationSteps);
				const covered = { ...selectedPackages, packages: preparing ? selectedPackages.packages : remaining };
				const missing = unchanged && previous.commands ? [] : ungenerated(covered);
				const suggested = unchanged && previous.commands
					? previous.commands
					: suggestedCommands(
						role,
						{ ...covered, packages: covered.packages.filter(pkg => !missing.includes(pkg)) },
						plan,
					);
				const commands = integrated || (!preparing && !remaining.length)
					? ''
					: missing.length
					? [
						suggested,
						yield* typedCommands(
							ask,
							missing.map(pkg => `${packageLabel(pkg.id)} (${pkg.manager ?? 'unknown manager'})`).join(', '),
							preparing ? 'preparation' : 'build and publish',
						),
					].filter(Boolean).join('\n')
					: suggested;
				const choice: SetupWorkflow = {
					file,
					job,
					triggers,
					commands,
					publicationSteps,
				};
				if (selected === 'new') created.push({ choice, stream, role });
				return choice;
			});
		const configure = (stream: SetupChoices['streams'][number]) =>
			Effect.gen(function*() {
				const previousPackages = [...stream.packages];
				if (stream.observe?.length) {
					out.log(`Release group ${stream.name}:\n${streamSummary(stream, plan).map(line => `- ${line}`).join('\n')}`);
					const observe = yield* Effect.promise(() =>
						ask({
							kind: 'confirm',
							message: `${stream.name}: use this setup? Answer no to pick the packages and workflows yourself.`,
							default: true,
						})
					);
					if (observe) {
						stream.required = stream.required.filter(id => stream.packages.includes(id));
						choices.streams.push(stream);
						return;
					}
					delete stream.observe;
					delete stream.versionSource;
				}
				stream.packages = yield* packages(stream.name, stream.packages);
				stream.required = [...stream.packages];
				choices.streams.push(stream);
				stream.promote = yield* chooseWorkflow(stream, 'promote', stream.promote, previousPackages);
				stream.prepare = yield* chooseWorkflow(stream, 'prepare', stream.prepare, previousPackages);
			});
		for (const proposed of plan.choices.streams) {
			if (
				plan.choices.streams.length > 1
				&& !(yield* Effect.promise(() =>
					ask({ kind: 'confirm', message: `Include release group ${proposed.name}?`, default: true })
				))
			) continue;
			yield* configure(structuredClone(proposed));
		}
		if (!choices.streams.length) return yield* Effect.fail(failure('Select at least one release group', 'NO_GROUPS'));
		if (
			yield* Effect.promise(() =>
				ask({
					kind: 'confirm',
					message: 'Customize filenames, versioning, release groups or Actions revision?',
					default: false,
				})
			)
		) {
			while (
				yield* Effect.promise(() => ask({ kind: 'confirm', message: 'Add another release group?', default: false }))
			) {
				const name = yield* Effect.promise(() =>
					ask({
						kind: 'input',
						message: 'Release group name',
						validate: value =>
							/^[a-z][a-z0-9-]{0,63}$/.test(value) && !choices.streams.some(stream => stream.name === value)
							|| 'Use a unique name with lowercase letters, numbers and hyphens.',
					})
				);
				yield* configure({ name, packages: [], required: [], versioning: 'workspace' });
			}
			for (const stream of choices.streams) {
				const entries = [
					{ value: 'workspace', label: 'Give selected packages the same version' },
					{ value: 'independent', label: 'Version each package separately' },
					...(stream.versioning === 'none'
						? [{ value: 'none', label: 'Keep the configured custom version policy' }]
						: []),
				];
				const versioning = yield* select(ask, `${stream.name}: how package versions change`, [
					...entries.filter(entry => entry.value === stream.versioning),
					...entries.filter(entry => entry.value !== stream.versioning),
				]);
				stream.versioning = versioning === 'independent' ? 'independent' : versioning === 'none' ? 'none' : 'workspace';
			}
			for (const { choice, stream, role } of created) {
				const before = choice.file;
				choice.file = yield* Effect.promise(() =>
					ask({
						kind: 'input',
						message: `${stream.name}: ${role === 'prepare' ? 'preparation' : 'publishing'} workflow filename`,
						default: before,
						validate: value =>
							workflowFilePattern.test(value) && (!files().includes(value) || value === before)
								&& !plan.workflows.some(w => w.file === value) || 'Use an unused YAML filename.',
					})
				);
				if (role === 'promote' && stream.prepare?.file === before) stream.prepare.file = choice.file;
			}
			const revision = yield* Effect.promise(() =>
				ask({
					kind: 'input',
					message: 'Actions revision override (normally leave empty for the current compatible v1 release)',
					default: choices.actionsRevision ?? '',
					empty: 'accept',
					validate: value =>
						!value || /^(?:[a-f0-9]{40}|v\d+(?:\.\d+){0,2})$/.test(value) || 'Use a version tag or full commit SHA.',
				})
			);
			if (revision) choices.actionsRevision = revision;
			else delete choices.actionsRevision;
		}
		return choices;
	});
}
