import { isDeepStrictEqual } from 'node:util';
import type { Ask, CLIError, Out, SelectChoice } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { publishable } from '@/automation/package-publication';
import type { Selection } from '@/automation/setup-defaults';
import { preparationReasons, suggestedCommands, suggestedWorkflowFile, ungenerated } from '@/automation/setup-defaults';
import { streamSummary } from '@/automation/setup-summary';
import type { SetupChoices, SetupPlan, SetupWorkflow, WorkflowEvidence } from '@/automation/setup-types';
import { lookOf } from '@/cli/look';
import { failure, prompted } from '@/cli/output';
import { workflowFilePattern } from '@/contract/catalog';
import { identifierPattern } from '@/contract/ids';
import { approvalPolicies, startChannels, versionBumps } from '@/contract/release-start';
import type { BinaryBuild, BinaryRelease } from '@/contract/setup';
import {
	actionsRevisionPattern,
	binaryTargets,
	bumpable,
	defaultBinaryTargets,
	leftOut,
	setupStream,
	startable,
} from '@/contract/setup';
import type { ChoicesField, Editors, StreamField, WorkflowField } from '@/contract/setup-fields';
import { jsonFields, streamFields } from '@/contract/setup-fields';
import {
	existingTriggersNames,
	existingTriggersQuestion,
	existingTriggersSentences,
	publishWhenNames,
	publishWhenQuestion,
	publishWhenSentences,
	startFromQuestion,
	startFromSentences,
	versionLandsNames,
	versionLandsQuestion,
	versionLandsSentences,
	versionPrMergeQuestion,
	versionPrMergeSentences,
	versionPrMerges,
	versionScopeNames,
	versionScopeQuestion,
	versionScopeSentences,
} from '@/contract/setup-terms';
import { packageLabel } from '@/domain/package-label';

export const choicesEditors = { streams: 'control', actionsRevision: 'control' } as const satisfies Editors<
	ChoicesField
>;
export const streamEditors = {
	name: 'control',
	packages: 'control',
	required: 'control',
	versioning: 'control',
	approval: 'control',
	start: 'control',
	bump: 'control',
	versionPrMerge: 'control',
	observe: 'control',
	prepare: 'control',
	promote: 'control',
	versionSource: 'json',
	versionFiles: 'json',
	companionModules: 'json',
	needs: 'json',
	operations: 'json',
} as const satisfies Editors<StreamField>;
export const workflowEditors = {
	file: 'control',
	job: 'control',
	triggers: 'control',
	commands: 'control',
	publicationSteps: 'control',
	tagPrefix: 'control',
	binaries: 'control',
	credentials: 'json',
} as const satisfies Editors<WorkflowField>;

function buildLabel(build: BinaryBuild): string {
	return build.toolchain === 'cargo'
		? `${build.name} (Cargo, ${build.manifest})`
		: `${build.name} (Go, ${build.package === '.' ? build.module : `${build.module}/${build.package.slice(2)}`})`;
}
function validJson(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}
function obstaclesOf(evidence: WorkflowEvidence | undefined, job: string): string[] | undefined {
	const obstacles = evidence?.jobObstacles;
	return obstacles && Object.hasOwn(obstacles, job) ? obstacles[job] : undefined;
}
function jsonInput(ask: Ask, message: string, current: unknown): Effect.Effect<unknown, CLIError> {
	return prompted(() =>
		ask({
			kind: 'input',
			message: `${message} as JSON (empty leaves it out)`,
			default: current === undefined ? '' : JSON.stringify(current),
			empty: 'accept',
			validate: value => !value.trim() || validJson(value) || 'Enter valid JSON.',
		})
	).pipe(Effect.map((value): unknown => value.trim() ? JSON.parse(value) : undefined));
}

function select(ask: Ask, message: string, entries: SelectChoice[]): Effect.Effect<string, CLIError> {
	const [first, ...rest] = entries;
	return first
		? prompted(() => ask({ kind: 'select', message, choices: [first, ...rest] }))
		: Effect.fail(failure('No choices available', 'NO_CHOICES'));
}

function preferring(entries: SelectChoice[], value: string | undefined): SelectChoice[] {
	return [...entries.filter(entry => entry.value === value), ...entries.filter(entry => entry.value !== value)];
}

function typedCommands(ask: Ask, packages: string, purpose: string): Effect.Effect<string, CLIError> {
	return Effect.gen(function*() {
		const lines: string[] = [];
		for (;;) {
			const line = yield* prompted(() =>
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
		const look = lookOf(out);
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
					out.log(`${name}: ${current.map(id => look.pkg(packageLabel(id))).join(', ')}`);
					if (
						yield* prompted(() => ask({ kind: 'confirm', message: 'Use these packages?', default: true }))
					) return [...current];
				}
				return yield* prompted(() =>
					ask({ kind: 'multiselect', message: `${name}: packages to release`, min: 1, choices: [only, ...more] })
				);
			});
		const chooseWorkflow = (
			stream: SetupChoices['streams'][number],
			role: 'prepare' | 'promote',
			previous?: SetupWorkflow,
			previousPackages: readonly string[] = [],
			rejected: ReadonlySet<string> = new Set(),
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
					out.log(look.note(
						reasons.length
							? reasons.join(' ')
							: 'Beepboop can edit version files and open the release PR without a preparation job.',
					));
				}
				const entries: SelectChoice[] = [
					...(preparing && !reasons.length
						? [{ value: 'managed', label: 'Beepboop opens the version PR (no preparation job)' }]
						: []),
					...(canShare ? [{ value: 'same', label: 'Add a preparation job to the publishing workflow' }] : []),
					{ value: 'new', label: preparing ? 'Create a separate preparation workflow' : 'Create a release workflow' },
					...plan.workflows.filter(w => !rejected.has(w.file)).map(w => ({
						value: w.file,
						label: `${w.file} (${w.events.join(', ')})`,
					})),
				];
				const selected = yield* select(
					ask,
					`${stream.name}: ${preparing ? 'prepare release changes' : 'publish packages'}`,
					preferring(entries, preferred),
				);
				if (selected === 'managed') return undefined;
				const file = selected === 'same' ? stream.promote?.file ?? '' : selected === 'new'
					? previous && !existing ? previous.file : suggestedWorkflowFile(role, selectedPackages, plan, files())
					: selected;
				const evidence = plan.workflows.find(w => w.file === file);
				const roles = evidence?.roles.filter(entry => entry.stream === stream.name && entry.operation === role) ?? [];
				const taken = preparing && selected !== 'same' && file === stream.promote?.file
					? stream.promote.job
					: undefined;
				const sharedTriggers = selected !== 'same' && !!evidence && evidence.jobs.length > 1 && !evidence.prepares
					&& !evidence.reports
					&& evidence.events.some(event => event !== 'workflow_dispatch');
				const usable = sharedTriggers
					? []
					: evidence?.jobs.filter(name =>
						(selected === 'same' || !obstaclesOf(evidence, name) || evidence.preparationJobs.includes(name)
							|| evidence.reportingJobs.includes(name)) && name !== taken
					)
						?? [];
				const excluded = evidence?.jobs.filter(name => !usable.includes(name)) ?? [];
				if (evidence && !usable.length) {
					out.log(look.note(
						`${file} has no job Beepboop can add this step to: ${
							sharedTriggers
								? `its ${
									evidence.events.join(', ')
								} triggers are shared by ${evidence.jobs.length} jobs, and replacing them would affect the others`
								: excluded.map(name =>
									name === taken
										? `${name} already publishes`
										: `${name} is ${obstaclesOf(evidence, name)?.join(', ')}`
								).join('; ')
						}. Choose another workflow, or create a dedicated workflow.`,
					));
					if (rejected.has(file)) {
						return yield* Effect.fail(failure(
							`${file} has no usable job`,
							'NO_USABLE_WORKFLOW',
							'Create a dedicated workflow for this step',
						));
					}
					return yield* chooseWorkflow(stream, role, previous, previousPackages, new Set([...rejected, file]));
				}
				if (excluded.length) {
					out.log(look.note(
						`${file}: not offered, ${
							excluded.map(name =>
								name === taken
									? `${name} (already the publishing job)`
									: `${name} (${obstaclesOf(evidence, name)?.join(', ')})`
							).join('; ')
						}.`,
					));
				}
				const inferred = previous?.file === file && previous.job && (!evidence || usable.includes(previous.job))
					? previous.job
					: roles.length === 1 && (!evidence || usable.includes(roles[0]?.job ?? ''))
					? roles[0]?.job
					: usable.length === 1
					? usable[0]
					: undefined;
				const job = inferred ?? (evidence
					? yield* select(
						ask,
						`Which job in ${file} ${preparing ? 'prepares the release' : 'publishes these packages'}?`,
						usable.map(value => ({ value })),
					)
					: preparing
					? 'prepare'
					: 'publish');
				out.log(`${stream.name}: ${look.heading(file)}, ${job} job${selected === 'new' ? ' (generated)' : ''}.`);
				let triggers: SetupWorkflow['triggers'] = 'review';
				if (selected !== 'same' && evidence?.events.some(event => event !== 'workflow_dispatch')) {
					const prior = previous?.file === file ? previous.triggers : 'review';
					const entry = (value: SetupWorkflow['triggers']) => ({
						value,
						label: `${existingTriggersNames[value]}: ${existingTriggersSentences[value]}`,
					});
					const entries = [
						entry('review'),
						entry('dispatchOnly'),
						...(prior === 'preserve' ? [entry('preserve')] : []),
					];
					const trigger = yield* select(
						ask,
						`${file}: existingTriggers. ${existingTriggersQuestion}`,
						preferring(entries, prior),
					);
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
							preferring(entries, prior),
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
				const kept = previous?.file === file ? previous : undefined;
				const binaries = preparing ? undefined : yield* chooseBinaries(stream, kept);
				const choice: SetupWorkflow = {
					...(kept?.credentials ? { credentials: kept.credentials } : {}),
					...(kept?.tagPrefix ? { tagPrefix: kept.tagPrefix } : {}),
					...(binaries ? { binaries } : {}),
					file,
					job,
					triggers,
					commands: integrated && kept?.job === job ? kept.commands : commands,
					publicationSteps,
				};
				if (selected === 'new') created.push({ choice, stream, role });
				return choice;
			});
		const chooseBinaries = (
			stream: SetupChoices['streams'][number],
			previous: SetupWorkflow | undefined,
		): Effect.Effect<BinaryRelease | undefined, CLIError> =>
			Effect.gen(function*() {
				const candidates = (plan.binaryCandidates ?? []).filter(candidate =>
					stream.packages.includes(candidate.package)
				);
				const existing = previous?.binaries?.builds ?? [];
				const offered = [
					...existing.map(build => ({ build, candidate: candidates.find(entry => entry.build.name === build.name) })),
					...candidates.filter(candidate => !existing.some(build => build.name === candidate.build.name)).map(
						candidate => ({ build: candidate.build, candidate }),
					),
				];
				const builds: typeof offered = [];
				for (const entry of offered) {
					const note = entry.candidate && leftOut(entry.candidate);
					if (note) out.log(look.state('skipped', note));
					const wanted = yield* prompted(() =>
						ask({
							kind: 'confirm',
							message: `${stream.name}: build ${buildLabel(entry.build)} for the GitHub release?`,
							default: previous ? existing.some(build => build.name === entry.build.name) : true,
						})
					);
					if (wanted) builds.push(entry);
				}
				if (!builds.length) return undefined;
				const defaults = previous?.binaries?.targets
					?? defaultBinaryTargets.filter(target =>
						builds.every(entry => entry.candidate?.targets.includes(target) ?? true)
					);
				const targets: BinaryRelease['targets'] = [];
				for (const target of binaryTargets) {
					const wanted = yield* prompted(() =>
						ask({
							kind: 'confirm',
							message: `${stream.name}: build for ${target}?`,
							default: defaults.includes(target),
						})
					);
					if (wanted) targets.push(target);
				}
				if (!targets.length) {
					return yield* Effect.fail(failure('Select at least one binary target', 'NO_TARGETS'));
				}
				return { builds: builds.map(entry => entry.build), targets };
			});
		const releaseMode = (stream: SetupChoices['streams'][number], all: boolean) =>
			Effect.gen(function*() {
				if (startable(stream) && (all || !stream.start)) {
					const [first, ...rest] = startChannels.map(value => ({
						value,
						label: `${value}: ${startFromSentences[value].replaceAll('`', '')}`,
					}));
					if (first) {
						const chosen: string[] = yield* prompted(() =>
							ask({
								kind: 'multiselect',
								message: `${stream.name}: startFrom. ${startFromQuestion}${
									stream.start ? `; now ${stream.start.join(', ') || 'none'}` : ''
								}`,
								choices: [first, ...rest],
							})
						);
						stream.start = startChannels.filter(value => chosen.includes(value));
					}
				}
				if (bumpable(stream) && (all || !stream.bump)) {
					const bump = yield* select(
						ask,
						`${stream.name}: versionLands. ${versionLandsQuestion}`,
						preferring(
							versionBumps.map(value => ({
								value,
								label: `${versionLandsNames[value]}: ${versionLandsSentences[value].replaceAll('`', '')}`,
							})),
							stream.bump,
						),
					);
					stream.bump = bump === 'commit' ? 'commit' : 'pr';
				}
				if (bumpable(stream) && all && stream.bump !== 'commit') {
					const merge = yield* select(
						ask,
						`${stream.name}: versionPrMerge. ${versionPrMergeQuestion}`,
						preferring(
							versionPrMerges.map(value => ({
								value,
								label: `${value}: ${versionPrMergeSentences[value].replaceAll('`', '')}`,
							})),
							stream.versionPrMerge ?? 'manual',
						),
					);
					const chosen = versionPrMerges.find(value => value === merge);
					if (chosen && (chosen !== 'manual' || stream.versionPrMerge)) stream.versionPrMerge = chosen;
				}
				if (stream.promote && (all || !stream.approval)) {
					const approval = yield* select(
						ask,
						`${stream.name}: publishWhen. ${publishWhenQuestion}`,
						preferring(
							approvalPolicies.map(value => ({
								value,
								label: `${publishWhenNames[value]}: ${publishWhenSentences[value].replaceAll('`', '')}`,
							})),
							stream.approval,
						),
					);
					stream.approval = approval === 'push' ? 'push' : approval === 'merge' ? 'merge' : 'required';
				}
			});
		const advanced = (stream: SetupChoices['streams'][number]) =>
			Effect.gen(function*() {
				yield* releaseMode(stream, true);
				const entered: Record<string, unknown> = { ...stream };
				for (const field of jsonFields(streamFields, streamEditors)) {
					entered[field] = yield* jsonInput(ask, `${stream.name}: ${field}`, stream[field]);
				}
				for (const role of ['prepare', 'promote'] as const) {
					const current = stream[role];
					if (!current) continue;
					const tagPrefix = role === 'promote'
						? yield* prompted(() =>
							ask({
								kind: 'input',
								message: `${stream.name}: version tag prefix (empty uses the default)`,
								default: current.tagPrefix ?? '',
								empty: 'accept',
							})
						)
						: current.tagPrefix ?? '';
					const credentials = yield* jsonInput(ask, `${stream.name}: ${role} credentials`, current.credentials);
					const { tagPrefix: _prefix, credentials: _credentials, ...rest } = current;
					entered[role] = {
						...rest,
						...(tagPrefix ? { tagPrefix } : {}),
						...(credentials === undefined ? {} : { credentials }),
					};
				}
				const parsed = setupStream.safeParse(entered);
				if (!parsed.success) {
					const [issue] = parsed.error.issues;
					return yield* Effect.fail(
						failure(
							`${stream.name}: ${issue ? `${issue.path.join('.')}: ${issue.message}` : parsed.error.message}`,
							'INVALID_CHOICE',
						),
					);
				}
				const { prepare, promote, ...fields } = parsed.data;
				for (const field of jsonFields(streamFields, streamEditors)) delete stream[field];
				Object.assign(stream, fields);
				for (const [current, next] of [[stream.prepare, prepare], [stream.promote, promote]] as const) {
					if (!current || !next) continue;
					delete current.tagPrefix;
					delete current.credentials;
					Object.assign(current, next);
				}
			});
		const configure = (stream: SetupChoices['streams'][number]) =>
			Effect.gen(function*() {
				const previousPackages = [...stream.packages];
				if (stream.observe?.length) {
					out.log(`Release group ${stream.name}:\n${streamSummary(stream, plan).map(line => `- ${line}`).join('\n')}`);
					const observe = yield* prompted(() =>
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
				yield* releaseMode(stream, false);
			});
		for (const proposed of plan.choices.streams) {
			if (
				plan.choices.streams.length > 1
				&& !(yield* prompted(() =>
					ask({ kind: 'confirm', message: `Include release group ${proposed.name}?`, default: true })
				))
			) continue;
			yield* configure(structuredClone(proposed));
		}
		if (!choices.streams.length) return yield* Effect.fail(failure('Select at least one release group', 'NO_GROUPS'));
		if (
			yield* prompted(() =>
				ask({
					kind: 'confirm',
					message:
						'Customize filenames, versionScope, publishWhen, release groups, advanced fields or Actions revision?',
					default: false,
				})
			)
		) {
			while (
				yield* prompted(() => ask({ kind: 'confirm', message: 'Add another release group?', default: false }))
			) {
				const name = yield* prompted(() =>
					ask({
						kind: 'input',
						message: 'Release group name',
						validate: value =>
							identifierPattern.test(value) && !choices.streams.some(stream => stream.name === value)
							|| 'Use a unique name with lowercase letters, numbers and hyphens.',
					})
				);
				yield* configure({ name, packages: [], required: [], versioning: 'workspace' });
			}
			for (const stream of choices.streams) {
				const entry = (value: SetupChoices['streams'][number]['versioning']) => ({
					value,
					label: `${versionScopeNames[value]}: ${versionScopeSentences[value]}`,
				});
				const entries = [
					entry('workspace'),
					entry('independent'),
					...(stream.versioning === 'none' ? [entry('none')] : []),
				];
				const versioning = yield* select(
					ask,
					`${stream.name}: versionScope. ${versionScopeQuestion}`,
					preferring(entries, stream.versioning),
				);
				stream.versioning = versioning === 'independent' ? 'independent' : versioning === 'none' ? 'none' : 'workspace';
				yield* advanced(stream);
			}
			for (const { choice, stream, role } of created) {
				const before = choice.file;
				choice.file = yield* prompted(() =>
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
			const revision = yield* prompted(() =>
				ask({
					kind: 'input',
					message: 'Actions revision override (normally leave empty for the current compatible v1 release)',
					default: choices.actionsRevision ?? '',
					empty: 'accept',
					validate: value => !value || actionsRevisionPattern.test(value) || 'Use a version tag or full commit SHA.',
				})
			);
			if (revision) choices.actionsRevision = revision;
			else delete choices.actionsRevision;
		}
		return choices;
	});
}
