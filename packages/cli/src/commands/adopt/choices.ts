import { isDeepStrictEqual } from 'node:util';
import type { Ask, CLIError, Out, SelectChoice } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { lookOf } from '@/cli/render/look';
import { failure, prompted } from '@/cli/render/output';
import type { WorkflowEvidence } from '@/discovery/workflow-analysis/workflow-evidence.ts';
import type { BinaryRelease } from '@/domain/binary-platforms.ts';
import { binaryTargets, leftOut, supportedTargets } from '@/domain/binary-platforms.ts';
import { workflowFilePattern } from '@/domain/catalog.ts';
import { packageLabel } from '@/domain/package-label';
import { approvalPolicies, versionBumps } from '@/domain/release-start.ts';
import {
	alwaysStarted,
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
} from '@/domain/setup-terms.ts';
import { actionsRevisionPattern } from '@/domain/workflow-setup.ts';
import { identifierPattern } from '@/kernel/schema/ids.ts';
import { safeDecode, schemaIssues } from '@/kernel/schema/structs.ts';
import { bumpable, setupStream, startable } from '@/setup/contract.ts';
import type { Selection } from '@/setup/editing/commands.ts';
import { preparationReasons, suggestedCommands, suggestedWorkflowFile, ungenerated } from '@/setup/editing/commands.ts';
import { jsonFields, streamEditors, streamFields } from '@/setup/editing/fields.ts';
import {
	binaryLabel,
	binaryTargetDefaults,
	binaryTicked,
	chosenApproval,
	chosenBump,
	chosenMerge,
	defaultTriggers,
	distributionCommands,
	generatedJob,
	inferredJob,
	keptDistributionCommands,
	offeredBinaries,
	packageCandidates,
	publicationStepDefault,
	triggerChoices,
	versioningChoices,
} from '@/setup/editing/rules.ts';
import { streamSummary } from '@/setup/summary.ts';
import type { SetupChoices, SetupPlan, SetupWorkflow } from '@/setup/types.ts';

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
	).pipe(
		Effect.flatMap(value =>
			Effect.try({
				try: (): unknown => value.trim() ? JSON.parse(value) : undefined,
				catch: () => failure('Enter valid JSON', 'INVALID_JSON'),
			})
		),
	);
}

function select(ask: Ask, message: string, entries: SelectChoice[]): Effect.Effect<string, CLIError> {
	const [first, ...rest] = entries;
	return first
		? prompted(() => ask({ kind: 'select', message, choices: [first, ...rest] }))
		: Effect.fail(failure('No choices available', 'NO_CHOICES'));
}

const unanswered: SelectChoice = { value: '', label: 'Leave it for the setup PR' };

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
		const candidates = packageCandidates(plan);
		const packageChoices = candidates.map(pkg => ({
			value: pkg.id,
			label: `${packageLabel(pkg.id)} (${pkg.manifest})`,
		}));
		if (!packageChoices.length && !plan.actionRelease && !plan.choices.streams.some(stream => stream.observe?.length)) {
			return yield* Effect.fail(
				failure('No publishable packages discovered', 'NO_PACKAGES', 'Inspect the repository diagnostics first'),
			);
		}
		const created: { choice: SetupWorkflow; stream: SetupChoices['streams'][number]; role: 'prepare' | 'release' }[] =
			[];
		const files = () =>
			choices.streams.flatMap(stream =>
				[stream.prepare?.file, stream.release?.file].filter((file): file is string => !!file)
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
			role: 'prepare' | 'release',
			previous?: SetupWorkflow,
			previousPackages: readonly string[] = [],
			rejected: ReadonlySet<string> = new Set(),
		): Effect.Effect<SetupWorkflow | undefined, CLIError> =>
			Effect.gen(function*() {
				const preparing = role === 'prepare', selectedPackages = selection(stream);
				const reasons = preparationReasons(plan, selectedPackages);
				const paired = preparing && previous?.file === stream.release?.file;
				const canShare = preparing && (paired || created.some(entry => entry.choice === stream.release));
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
				const file = selected === 'same' ? stream.release?.file ?? '' : selected === 'new'
					? previous && !existing ? previous.file : suggestedWorkflowFile(role, selectedPackages, plan, files())
					: selected;
				const evidence = plan.workflows.find(w => w.file === file);
				const taken = preparing && selected !== 'same' && file === stream.release?.file
					? stream.release.job
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
				const inferred = inferredJob(role, stream.name, file, evidence, previous, usable);
				const job = inferred ?? (evidence
					? yield* select(
						ask,
						`Which job in ${file} ${preparing ? 'prepares the release' : 'publishes these packages'}?`,
						usable.map(value => ({ value })),
					)
					: generatedJob(role));
				out.log(`${stream.name}: ${look.heading(file)}, ${job} job${selected === 'new' ? ' (generated)' : ''}.`);
				let triggers: SetupWorkflow['triggers'] = 'review';
				if (selected !== 'same' && evidence?.events.some(event => event !== 'workflow_dispatch')) {
					const prior = defaultTriggers(file, previous);
					const entry = (value: SetupWorkflow['triggers']) => ({
						value,
						label: `${existingTriggersNames[value]}: ${existingTriggersSentences[value]}`,
					});
					const entries = triggerChoices(prior).map(entry);
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
						const prior = publicationStepDefault(
							pkg.id,
							file,
							job,
							steps,
							selectedPackages.packages.length,
							previous,
						);
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
				const commands = !preparing && stream.actionRelease?.kind === 'distribution'
					? keptDistributionCommands(previous)
						?? distributionCommands(
							previous,
							plan.actionRelease?.commands || (yield* typedCommands(ask, 'this action', 'build')),
							suggested,
						)
					: integrated || (!preparing && !remaining.length)
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
					commands: integrated && kept?.job === job && stream.actionRelease?.kind !== 'distribution'
						? kept.commands
						: commands,
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
				const offered = offeredBinaries(plan, stream.packages, previous);
				const builds: typeof offered = [];
				for (const entry of offered) {
					const note = entry.candidate && leftOut(entry.candidate);
					if (note) out.log(look.state('skipped', note));
					const wanted = yield* prompted(() =>
						ask({
							kind: 'confirm',
							message: `${stream.name}: build ${binaryLabel(entry.build)} for the GitHub release?`,
							default: binaryTicked(entry.build, previous),
						})
					);
					if (wanted) builds.push(entry);
				}
				if (!builds.length) return undefined;
				const defaults = binaryTargetDefaults(builds, previous);
				const targets: BinaryRelease['targets'] = [];
				for (
					const target of binaryTargets.filter(target =>
						builds.every(entry => supportedTargets(entry.build.toolchain).includes(target))
					)
				) {
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
					const start = yield* select(
						ask,
						`${stream.name}: startFrom. ${startFromQuestion}`,
						preferring([
							unanswered,
							{ value: 'action', label: `action: ${startFromSentences.action.replaceAll('`', '')}` },
							{ value: 'none', label: `none: ${alwaysStarted.replaceAll('`', '')}` },
						], stream.start === undefined ? '' : stream.start.includes('action') ? 'action' : 'none'),
					);
					if (start === 'action') stream.start = ['action'];
					else if (start === 'none') stream.start = [];
					else delete stream.start;
				}
				if (bumpable(stream) && (all || !stream.bump)) {
					const bump = yield* select(
						ask,
						`${stream.name}: versionLands. ${versionLandsQuestion}`,
						preferring([
							unanswered,
							...versionBumps.map(value => ({
								value,
								label: `${versionLandsNames[value]}: ${versionLandsSentences[value].replaceAll('`', '')}`,
							})),
						], stream.bump ?? ''),
					);
					const chosen = chosenBump(bump);
					if (chosen) stream.bump = chosen;
					else delete stream.bump;
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
					const chosen = chosenMerge(merge, stream.versionPrMerge);
					if (chosen) stream.versionPrMerge = chosen;
				}
				if (stream.release && (all || !stream.approval)) {
					const approval = yield* select(
						ask,
						`${stream.name}: publishWhen. ${publishWhenQuestion}`,
						preferring([
							unanswered,
							...approvalPolicies.map(value => ({
								value,
								label: `${publishWhenNames[value]}: ${publishWhenSentences[value].replaceAll('`', '')}`,
							})),
						], stream.approval ?? ''),
					);
					const chosen = chosenApproval(approval);
					if (chosen) stream.approval = chosen;
					else delete stream.approval;
				}
			});
		const advanced = (stream: SetupChoices['streams'][number]) =>
			Effect.gen(function*() {
				yield* releaseMode(stream, true);
				const entered: Record<string, unknown> = { ...stream };
				for (const field of jsonFields(streamFields, streamEditors)) {
					entered[field] = yield* jsonInput(ask, `${stream.name}: ${field}`, stream[field]);
				}
				for (const role of ['prepare', 'release'] as const) {
					const current = stream[role];
					if (!current) continue;
					const tagPrefix = role === 'release'
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
				const parsed = safeDecode(setupStream, entered);
				if (!parsed.success) {
					const [issue] = schemaIssues(parsed.error);
					return yield* Effect.fail(
						failure(
							`${stream.name}: ${issue ? `${issue.path.join('.')}: ${issue.message}` : parsed.error.message}`,
							'INVALID_CHOICE',
						),
					);
				}
				const { prepare, release: releaseWorkflow, ...fields } = parsed.data;
				for (const field of jsonFields(streamFields, streamEditors)) delete stream[field];
				Object.assign(stream, fields);
				for (const [current, next] of [[stream.prepare, prepare], [stream.release, releaseWorkflow]] as const) {
					if (!current || !next) continue;
					delete current.tagPrefix;
					delete current.credentials;
					Object.assign(current, next);
				}
			});
		const configure = (stream: SetupChoices['streams'][number]) =>
			Effect.gen(function*() {
				const previousPackages = [...stream.packages];
				if (plan.actionRelease) {
					out.log(
						`GitHub Action metadata: ${
							plan.actionRelease.manifests.join(', ')
						}. Enable immutable Releases in repository settings before publishing; major/minor refs advance after publication.`,
					);
					const mode = yield* select(
						ask,
						`${stream.name}: adopt action release refs?`,
						preferring([
							{ value: 'off', label: 'Keep the current release setup' },
							{ value: 'source', label: 'Immutable patch GitHub Releases and mutable major/minor refs' },
							...(plan.actionRelease.files.length
								? [{
									value: 'distribution',
									label: 'Also publish generated files on version refs and retain source-only default-branch history',
								}]
								: []),
						], stream.actionRelease?.kind ?? 'off'),
					);
					const previousDistribution = stream.actionRelease?.kind === 'distribution'
						? stream.actionRelease.files
						: undefined;
					delete stream.actionRelease;
					if (mode === 'source') stream.actionRelease = { kind: 'source' };
					if (mode === 'distribution') {
						const files = yield* prompted(() =>
							ask({
								kind: 'input',
								message:
									'Distribution files, comma-separated. Include every runtime asset, chunk and license; entry points are only a starting list.',
								default: (previousDistribution ?? plan.actionRelease?.files)?.join(', ') ?? '',
							})
						);
						stream.actionRelease = {
							kind: 'distribution',
							files: files.split(',').map(file => file.trim()).filter(Boolean),
						};
					}
					if (stream.actionRelease && !stream.release) {
						stream.release = {
							file: 'release.yml',
							triggers: 'dispatchOnly',
							commands: stream.actionRelease.kind === 'distribution' ? plan.actionRelease.commands : '',
							publicationSteps: {},
						};
					}
				}
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
				stream.packages = packageChoices.length ? yield* packages(stream.name, stream.packages) : [];
				stream.required = [...stream.packages];
				choices.streams.push(stream);
				stream.release = yield* chooseWorkflow(stream, 'release', stream.release, previousPackages);
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
				const entries = versioningChoices(stream.versioning).map(entry);
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
				if (role === 'release' && stream.prepare?.file === before) stream.prepare.file = choice.file;
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
