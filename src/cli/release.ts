import { execFile } from 'node:child_process';
import type { Ask, CLIError, Out } from '@kjanat/dreamcli';
import { isCLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { z } from 'zod';
import { repositoryReference } from '@/automation/repository-name';
import type { Client } from '@/cli/client';
import { emit, failure } from '@/cli/output';
import { routes } from '@/contract/routes';
import { semverPattern } from '@/contract/semver';
import { decodeWith } from '@/decode';
import { packageLabel } from '@/domain/package-label';
import { shaSchema } from '@/model';

const bumps = ['patch', 'minor', 'major'] as const;
export function releaseVersion(value: string): Effect.Effect<string | { bump: typeof bumps[number] }, CLIError> {
	const bump = bumps.find(bump => bump === value);
	return bump ? Effect.succeed({ bump }) : semverPattern.test(value)
		? Effect.succeed(value)
		: Effect.fail(failure('Choose patch, minor, major or an explicit semantic version', 'INVALID_VERSION'));
}

function git(cwd: string, args: string[]): Effect.Effect<string, CLIError> {
	return Effect.tryPromise({
		try: signal =>
			new Promise<string>((resolve, reject) => {
				execFile(
					'git',
					['-C', cwd, ...args],
					{ encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, signal },
					(error, stdout) => {
						if (error) reject(error);
						else resolve(stdout.trim());
					},
				);
			}),
		catch: () =>
			failure(
				'Could not read the current Git checkout',
				'GIT_RESOLUTION_FAILED',
				'Run this in a Git checkout or pass --repository owner/repository',
			),
	});
}

function remoteRepository(remote: string): Effect.Effect<string | undefined> {
	return Effect.gen(function*() {
		let address = remote;
		if (/^(?:https?|ssh):\/\//i.test(remote)) {
			const parsed = URL.parse(remote);
			if (!parsed || !['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) return undefined;
			address = `https://github.com${parsed.pathname}`;
		} else if (!/^git@github\.com:/i.test(remote)) return undefined;
		return yield* repositoryReference(address).pipe(
			Effect.map(reference => reference.owner ? `${reference.owner}/${reference.name}` : undefined),
			Effect.orElseSucceed(() => undefined),
		);
	});
}

export function checkoutRepository(cwd: string): Effect.Effect<string, CLIError> {
	return Effect.gen(function*() {
		const remotes = (yield* git(cwd, ['remote'])).split('\n').filter(Boolean);
		if (!remotes.length) {
			return yield* Effect.fail(failure(
				'This checkout has no Git remotes',
				'REPOSITORY_REQUIRED',
				'Pass --repository owner/repository',
			));
		}
		const preferred = remotes.includes('origin') ? ['origin'] : remotes;
		const repositories = new Map<string, string>();
		for (const remote of preferred) {
			const urls = (yield* git(cwd, ['remote', 'get-url', '--all', remote])).split('\n').filter(Boolean);
			for (const url of urls) {
				const repository = yield* remoteRepository(url);
				if (repository) repositories.set(repository.toLowerCase(), repository);
				else if (remote === 'origin') {
					return yield* Effect.fail(failure(
						'The origin remote is not a supported GitHub repository',
						'INVALID_REMOTE',
						'Pass --repository owner/repository',
					));
				}
			}
		}
		const [repository, ...more] = repositories.values();
		if (!repository || more.length) {
			return yield* Effect.fail(failure(
				more.length
					? 'Git remotes point to multiple GitHub repositories'
					: 'No GitHub repository could be resolved from the remotes',
				'REPOSITORY_REQUIRED',
				'Pass --repository owner/repository',
			));
		}
		return repository;
	});
}

function prompt<A>(run: () => Promise<A>): Effect.Effect<A, CLIError> {
	return Effect.tryPromise({
		try: run,
		catch: error =>
			isCLIError(error)
				? error
				: failure(error instanceof Error ? error.message : 'Could not read release input', 'PROMPT_FAILED'),
	});
}

const streamSchema = z.looseObject({
	versioning: z.enum(['workspace', 'independent', 'none']),
	packages: z.array(z.string()).optional(),
	versionSource: z.object({ kind: z.literal('tags') }).optional(),
	versionFiles: z.array(z.unknown()).optional(),
	prepare: z.looseObject({ strategy: z.string().optional(), workflow: z.object({ file: z.string() }).optional() }),
	promote: z.looseObject({
		approval: z.enum(['required', 'merge', 'push']),
		workflow: z.object({ file: z.string() }).optional(),
	}),
});
const summarySchema = z.looseObject({
	version: z.string().min(1),
	sourceSha: shaSchema,
	planId: z.string().min(1),
	packages: z.array(z.object({ name: z.string(), manager: z.string(), version: z.string().optional() })).optional(),
	blockers: z.array(z.string()).optional(),
});
function decode<S extends z.ZodType>(schema: S, value: unknown): Effect.Effect<z.output<S>, CLIError> {
	return decodeWith(
		schema,
		value,
		error => failure('Server returned an invalid release description', 'INVALID_RESPONSE', error.issues[0]?.message),
	);
}

export interface ReleaseOptions {
	repository?: string;
	stream?: string;
	version?: string;
	yes: boolean;
}

export function releaseRepository(
	client: Client,
	options: ReleaseOptions,
	ask: Ask,
	out: Out,
	cwd = process.cwd(),
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		const reference = options.repository ?? (yield* checkoutRepository(cwd));
		const repository = yield* client.call(routes.repositoriesResolve, { repository: reference });
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
			([name, raw]) => decode(streamSchema, raw).pipe(Effect.map(stream => ({ name, stream }))),
		);
		const eligible = streams.filter(({ stream }) => stream.promote.workflow && stream.versioning !== 'independent');
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
							: `Run beepboop repositories adopt ${repository.name}`,
					),
				);
			}
			if (out.jsonMode) {
				return yield* Effect.fail(failure(
					`Choose a release stream: ${eligible.map(({ name }) => name).join(', ')}`,
					'STREAM_REQUIRED',
					'Pass --stream NAME',
				));
			}
			const [first, ...rest] = eligible.map(({ name, stream }) => ({
				value: name,
				label: `${name}: ${stream.packages?.map(packageLabel).join(', ') || 'packages selected by repository policy'}`,
			}));
			if (!first) return yield* Effect.fail(failure('No release streams available', 'NO_STREAMS'));
			selected = yield* prompt(() =>
				ask({ kind: 'select', message: `Which release stream in ${repository.name}?`, choices: [first, ...rest] })
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
		if (!stream.promote.workflow) {
			return yield* Effect.fail(failure(`Stream ${selected} has no publishing workflow`, 'NO_PUBLISHING_WORKFLOW'));
		}
		let version = options.version;
		if (!version) {
			if (out.jsonMode) {
				return yield* Effect.fail(failure(
					'Choose a release version or bump',
					'VERSION_REQUIRED',
					'Pass patch, minor, major or a semantic version',
				));
			}
			version = yield* prompt(() =>
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
			);
			if (version === 'explicit') {
				version = yield* prompt(() =>
					ask({
						kind: 'input',
						message: 'Release version (for example 0.1.0)',
						validate: value => semverPattern.test(value) || 'Enter a semantic version',
					})
				);
			}
		}
		const request = { repositoryId: repository.id, stream: selected, version: yield* releaseVersion(version) };
		const plan = yield* client.call(routes.releasesPlan, request);
		const summary = yield* decode(summarySchema, plan);
		if (summary.blockers?.length) return yield* Effect.fail(failure(summary.blockers.join('\n'), 'BLOCKED_PLAN'));
		if (!plan.edits.length && !plan.requiresPreparation) {
			return yield* Effect.fail(failure(
				`Version ${summary.version} is already prepared at ${summary.sourceSha}`,
				'ALREADY_PREPARED',
				'This command only initiates preparation; inspect existing release operations with beepboop runs list',
			));
		}
		const preview = { repository: repository.name, stream: selected, defaultBranch: repository.defaultBranch, plan };
		if (out.jsonMode && !options.yes) return yield* emit(out, preview);
		if (!out.jsonMode) {
			out.log(`Release ${repository.name} / ${selected} → ${summary.version}`);
			out.log(`Source: ${repository.defaultBranch} at ${summary.sourceSha}`);
			out.log(
				'The server plans from the repository default branch. Local branch commits and uncommitted files are not included.',
			);
			if (summary.packages?.length) {
				out.table(
					summary.packages.map(pkg => ({
						package: pkg.name,
						registry: pkg.manager,
						current: pkg.version ?? 'unknown',
						release: summary.version,
					})),
				);
			} else if (stream.packages?.length) {
				out.table(
					stream.packages.map(id => ({
						package: packageLabel(id),
						current: 'determined by preparation workflow',
						release: summary.version,
					})),
				);
			} else out.log('The configured preparation workflow determines the package versions.');
			for (const note of plan.diagnostics ?? []) out.log(note);
			for (const edit of plan.edits) out.log(`\n${edit.path}\nCurrent:\n${edit.before}\nProposed:\n${edit.after}`);
		}
		if (
			!options.yes
			&& !(yield* prompt(() =>
				ask({ kind: 'confirm', message: 'Prepare this release and open its version PR?', default: false })
			))
		) return out.log('Release preparation cancelled.');
		const preparation = yield* client.call(routes.releasesPrepare, {
			...request,
			sourceSha: summary.sourceSha,
			planId: summary.planId,
		});
		if (out.jsonMode) return yield* emit(out, { ...preview, preparation });
		out.log(`Preparation ${preparation.id}: ${preparation.state}`);
		out.log(
			stream.prepare.workflow
				? `Preparation runs in ${stream.prepare.workflow.file}. Follow it with beepboop runs list.`
				: 'Beepboop will open the version PR. Follow it with beepboop runs list.',
		);
		out.log('Review and merge the preparation PR.');
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
		if (stream.promote.approval === 'required') {
			out.log(
				'If a publication run is created, approve it with beepboop runs approve EXECUTION_ID --sourceSha MERGED_COMMIT_SHA.',
			);
		} else out.log(`Any publication run follows the configured ${stream.promote.approval} approval policy.`);
	});
}
