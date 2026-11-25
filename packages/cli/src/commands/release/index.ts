import type { Ask, CLIError, Out } from '@kjanat/dreamcli';
import { arg, flag, wasExplicit } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import type { Client } from '@/cli/client/api';
import { base, connected } from '@/cli/command';
import type { ReleaseOptions } from '@/cli/commands/release/review';
import {
	decodeRelease,
	printPreview,
	streamSchema,
	summarySchema,
	versionPrMergeOf,
} from '@/cli/commands/release/review';
import { checkoutRepository } from '@/cli/git-checkout';
import { followRelease } from '@/cli/render/follow';
import { lookOf, step } from '@/cli/render/look';
import { emit, failure, prompted, unprompted } from '@/cli/render/output';
import { routes } from '@/contract/routes';
import { packageLabel } from '@/domain/package-label';
import { semverPattern } from '@/domain/semver.ts';
import { autoMergeMethods, startFromEffect } from '@/domain/setup-terms.ts';

const bumps = ['patch', 'minor', 'major'] as const;
export function releaseVersion(value: string): Effect.Effect<string | { bump: typeof bumps[number] }, CLIError> {
	const bump = bumps.find(bump => bump === value);
	return bump ? Effect.succeed({ bump }) : semverPattern.test(value)
		? Effect.succeed(value)
		: Effect.fail(failure('Choose patch, minor, major or an explicit semantic version', 'INVALID_VERSION'));
}

function releaseRepository(
	client: Client,
	options: ReleaseOptions,
	ask: Ask,
	out: Out,
	cwd = process.cwd(),
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		const look = lookOf(out);
		const reference = options.repository ?? (yield* checkoutRepository(cwd));
		const repository = yield* step(
			out,
			`Reading ${look.pkg(reference)} from Beepboop`,
			client.call(routes.repositoriesResolve, { repository: reference }),
			found => `${look.pkg(found.name)} releases from ${found.defaultBranch}`,
		);
		const configured = Object.entries(repository.configuration?.streams ?? {});
		if (!configured.length) {
			return yield* Effect.fail(
				failure(
					`${repository.name} has no configured release streams`,
					'NO_STREAMS',
					`Run beepboop repositories adopt ${repository.name}`,
				),
			);
		}
		const streams = yield* Effect.forEach(
			configured,
			([name, raw]) => decodeRelease(streamSchema, raw).pipe(Effect.map(stream => ({ name, stream }))),
		);
		const starts = (name: string) => {
			const kind = repository.releases[name]?.kind;
			return kind === 'promotes' || kind === 'prepares';
		};
		const eligible = streams.filter(({ name, stream }) => starts(name) && stream.versioning !== 'independent');
		let selected = options.stream;
		if (!selected && eligible.length === 1) selected = eligible[0]?.name;
		if (!selected) {
			if (!eligible.length) {
				return yield* Effect.fail(
					failure(
						'No publishing stream supports a shared version release',
						'NO_ELIGIBLE_STREAMS',
						streams.some(({ stream }) => stream.versioning === 'independent')
							? 'Use beepboop releases plan-set and prepare-set for independent packages'
							: streams.map(({ name }) => repository.releases[name]?.summary ?? '').join(' ').trim()
								|| `Run beepboop repositories adopt ${repository.name}`,
					),
				);
			}
			const required = failure(
				`Choose a release stream: ${eligible.map(({ name }) => name).join(', ')}`,
				'STREAM_REQUIRED',
				'Pass --stream NAME',
			);
			if (out.jsonMode) return yield* Effect.fail(required);
			const [first, ...rest] = eligible.map(({ name, stream }) => ({
				value: name,
				label: `${name}: ${stream.packages?.map(packageLabel).join(', ') || 'packages selected by repository policy'}`,
			}));
			if (!first) return yield* Effect.fail(failure('No release streams available', 'NO_STREAMS'));
			selected = yield* unprompted(
				prompted(() =>
					ask({ kind: 'select', message: `Which release stream in ${repository.name}?`, choices: [first, ...rest] })
				),
				() => Effect.fail(required),
			);
		}
		const found = streams.find(({ name }) => name === selected);
		if (!found) {
			return yield* Effect.fail(
				failure(
					`Unknown release stream ${selected}`,
					'INVALID_STREAM',
					`Available: ${streams.map(({ name }) => name).join(', ')}`,
				),
			);
		}
		const { stream } = found;
		if (stream.versioning === 'independent') {
			return yield* Effect.fail(failure(
				`Stream ${selected} versions packages independently`,
				'INDEPENDENT_STREAM',
				'Use beepboop releases plan-set and prepare-set with an explicit package release plan',
			));
		}
		const release = repository.releases[selected];
		if (!release || !starts(selected)) {
			return yield* Effect.fail(
				failure(release?.summary ?? `Stream ${selected} cannot release`, 'STREAM_CANNOT_RELEASE'),
			);
		}
		const direct = release.kind === 'promotes';
		let version = options.version;
		if (!version) {
			const required = failure(
				'Choose a release version or bump',
				'VERSION_REQUIRED',
				'Pass patch, minor, major or a semantic version',
			);
			if (out.jsonMode) return yield* Effect.fail(required);
			version = yield* unprompted(
				prompted(() =>
					ask({
						kind: 'select',
						message: 'What version should be released?',
						choices: [
							{ value: 'patch', label: 'Patch: fixes and small changes' },
							{ value: 'minor', label: 'Minor: new features' },
							{ value: 'major', label: 'Major: breaking changes' },
							{ value: 'explicit', label: 'Set an explicit version' },
						],
					})
				),
				() => Effect.fail(required),
			);
			if (version === 'explicit') {
				version = yield* prompted(() =>
					ask({
						kind: 'input',
						message: 'Release version (for example 0.1.0)',
						validate: value => semverPattern.test(value) || 'Enter a semantic version',
					})
				);
			}
		}
		const request = {
			repositoryId: repository.id,
			stream: selected,
			version: yield* releaseVersion(version),
			...(options.force ? { force: true } : {}),
		};
		const plan = yield* step(
			out,
			`Planning ${look.version(version)} of ${look.pkg(repository.name)} / ${selected} on the server`,
			client.call(routes.releasesPlan, request),
			planned => `Planned ${look.version(planned.version ?? version)} at ${look.sha(planned.sourceSha)}`,
		);
		const summary = yield* decodeRelease(summarySchema, plan);
		if (summary.blockers?.length) return yield* Effect.fail(failure(summary.blockers.join('\n'), 'BLOCKED_PLAN'));
		const started = plan.starts;
		const committing = stream.prepare.bump === 'commit';
		const pending = plan.edits.length > 0 || plan.requiresPreparation === true;
		const publishes = direct || !pending;
		const merging = yield* versionPrMergeOf(options, stream.prepare.versionPrMerge);
		const opensPr = pending && !committing && !(stream.prepare.workflow && stream.prepare.strategy === 'workflow');
		if (merging && !opensPr) {
			return yield* Effect.fail(failure(
				`${summary.version} of ${selected} opens no version PR to merge`,
				'NO_VERSION_PR',
				'Drop --auto, --no-auto and --merge',
			));
		}
		const preview = {
			repository: repository.name,
			stream: selected,
			defaultBranch: repository.defaultBranch,
			plan,
			...(merging ? { versionPrMerge: merging } : {}),
		};
		if (out.jsonMode && (options.dryRun || (!options.yes && !options.force))) return yield* emit(out, preview);
		const policy = stream.promote.approval;
		if (!out.jsonMode) {
			printPreview(out, look, {
				repository,
				stream: selected,
				config: stream,
				summary,
				plan,
				release,
				started,
				pending,
				direct,
				committing,
				merging,
			});
		}
		if (options.dryRun) return out.log(look.note('Dry run: Beepboop started nothing.'));
		if (
			!options.yes && !options.force
			&& !(yield* unprompted(
				prompted(() =>
					ask({
						kind: 'confirm',
						message: started
							? `Start this release? ${startFromEffect}`
							: publishes
							? stream.promote.approval === 'push'
								? `Publish ${summary.version} once its commit is verified and its checks pass?`
								: `Create the publication run of ${summary.version}?`
							: committing
							? `Prepare this release and commit its version bump to ${repository.defaultBranch}?`
							: 'Prepare this release and open its version PR?',
						default: false,
					})
				),
				() => Effect.succeed(true),
			))
		) return out.log(started ? 'Release start cancelled.' : 'Release preparation cancelled.');
		const preparation = yield* step(
			out,
			started ? 'Starting the release' : publishes ? 'Creating the publication run' : 'Preparing the release',
			client.call(routes.releasesPrepare, {
				...request,
				sourceSha: summary.sourceSha,
				planId: summary.planId,
				...(merging ? { versionPrMerge: merging } : {}),
				start: started,
			}),
			created =>
				`${created.operation === 'promote' ? 'Release' : 'Preparation'} ${look.id(created.id)} is ${created.state}`,
		);
		if (out.jsonMode) return yield* emit(out, { ...preview, preparation });
		out.log(`${started || publishes ? 'Release' : 'Preparation'} ${look.id(preparation.id)}: ${preparation.state}`);
		if (publishes && !started) {
			return out.log(
				policy === 'push'
					? 'Beepboop publishes once the commit is verified and its checks pass.'
					: `Publish it with beepboop runs publish ${preparation.id} --sourceSha ${summary.sourceSha}.`,
			);
		}
		if (started) {
			out.log(
				options.force
					? 'Beepboop publishes without waiting on checks, the commit signature or package metadata.'
					: !pending
					? 'Beepboop publishes once the commit is verified and its checks pass.'
					: committing
					? `Beepboop commits the version bump to ${repository.defaultBranch}, then publishes once that commit is verified and its checks pass.`
					: 'Beepboop opens the version PR. Merging it publishes the release, and nothing asks again.',
			);
			return yield* followRelease(
				client,
				out,
				{
					repository: repository.name,
					repositoryId: repository.id,
					defaultBranch: repository.defaultBranch,
					stream: selected,
					version: summary.version,
					execution: preparation,
					bumped: pending,
				},
				{ ask, yes: options.yes },
			);
		}
		out.log(
			stream.prepare.workflow
				? `Preparation runs in ${stream.prepare.workflow.file}. Follow it with beepboop runs list.`
				: 'Beepboop will open the version PR. Follow it with beepboop runs list.',
		);
		out.log(
			committing
				? `Beepboop commits the version bump to ${repository.defaultBranch}.`
				: 'Review and merge the preparation PR.',
		);
		if (stream.versionSource?.kind === 'tags') {
			out.log(
				'Preparation only: tag-based streams do not start publication after merge. Starting publication from this preparation is not supported yet.',
			);
			return;
		}
		out.log(
			'After merge, Beepboop creates a publication run when package manifests and configured version files match an unreleased version. Follow it with beepboop runs list.',
		);
		if (stream.versionFiles?.length) out.log('Version files alone do not start publication.');
		if (policy === 'required') {
			out.log('Publish the run with beepboop runs publish EXECUTION_ID --sourceSha MERGED_COMMIT_SHA.');
		}
	});
}

export const releaseCommand = base(
	'release',
	'Release this Git checkout: preview a version on the server, confirm, then act',
)
	.details(
		[
			'The server plans the version from the repository default branch and prints a preview with the packages, their registries and the version file diffs. You confirm, and the stream setup decides what follows.',
			'The release bumps the version and publishes it, and nothing asks again. A version that is already on the default branch publishes as it is.',
			'Managed version files can start a release when the promotion workflow publishes the version tag. Independent versions and tag-based streams without a matching tag publisher support preparation only. A new version also stops after preparation when `prepare.strategy: workflow` delegates the bump. If no publishable package manifest carries the version, starting publication requires a workflow that publishes the version tag.',
			'`versionLands: via-direct-commit` commits the bump to the default branch. `versionLands: via-version-pr` opens the version PR. `publishWhen` decides when a prepared release publishes.',
		].join('\n\n'),
	)
	.example('beepboop release', 'Ask for the stream (when several) and version, preview, confirm (default no)')
	.example('beepboop release patch', 'Raise the patch version')
	.example('beepboop release 1.2.0', 'Release an explicit version')
	.example('beepboop release patch --yes', 'Skip only the confirmation')
	.example('beepboop release patch --dry-run', 'Print the preview (packages, version file diffs), start nothing')
	.example('beepboop release 1.2.0 --force', 'Publish without waiting on checks, the signature or package metadata')
	.example('beepboop release minor --auto', 'GitHub auto-merges this version PR with the stream method, else squash')
	.example('beepboop release minor --merge rebase', 'GitHub auto-merges this version PR with a rebase')
	.example('beepboop release minor --no-auto', 'You merge this version PR yourself')
	.arg('version', arg.string().optional().describe('patch, minor, major or an explicit semantic version'))
	.flag('repository', flag.string().describe('Repository override; otherwise resolve the current Git remote'))
	.flag('stream', flag.string().describe('Release stream; inferred when only one is configured'))
	.flag('yes', flag.boolean().default(false).describe('Skip the confirmation; the preview still prints'))
	.flag(
		'dry-run',
		flag.boolean().default(false).describe('Plan on the server, print the preview and start nothing'),
	)
	.flag(
		'force',
		flag.boolean().default(false).describe(
			'Publish without waiting on commit checks, the commit signature or package metadata, and skip the confirmation. Restarts a release of this version that stopped',
		),
	)
	.flag(
		'auto',
		flag.boolean().negatable().describe(
			'Turn GitHub auto-merge of this version PR on or off; otherwise the stream versionPrMerge decides',
		),
	)
	.flag('merge', flag.enum(autoMergeMethods).describe('Auto-merge this version PR with squash, merge or rebase'))
	.action(connected((client, { flags, args, ask, out, sources }) =>
		releaseRepository(
			client,
			{
				...flags,
				dryRun: flags['dry-run'],
				version: args.version,
				auto: wasExplicit(sources.flags.auto) ? flags.auto : undefined,
			},
			ask,
			out,
		)
	));
