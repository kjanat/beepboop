#!/usr/bin/env bun
import type { CLIError, InteractiveResult, Out, SpinnerHandle } from '@kjanat/dreamcli';
import { arg, cli, command, flag, group } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { z } from 'zod';
import { Client } from '@/cli/client';
import type { SecurityKeyPrompts } from '@/cli/fido2/index';
import { readJson } from '@/cli/json-file';
import { lookOf, step } from '@/cli/look';
import { emit, failure, prompted, unprompted } from '@/cli/output';
import { checkoutRepository, releaseRepository, releaseVersion } from '@/cli/release';
import { setupRepository } from '@/cli/setup';
import { stdin } from '@/cli/stdin';
import {
	credentialTables,
	executionTable,
	executionView,
	notificationTable,
	planView,
	repositoryTable,
	repositoryView,
} from '@/cli/views';
import { notificationKinds, watchedPackagePattern, watchedRegistries } from '@/contract/catalog';
import { credentialAliasPattern, githubSecretNamePattern, shaPattern } from '@/contract/ids';
import { approvalPolicies, startChannels, versionBumps } from '@/contract/release-start';
import { routes } from '@/contract/routes';
import { binaryTargets, streamVersionings, workflowTriggers } from '@/contract/setup';
import { executionView as executionViewSchema } from '@/contract/views';

const base = (name: string, description: string, promptServer = false) =>
	command(name).description(description)
		.flag(
			'server',
			(promptServer
				? flag.string().env('BEEPBOOP_SERVER').prompt({
					kind: 'input',
					message: 'Beepboop server URL',
					default: 'https://beepboop.kjanat.dev',
				})
				: flag.string().env('BEEPBOOP_SERVER')).default('https://beepboop.kjanat.dev').describe(
					'Beepboop server origin',
				),
		);
const repositoryArg = arg.string().prompt({ kind: 'input', message: 'Repository (name, owner/name or GitHub URL)' })
	.required().describe('Repository: name, owner/name or GitHub URL');
const checkoutArg = arg.string().optional().describe('Repository override; otherwise the current Git remote');
const repository = (name: string, description: string) => base(name, description).arg('repository', repositoryArg);
function enrolled(client: Client, repository: string) {
	return client.call(routes.repositoriesResolve, { repository });
}
const sessionStatus = z.looseObject({ subject: z.string() });
export const authStatus = base('status', 'Verify your saved session with the server').action(({ flags, out }) =>
	Effect.runPromise(Effect.gen(function*() {
		const client = yield* Client.at(flags.server);
		const look = lookOf(out);
		const status = yield* step(
			out,
			`Checking your session with ${client.origin}`,
			client.status(),
			() => 'Session is valid',
		);
		if (out.jsonMode) return yield* emit(out, status);
		const parsed = sessionStatus.safeParse(status);
		out.log(
			`${look.mark('published')} Signed in to ${look.link(client.origin)}${
				parsed.success ? ` as ${look.pkg(parsed.data.subject)}` : ''
			}`,
		);
	}))
);
const auth = group('auth').description('Sign in, inspect your session, or revoke it')
	.command(
		base('login', 'Approve this terminal in your browser; the session lasts until logout', true)
			.flag(
				'browser',
				flag.boolean().prompt({ kind: 'confirm', message: 'Open the login page in your browser?', default: true })
					.default(true),
			)
			.action(({ flags, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					let waiting: SpinnerHandle | undefined;
					yield* client.login((url, code) =>
						Effect.gen(function*() {
							out.status(`Login page: ${look.link(url)}\nConfirm code: ${look.heading(code)}`);
							if (!flags.browser) return;
							const launcher = process.platform === 'darwin'
								? ['open', url]
								: process.platform === 'win32'
								? ['rundll32', 'url.dll,FileProtocolHandler', url]
								: ['xdg-open', url];
							const opened = yield* Effect.tryPromise({
								try: async () => (await Bun.spawn(launcher, { stdout: 'ignore', stderr: 'ignore' }).exited) === 0,
								catch: () => false,
							}).pipe(Effect.orElseSucceed(() => false));
							if (!opened) out.status('Could not open the browser. Open the login page above.');
						}).pipe(Effect.ensuring(Effect.sync(() => {
							waiting = out.spinner('Waiting for you to approve this terminal in the browser');
						}))), () => Effect.sync(() => waiting?.update('Still waiting for your approval in the browser'))).pipe(
							Effect.tapError(() => Effect.sync(() => waiting?.fail('Login did not complete'))),
						);
					waiting?.succeed('Approved in the browser');
					if (out.jsonMode) return yield* emit(out, { server: client.origin, signedIn: true });
					out.log(`${look.mark('published')} Signed in to ${look.link(client.origin)}.`);
				}))
			),
	)
	.command(authStatus)
	.command(
		base('logout', 'Revoke this terminal session and remove its local credential').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				yield* step(out, 'Revoking this terminal session', client.logout(), () => 'Session revoked');
				out.log(`${lookOf(out).mark('published')} Signed out.`);
			}))
		),
	);
const adoptCommand = (name: string, description: string, target: typeof repositoryArg | typeof checkoutArg) =>
	base(name, description).arg('repository', target)
		.flag(
			'choices',
			flag.path({ mustExist: true }).describe('Advanced: JSON setup choices to preview instead of the proposal'),
		)
		.flag('output', flag.path().describe('Advanced: save the preview as JSON instead of opening the PR'))
		.flag('plan', flag.path({ mustExist: true }).describe('Advanced: saved preview to apply with --apply'))
		.flag('apply', flag.boolean().default(false).describe('Advanced: apply the exact saved --plan'))
		.flag(
			'stream',
			flag.string().describe('Release group the setup flags change; needed when the proposal has several'),
		)
		.flag('package', flag.array(flag.string()).describe('Package to release, by name or package URL; repeat it'))
		.flag('required', flag.array(flag.string()).describe('Package the release needs to publish; defaults to --package'))
		.flag('versioning', flag.enum(streamVersionings).describe('How package versions change'))
		.flag('start', flag.array(flag.enum(startChannels)).describe('Where a release can start; repeat it'))
		.flag('bump', flag.enum(versionBumps).describe('How a version bump reaches the default branch'))
		.flag('approval', flag.enum(approvalPolicies).describe('When a version raised without a start publishes'))
		.flag('version-source', flag.string().describe('Advanced: versionSource as JSON'))
		.flag('version-files', flag.string().describe('Advanced: versionFiles as JSON'))
		.flag('observe', flag.string().describe('Advanced: observed workflows as JSON'))
		.flag('needs', flag.string().describe('Advanced: package dependencies as JSON'))
		.flag('operations', flag.string().describe('Advanced: extra operations as JSON'))
		.flag('prepare-file', flag.string().describe('Preparation workflow file'))
		.flag('prepare-job', flag.string().describe('Job in the preparation workflow'))
		.flag('prepare-triggers', flag.enum(workflowTriggers).describe('Who starts the preparation workflow'))
		.flag('prepare-commands', flag.string().describe('Bash commands of the preparation job'))
		.flag('prepare-publication-steps', flag.string().describe('Advanced: preparation publicationSteps as JSON'))
		.flag('prepare-credentials', flag.string().describe('Advanced: preparation credentials as JSON'))
		.flag('prepare-tag-prefix', flag.string().describe('Version tag prefix of the preparation workflow'))
		.flag('prepare-binaries', flag.string().describe('Advanced: preparation binaries as JSON'))
		.flag('promote-file', flag.string().describe('Publishing workflow file'))
		.flag('promote-job', flag.string().describe('Job in the publishing workflow'))
		.flag('promote-triggers', flag.enum(workflowTriggers).describe('Who starts the publishing workflow'))
		.flag('promote-commands', flag.string().describe('Bash commands of the publishing job'))
		.flag('promote-publication-steps', flag.string().describe('Advanced: publicationSteps as JSON'))
		.flag('promote-credentials', flag.string().describe('Advanced: publishing credentials as JSON'))
		.flag('promote-tag-prefix', flag.string().describe('Version tag prefix of the publishing workflow'))
		.flag('binary', flag.array(flag.string()).describe('Binary to build for the GitHub release; repeat it'))
		.flag('target', flag.array(flag.enum(binaryTargets)).describe('Binary target to build; repeat it'))
		.flag('actions-revision', flag.string().describe('Advanced: Actions version tag or full commit'))
		.action(({ flags, args, ask, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				const name = args.repository ?? (yield* checkoutRepository(process.cwd()));
				yield* setupRepository(client, name, flags, ask, out);
			}))
		);
const adopt = adoptCommand('adopt', 'Propose release setup for this checkout and open the setup PR', checkoutArg);
const repositories = group('repositories').alias('repo').description('Inspect and configure repository releases')
	.command(
		adoptCommand('adopt', 'Propose release setup for a repository and open the setup PR', repositoryArg).alias('setup'),
	)
	.command(
		base('list', 'List enrolled repositories').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				yield* repositoryTable(
					out,
					yield* step(
						out,
						'Listing enrolled repositories',
						client.call(routes.repositoriesList, {}),
						rows => `${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'}`,
					),
				);
			}))
		),
	)
	.command(
		repository('show', 'Show repository configuration, packages and workflows').action(({ flags, args, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const look = lookOf(out);
				yield* repositoryView(
					out,
					yield* step(
						out,
						`Reading ${look.pkg(args.repository)}`,
						enrolled(yield* Client.at(flags.server), args.repository),
						found => `Read ${look.pkg(found.name)} at ${look.sha(found.sha)}`,
					),
				);
			}))
		),
	)
	.command(
		repository('discover', 'Inspect a repository installed on the Beepboop GitHub App').action(
			({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					yield* repositoryView(
						out,
						yield* step(
							out,
							`Inspecting ${look.pkg(args.repository)} on GitHub`,
							client.call(routes.repositoriesDiscover, { repository: args.repository }),
							found => `Inspected ${look.pkg(found.name)} at ${look.sha(found.sha)}`,
						),
					);
				})),
		),
	);
const runs = group('runs').description('Follow, approve, cancel and recover release operations')
	.command(
		base('list', 'List release operations').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				yield* executionTable(
					out,
					yield* step(
						out,
						'Listing release operations',
						client.call(routes.executionsList, {}),
						rows => `${rows.length} ${rows.length === 1 ? 'operation' : 'operations'}`,
					),
				);
			}))
		),
	)
	.command(
		base('approve', 'Approve the exact reviewed source commit')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'sourceSha',
				flag.string({ pattern: shaPattern }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
					.required(),
			)
			.flag('force', flag.boolean().default(false).describe('Approve even when the signature or checks fail'))
			.action(({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					yield* executionView(
						out,
						yield* step(
							out,
							`Approving ${look.id(args.id)} at ${look.sha(flags.sourceSha)}`,
							client.call(routes.executionsApprove, {
								id: args.id,
								sourceSha: flags.sourceSha,
								force: flags.force,
							}),
							approved => `Approved ${look.id(approved.id)}`,
						),
					);
				}))
			),
	)
	.command(
		base('cancel', 'Cancel an operation and its running workflow')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required())
			.action(({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					yield* executionView(
						out,
						yield* step(
							out,
							`Cancelling ${look.id(args.id)}`,
							client.call(routes.executionsCancel, { id: args.id }),
							cancelled => `Cancelled ${look.id(cancelled.id)}`,
						),
					);
				}))
			),
	)
	.command(
		base('recover', 'Reconcile an operation, or explicitly retry it')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'action',
				flag.enum(['reconcile', 'retry']).prompt({ kind: 'select', message: 'Recovery action' }).default('reconcile'),
			)
			.action(({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					yield* executionView(
						out,
						yield* step(
							out,
							`${flags.action === 'retry' ? 'Retrying' : 'Reconciling'} ${look.id(args.id)}`,
							client.call(routes.executionsRecover, { id: args.id, action: flags.action }),
							recovered => `${look.id(recovered.id)} is ${recovered.state}`,
						),
					);
				}))
			),
	);
const release = base('release', 'Release this Git checkout: preview a version on the server, confirm, then act')
	.example('beepboop release', 'Ask for the stream (when several) and version, preview, confirm (default no)')
	.example('beepboop release patch', 'cli start: bump, then publish; the start approves the publication')
	.example('beepboop release 1.2.0', 'cli start, 1.2.0 already on the default branch: publish it')
	.example('beepboop release minor', 'No cli start, bump commit: commit the version bump')
	.example('beepboop release major', 'No cli start, bump pr: open the version PR')
	.example('beepboop release patch --yes', 'Skip only the confirmation')
	.example('beepboop release patch --dry-run', 'Print the preview (packages, version file diffs), start nothing')
	.arg('version', arg.string().optional().describe('patch, minor, major or an explicit semantic version'))
	.flag('repository', flag.string().describe('Repository override; otherwise resolve the current Git remote'))
	.flag('stream', flag.string().describe('Release stream; inferred when only one is configured'))
	.flag('yes', flag.boolean().default(false).describe('Skip the confirmation; the preview still prints'))
	.flag(
		'dry-run',
		flag.boolean().default(false).describe('Plan on the server, print the preview and start nothing'),
	)
	.action(({ flags, args, ask, out }) =>
		Effect.runPromise(
			Client.at(flags.server).pipe(
				Effect.flatMap(client =>
					releaseRepository(client, { ...flags, dryRun: flags['dry-run'], version: args.version }, ask, out)
				),
			),
		)
	);
interface Review {
	plan: string;
	prepare: string;
	subject: string;
}
interface ReviewFlags {
	server: string;
	stream: string;
	sourceSha?: string | undefined;
	planId?: string | undefined;
}
type ReleaseRequest<I> = I & { repositoryId: number; stream: string };
interface ReleaseReview<I> {
	review: Review;
	operation: string;
	flags: ReviewFlags;
	repository: string;
	input: Effect.Effect<I, CLIError>;
	selection: string;
	plan(client: Client, request: ReleaseRequest<I>): Effect.Effect<unknown, CLIError>;
	prepare(
		client: Client,
		request: ReleaseRequest<I> & { sourceSha: string; planId: string },
	): Effect.Effect<unknown, CLIError>;
}
const singleReview: Review = { plan: 'plan', prepare: 'prepare', subject: 'Prepare' };
const setReview: Review = { plan: 'plan-set', prepare: 'prepare-set', subject: 'prepare-set' };
const releaseStream = flag.string().prompt({ kind: 'input', message: 'Release stream' }).required();
const reviewFlags = (review: Review) => ({
	sourceSha: flag.string({ pattern: shaPattern }).describe(
		`Required for ${review.prepare}: source SHA from ${review.plan}`,
	),
	planId: flag.string().describe(`Required for ${review.prepare}: plan identity from ${review.plan}`),
});
function reviewPrompts(review: Review, operation: string): InteractiveResult {
	return operation === review.prepare
		? {
			sourceSha: { kind: 'input', message: 'Reviewed source SHA from plan' },
			planId: { kind: 'input', message: 'Plan ID from preview' },
		}
		: {};
}
function reviewRelease<I extends object>(
	{ review, operation, flags, repository, input, selection, plan, prepare }: ReleaseReview<I>,
	out: Out,
): Promise<void> {
	return Effect.runPromise(Effect.gen(function*() {
		if (operation === review.prepare && (!flags.sourceSha || !flags.planId)) {
			return yield* Effect.fail(failure(
				`${review.subject} needs --sourceSha and --planId`,
				'PLAN_REQUIRED',
				`Run beepboop releases ${review.plan} first`,
			));
		}
		const client = yield* Client.at(flags.server);
		const look = lookOf(out);
		const target = yield* step(
			out,
			`Reading ${look.pkg(repository)}`,
			enrolled(client, repository),
			found => `${look.pkg(found.name)} at ${look.sha(found.sha)}`,
		);
		const request = { repositoryId: target.id, stream: flags.stream, ...(yield* input) };
		if (operation === review.plan) {
			const planned = yield* step(
				out,
				`Planning ${target.name} / ${flags.stream} on the server`,
				plan(client, request),
				() => 'Plan is ready',
			);
			return yield* planView(
				out,
				planned,
				(sourceSha, planId) =>
					`beepboop releases ${review.prepare} ${target.name} --stream ${flags.stream} ${selection} --sourceSha ${sourceSha} --planId ${planId}`,
			);
		}
		if (flags.sourceSha && flags.planId) {
			const prepared = yield* step(
				out,
				`Preparing ${target.name} / ${flags.stream}`,
				prepare(client, { ...request, sourceSha: flags.sourceSha, planId: flags.planId }),
				() => 'Preparation is queued',
			);
			const view = executionViewSchema.safeParse(prepared);
			yield* view.success ? executionView(out, view.data) : emit(out, prepared);
		}
	}));
}
let releases = group('releases').description('Preview and prepare releases through repository policy');
for (const operation of ['plan', 'prepare'] as const) {
	const reviewed = reviewFlags(singleReview);
	releases = releases.command(
		repository(
			operation,
			operation === 'plan'
				? 'Preview a release without changing the repository'
				: 'Prepare a release from a reviewed plan',
		)
			.flag('stream', releaseStream).flag(
				'releaseVersion',
				flag.string().prompt({ kind: 'input', message: 'Version or bump (major, minor, patch)' }).required(),
			)
			.flag('sourceSha', reviewed.sourceSha)
			.flag('planId', reviewed.planId)
			.interactive(() => reviewPrompts(singleReview, operation))
			.action(({ flags, args, out }) =>
				reviewRelease({
					review: singleReview,
					operation,
					flags,
					repository: args.repository,
					input: releaseVersion(flags.releaseVersion).pipe(Effect.map(version => ({ version }))),
					selection: `--releaseVersion ${flags.releaseVersion}`,
					plan: (client, request) => client.call(routes.releasesPlan, request),
					prepare: (client, request) => client.call(routes.releasesPrepare, request),
				}, out)
			),
	);
}
for (const operation of ['plan-set', 'prepare-set'] as const) {
	const reviewed = reviewFlags(setReview);
	releases = releases.command(
		repository(
			operation,
			operation === 'plan-set'
				? 'Preview an independent monorepo release'
				: 'Prepare an independent monorepo release from a reviewed plan',
		)
			.flag('stream', releaseStream)
			.flag(
				'plan',
				flag.path({ type: 'file' }).prompt({ kind: 'input', message: 'Release plan JSON file' }).required().describe(
					'Release plan JSON file',
				),
			)
			.flag('sourceSha', reviewed.sourceSha)
			.flag('planId', reviewed.planId)
			.interactive(() => reviewPrompts(setReview, operation))
			.action(({ flags, args, out }) =>
				reviewRelease({
					review: setReview,
					operation,
					flags,
					repository: args.repository,
					input: readJson(flags.plan).pipe(Effect.map(plan => ({ plan }))),
					selection: `--plan ${flags.plan}`,
					plan: (client, request) => client.call(routes.releasesPlanSet, request),
					prepare: (client, request) => client.call(routes.releasesPrepareSet, request),
				}, out)
			),
	);
}
releases = releases.command(
	base('start', 'Start publication for a completed monorepo release set')
		.arg('preparationId', arg.string().prompt({ kind: 'input', message: 'Preparation ID' }).required()).flag(
			'sourceSha',
			flag.string({ pattern: shaPattern }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
				.required(),
		)
		.action(({ flags, args, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				const look = lookOf(out);
				yield* executionTable(
					out,
					yield* step(
						out,
						`Starting the release set ${look.id(args.preparationId)} at ${look.sha(flags.sourceSha)}`,
						client.call(routes.releasesStartSet, {
							preparationId: args.preparationId,
							sourceSha: flags.sourceSha,
						}),
						started => `Started ${started.length} ${started.length === 1 ? 'operation' : 'operations'}`,
					),
				);
			}))
		),
);
function securityKey(
	ask: (prompt: { kind: 'password'; message: string }) => Promise<unknown>,
): SecurityKeyPrompts<CLIError> {
	return {
		pin: Effect.promise(() => ask({ kind: 'password', message: 'Security key PIN' })).pipe(
			Effect.filterOrFail(
				(value): value is string => typeof value === 'string' && value.length > 0,
				() => failure('A security key PIN is required', 'PIN_REQUIRED'),
			),
		),
		touch() {
			process.stderr.write('Touch your security key.\n');
		},
	};
}
const secrets = group('secrets').description('Store secret values and list workflow access')
	.command(
		base('list', 'List secret names and workflow access')
			.action(({ flags, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const view = yield* step(
						out,
						'Listing secrets and workflow access',
						client.call(routes.credentialsList, {}),
						listed => `${listed.credentials.length} secrets, ${listed.grants.length} grants`,
					);
					const names = view.grants.length && !out.jsonMode
						? new Map(
							(yield* step(
								out,
								'Naming the granted repositories',
								client.call(routes.repositoriesList, {}),
								rows => `${rows.length} repositories`,
							)).map(row => [row.id, row.name]),
						)
						: new Map<number, string>();
					yield* credentialTables(out, view, names);
				}))
			),
	)
	.command(
		base('set', 'Store a secret value from stdin or a hidden prompt')
			.arg(
				'alias',
				arg.string({ pattern: credentialAliasPattern }).describe(
					'Secret name: 1-64 letters, numbers, underscores or hyphens',
				),
			)
			.action(({ flags, args, ask, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					const stored = (yield* step(
						out,
						`Reading the stored versions of ${look.pkg(args.alias)}`,
						client.call(routes.credentialsList, {}),
						() => `Read ${look.pkg(args.alias)}`,
					)).credentials.find(row => row.alias === args.alias && row.active === 1)?.version;
					const piped = yield* Effect.promise(() => stdin.piped());
					const value = piped === null
						? yield* unprompted(
							Effect.gen(function*() {
								if (
									stored !== undefined
									&& !(yield* prompted(() =>
										ask({
											kind: 'confirm',
											message: `Overwrite secret ${args.alias} (version ${stored})?`,
											default: false,
										})
									))
								) {
									return yield* Effect.fail(failure('Secret left unchanged', 'ABORTED'));
								}
								return yield* prompted(() => ask({ kind: 'password', message: `Value for ${args.alias}` }));
							}),
							() => Effect.succeed(''),
						)
						: piped.replace(/\r?\n$/, '');
					if (!value) {
						return yield* Effect.fail(
							failure('Secret value is empty', 'EMPTY_VALUE', 'Pipe the value on stdin or type it at the prompt'),
						);
					}
					const { version } = yield* client.elevatedCall(
						routes.credentialsReplace,
						proof => ({ alias: args.alias, value, proof, expectedVersion: stored ?? null }),
						securityKey(ask),
					);
					if (out.jsonMode) return yield* emit(out, { alias: args.alias, version });
					out.log(
						`${look.mark('published')} Saved ${look.pkg(args.alias)} as version ${look.version(String(version))}.`,
					);
				}))
			),
	)
	.command(
		repository('grant', 'Let a configured release workflow use a stored secret')
			.arg('alias', arg.string({ pattern: credentialAliasPattern }).describe('Stored secret name'))
			.flag('stream', flag.string().describe('Release stream; defaults to the only configured stream'))
			.flag('operation', flag.string().default('promote').describe('prepare, promote or another configured operation'))
			.flag(
				'delivery',
				flag.enum(['runtime', 'repository', 'environment']).default('runtime').describe(
					'runtime: fetched by the credentials action; repository or environment: copied into a GitHub secret',
				),
			)
			.flag('secretName', flag.string({ pattern: githubSecretNamePattern }).describe('GitHub secret name'))
			.flag('environment', flag.string().describe('GitHub environment for environment delivery'))
			.action(({ flags, args, ask, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					const target = yield* step(
						out,
						`Reading ${look.pkg(args.repository)}`,
						enrolled(client, args.repository),
						found => `${look.pkg(found.name)} has ${Object.keys(found.configuration?.streams ?? {}).length} streams`,
					);
					const streams = Object.keys(target.configuration?.streams ?? {});
					const [only, ...more] = streams;
					const stream = flags.stream ?? (only && !more.length ? only : undefined);
					if (!stream) {
						return yield* Effect.fail(failure(
							`${target.name} has streams ${streams.join(', ') || 'none'}`,
							'STREAM_REQUIRED',
							'Pass --stream',
						));
					}
					out.log(`Granting ${look.pkg(target.name)} ${stream}/${flags.operation} access to ${look.pkg(args.alias)}.`);
					yield* client.elevatedCall(routes.credentialsGrant, proof => ({
						proof,
						selection: {
							alias: args.alias,
							repositoryId: target.id,
							stream,
							operation: flags.operation,
							delivery: flags.delivery,
							...(flags.environment ? { environment: flags.environment } : {}),
							...(flags.secretName ? { secretName: flags.secretName } : {}),
						},
					}), securityKey(ask));
					if (out.jsonMode) {
						return yield* emit(out, {
							alias: args.alias,
							repository: target.name,
							stream,
							operation: flags.operation,
						});
					}
					out.log(
						`${look.mark('published')} ${look.pkg(target.name)} ${stream}/${flags.operation} can use ${
							look.pkg(args.alias)
						}.`,
					);
				}))
			),
	)
	.command(
		base('revoke', "Remove a workflow's access to a secret")
			.arg('grantId', arg.string().describe('Grant ID from beepboop secrets list'))
			.action(({ flags, args, ask, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					const result = yield* client.elevatedCall(
						routes.credentialsRevoke,
						proof => ({ grantId: args.grantId, proof }),
						securityKey(ask),
					);
					if (out.jsonMode) return yield* emit(out, result);
					out.log(`${look.mark('published')} Revoked grant ${look.id(args.grantId)}.`);
				}))
			),
	);
const notifications = group('notifications').description('Send package releases to Slack and HTTPS webhooks')
	.command(
		base('list', 'List notification destinations and their packages').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				yield* notificationTable(
					out,
					yield* step(
						out,
						'Listing notification destinations',
						client.call(routes.notificationsList, {}),
						view => `${view.destinations.length} destinations`,
					),
				);
			}))
		),
	)
	.command(
		base('add', 'Add a destination that posts to the URL stored in a secret')
			.flag('name', flag.string().prompt({ kind: 'input', message: 'Destination name' }).required())
			.flag('kind', flag.enum(notificationKinds).prompt({ kind: 'select', message: 'Destination type' }).required())
			.flag(
				'secret',
				flag.string({ pattern: credentialAliasPattern }).prompt({
					kind: 'input',
					message: 'Secret holding the webhook URL',
				})
					.required(),
			)
			.flag(
				'subscribe-new',
				flag.boolean().default(false).describe('Subscribe this destination to every newly watched package'),
			)
			.action(({ flags, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					const { id } = yield* step(
						out,
						`Adding the ${flags.kind} destination ${look.heading(flags.name)}`,
						client.call(routes.notificationsSave, {
							destination: {
								name: flags.name,
								kind: flags.kind,
								credential: flags.secret,
								subscribeNew: flags['subscribe-new'],
								enabled: true,
							},
						}),
						saved => `Added ${look.id(saved.id)}`,
					);
					if (out.jsonMode) return yield* emit(out, { id });
					out.log(`${look.mark('published')} Added destination ${look.id(id)}.`);
				}))
			),
	)
	.command(
		base('subscribe', "Send a package's releases to a destination")
			.arg('destination', arg.string().describe('Destination ID from notifications list'))
			.arg(
				'package',
				arg.string({ pattern: watchedPackagePattern }).describe('Package as registry:name, for example npm:svgo'),
			)
			.action(({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const separator = args.package.indexOf(':');
					const registry = watchedRegistries.find(candidate => candidate === args.package.slice(0, separator));
					const name = args.package.slice(separator + 1);
					if (!registry) {
						return yield* Effect.fail(failure('Name the package as npm:name or jsr:@scope/name', 'INVALID_PACKAGE'));
					}
					const client = yield* Client.at(flags.server);
					const look = lookOf(out);
					yield* step(
						out,
						`Subscribing ${look.id(args.destination)} to ${look.pkg(args.package)}`,
						client.call(routes.packagesSubscription, {
							destinationId: args.destination,
							registry,
							name,
							subscribed: true,
						}),
						() => `Subscribed to ${look.pkg(args.package)}`,
					);
					if (out.jsonMode) return yield* emit(out, { destination: args.destination, registry, name });
					out.log(
						`${look.mark('published')} Subscribed ${look.id(args.destination)} to ${look.pkg(`${registry}:${name}`)}.`,
					);
				}))
			),
	);
export const app = cli('beepboop')
	.manifest({ from: import.meta.url })
	.links()
	.command(auth).command(adopt).command(repositories).command(release).command(releases).command(runs)
	.command(secrets).command(notifications).completions();
if (import.meta.main) await app.run();
