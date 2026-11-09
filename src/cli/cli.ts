#!/usr/bin/env bun
import type { CLIError } from '@kjanat/dreamcli';
import { arg, cli, command, flag, group } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { Client } from '@/cli/client';
import type { SecurityKeyPrompts } from '@/cli/fido2/index';
import { emit, failure } from '@/cli/output';
import { checkoutRepository, releaseRepository, releaseVersion } from '@/cli/release';
import { setupRepository } from '@/cli/setup';
import { notificationKinds, watchedPackagePattern, watchedRegistries } from '@/contract/catalog';
import { credentialAliasPattern, githubSecretNamePattern, shaPattern } from '@/contract/ids';
import { routes } from '@/contract/routes';

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
const repository = (name: string, description: string) =>
	base(name, description)
		.arg(
			'repository',
			arg.string().prompt({ kind: 'input', message: 'Repository (name, owner/name or GitHub URL)' }).required()
				.describe(
					'Repository: name, owner/name or GitHub URL',
				),
		);
function enrolled(client: Client, repository: string) {
	return client.call(routes.repositoriesResolve, { repository });
}
function readJson(path: string): Effect.Effect<unknown, CLIError> {
	return Effect.tryPromise({
		try: (): Promise<unknown> => Bun.file(path).json(),
		catch: () => failure(`${path} is not readable JSON`, 'INVALID_FILE'),
	});
}
export const authStatus = base('status', 'Verify your saved session with the server').action(({ flags, out }) =>
	Effect.runPromise(Effect.gen(function*() {
		const client = yield* Client.at(flags.server);
		yield* emit(out, yield* client.status());
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
					yield* client.login((url, code) =>
						Effect.gen(function*() {
							out.status(`Login page: ${url}\nConfirm code: ${code}`);
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
						})
					);
					out.log('Signed in.');
				}))
			),
	)
	.command(authStatus)
	.command(
		base('logout', 'Revoke this terminal session and remove its local credential').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const client = yield* Client.at(flags.server);
				yield* client.logout();
				out.log('Signed out.');
			}))
		),
	);
const adoptChoices = flag.path({ mustExist: true }).describe(
	'Advanced: JSON setup choices to preview instead of the proposal',
);
const adoptOutput = flag.path().describe('Advanced: save the preview as JSON instead of opening the PR');
const adoptPlan = flag.path({ mustExist: true }).describe('Advanced: saved preview to apply with --apply');
const adoptApply = flag.boolean().default(false).describe('Advanced: apply the exact saved --plan');
const adopt = base('adopt', 'Propose release setup for this checkout and open the setup PR')
	.arg('repository', arg.string().optional().describe('Repository override; otherwise the current Git remote'))
	.flag('choices', adoptChoices).flag('output', adoptOutput).flag('plan', adoptPlan).flag('apply', adoptApply)
	.action(({ flags, args, ask, out }) =>
		Effect.runPromise(Effect.gen(function*() {
			const client = yield* Client.at(flags.server);
			const name = args.repository ?? (yield* checkoutRepository(process.cwd()));
			yield* setupRepository(client, name, flags, ask, out);
		}))
	);
const repositories = group('repositories').alias('repo').description('Inspect and configure repository releases')
	.command(
		repository('adopt', 'Propose release setup for a repository and open the setup PR').alias('setup')
			.flag('choices', adoptChoices).flag('output', adoptOutput).flag('plan', adoptPlan).flag('apply', adoptApply)
			.action(({ flags, args, ask, out }) =>
				Effect.runPromise(
					Client.at(flags.server).pipe(
						Effect.flatMap(client => setupRepository(client, args.repository, flags, ask, out)),
					),
				)
			),
	)
	.command(
		base('list', 'List enrolled repositories').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const rows = yield* (yield* Client.at(flags.server)).call(routes.repositoriesList, {});
				if (out.jsonMode) return yield* emit(out, rows);
				out.table(rows.map(row => ({
					repository: row.name,
					branch: row.defaultBranch,
					streams: Object.keys(row.configuration?.streams ?? {}).join(', '),
					problems: row.diagnostics.join('; '),
				})));
			}))
		),
	)
	.command(
		repository('show', 'Show repository configuration, packages and workflows').action(({ flags, args, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				yield* emit(out, yield* enrolled(yield* Client.at(flags.server), args.repository));
			}))
		),
	)
	.command(
		repository('discover', 'Inspect a repository installed on the Beepboop GitHub App').action(
			({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					yield* emit(out, yield* client.call(routes.repositoriesDiscover, { repository: args.repository }));
				})),
		),
	);
const runs = group('runs').description('Follow, approve, cancel and recover release operations')
	.command(
		base('list', 'List release operations').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const rows = yield* (yield* Client.at(flags.server)).call(routes.executionsList, {});
				if (out.jsonMode) return yield* emit(out, rows);
				out.table(rows.map(row => ({
					id: row.id,
					repository: row.repository,
					stream: row.stream,
					operation: row.operation,
					version: row.version ?? '',
					state: row.state,
				})));
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
					yield* emit(
						out,
						yield* client.call(routes.executionsApprove, {
							id: args.id,
							sourceSha: flags.sourceSha,
							force: flags.force,
						}),
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
					yield* emit(out, yield* client.call(routes.executionsCancel, { id: args.id }));
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
					yield* emit(out, yield* client.call(routes.executionsRecover, { id: args.id, action: flags.action }));
				}))
			),
	);
const release = base('release', 'Prepare a version PR for the current GitHub checkout')
	.arg('version', arg.string().optional().describe('patch, minor, major or an explicit semantic version'))
	.flag('repository', flag.string().describe('Repository override; otherwise resolve the current Git remote'))
	.flag('stream', flag.string().describe('Release stream; inferred when only one is configured'))
	.flag(
		'yes',
		flag.boolean().default(false).describe('Confirm the server preview and start preparation without prompting'),
	)
	.action(({ flags, args, ask, out }) =>
		Effect.runPromise(
			Client.at(flags.server).pipe(
				Effect.flatMap(client => releaseRepository(client, { ...flags, version: args.version }, ask, out)),
			),
		)
	);
let releases = group('releases').description('Preview and prepare releases through repository policy');
for (const operation of ['plan', 'prepare'] as const) {
	releases = releases.command(
		repository(
			operation,
			operation === 'plan'
				? 'Preview a release without changing the repository'
				: 'Prepare a release from a reviewed plan',
		)
			.flag('stream', flag.string().prompt({ kind: 'input', message: 'Release stream' }).required()).flag(
				'releaseVersion',
				flag.string().prompt({ kind: 'input', message: 'Version or bump (major, minor, patch)' }).required(),
			)
			.flag(
				'sourceSha',
				flag.string({ pattern: shaPattern }).describe('Required for prepare: source SHA from plan'),
			)
			.flag('planId', flag.string().describe('Required for prepare: plan identity from plan'))
			.interactive(() =>
				operation === 'prepare'
					? {
						sourceSha: { kind: 'input', message: 'Reviewed source SHA from plan' },
						planId: { kind: 'input', message: 'Plan ID from preview' },
					}
					: {}
			)
			.action(({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					if (operation === 'prepare' && (!flags.sourceSha || !flags.planId)) {
						return yield* Effect.fail(
							failure('Prepare needs --sourceSha and --planId', 'PLAN_REQUIRED', 'Run beepboop releases plan first'),
						);
					}
					const client = yield* Client.at(flags.server);
					const request = {
						repositoryId: (yield* enrolled(client, args.repository)).id,
						stream: flags.stream,
						version: yield* releaseVersion(flags.releaseVersion),
					};
					if (operation === 'plan') return yield* emit(out, yield* client.call(routes.releasesPlan, request));
					if (flags.sourceSha && flags.planId) {
						yield* emit(
							out,
							yield* client.call(routes.releasesPrepare, {
								...request,
								sourceSha: flags.sourceSha,
								planId: flags.planId,
							}),
						);
					}
				}))
			),
	);
}
for (const operation of ['plan-set', 'prepare-set'] as const) {
	releases = releases.command(
		repository(
			operation,
			operation === 'plan-set'
				? 'Preview an independent monorepo release'
				: 'Prepare an independent monorepo release from a reviewed plan',
		)
			.flag('stream', flag.string().prompt({ kind: 'input', message: 'Release stream' }).required())
			.flag(
				'plan',
				flag.path({ type: 'file' }).prompt({ kind: 'input', message: 'Release plan JSON file' }).required().describe(
					'Release plan JSON file',
				),
			)
			.flag(
				'sourceSha',
				flag.string({ pattern: shaPattern }).describe('Required for prepare-set: source SHA from plan-set'),
			)
			.flag('planId', flag.string().describe('Required for prepare-set: plan identity from plan-set'))
			.interactive(() =>
				operation === 'prepare-set'
					? {
						sourceSha: { kind: 'input', message: 'Reviewed source SHA from plan' },
						planId: { kind: 'input', message: 'Plan ID from preview' },
					}
					: {}
			)
			.action(({ flags, args, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					if (operation === 'prepare-set' && (!flags.sourceSha || !flags.planId)) {
						return yield* Effect.fail(failure(
							'prepare-set needs --sourceSha and --planId',
							'PLAN_REQUIRED',
							'Run beepboop releases plan-set first',
						));
					}
					const client = yield* Client.at(flags.server);
					const request = {
						repositoryId: (yield* enrolled(client, args.repository)).id,
						stream: flags.stream,
						plan: yield* readJson(flags.plan),
					};
					if (operation === 'plan-set') return yield* emit(out, yield* client.call(routes.releasesPlanSet, request));
					if (flags.sourceSha && flags.planId) {
						yield* emit(
							out,
							yield* client.call(routes.releasesPrepareSet, {
								...request,
								sourceSha: flags.sourceSha,
								planId: flags.planId,
							}),
						);
					}
				}))
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
				yield* emit(
					out,
					yield* client.call(routes.releasesStartSet, {
						preparationId: args.preparationId,
						sourceSha: flags.sourceSha,
					}),
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
					yield* emit(out, yield* (yield* Client.at(flags.server)).call(routes.credentialsList, {}));
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
					const stored = (yield* client.call(routes.credentialsList, {})).credentials
						.find(row => row.alias === args.alias && row.active === 1)?.version;
					const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
					if (
						stored !== undefined && interactive
						&& !(yield* Effect.promise(() =>
							ask({
								kind: 'confirm',
								message: `Overwrite secret ${args.alias} (version ${stored})?`,
								default: false,
							})
						))
					) {
						return yield* Effect.fail(failure('Secret left unchanged', 'ABORTED'));
					}
					const value = process.stdin.isTTY
						? yield* Effect.promise(() => ask({ kind: 'password', message: `Value for ${args.alias}` }))
						: (yield* Effect.promise(() => Bun.stdin.text())).replace(/\r?\n$/, '');
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
					out.log(`Saved ${args.alias} as version ${version}.`);
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
					const target = yield* enrolled(client, args.repository);
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
					out.log(`Granting ${target.name} ${stream}/${flags.operation} access to ${args.alias}.`);
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
					out.log(`${target.name} ${stream}/${flags.operation} can use ${args.alias}.`);
				}))
			),
	)
	.command(
		base('revoke', "Remove a workflow's access to a secret")
			.arg('grantId', arg.string().describe('Grant ID from beepboop secrets list'))
			.action(({ flags, args, ask, out }) =>
				Effect.runPromise(Effect.gen(function*() {
					const client = yield* Client.at(flags.server);
					yield* emit(
						out,
						yield* client.elevatedCall(
							routes.credentialsRevoke,
							proof => ({ grantId: args.grantId, proof }),
							securityKey(ask),
						),
					);
				}))
			),
	);
const notifications = group('notifications').description('Send package releases to Slack and HTTPS webhooks')
	.command(
		base('list', 'List notification destinations and their packages').action(({ flags, out }) =>
			Effect.runPromise(Effect.gen(function*() {
				const response = yield* (yield* Client.at(flags.server)).call(routes.notificationsList, {});
				if (out.jsonMode) return yield* emit(out, response);
				const { destinations, subscriptions } = response;
				out.table(destinations.map(destination => ({
					id: destination.id,
					name: destination.name,
					kind: destination.kind,
					secret: destination.credential,
					'new packages': destination.subscribeNew ? 'yes' : 'no',
					enabled: destination.enabled ? 'yes' : 'no',
					packages: subscriptions.filter(row => row.destinationId === destination.id)
						.map(row => `${row.registry}:${row.name}`).join(', '),
				})));
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
					const { id } = yield* (yield* Client.at(flags.server)).call(routes.notificationsSave, {
						destination: {
							name: flags.name,
							kind: flags.kind,
							credential: flags.secret,
							subscribeNew: flags['subscribe-new'],
							enabled: true,
						},
					});
					if (out.jsonMode) return yield* emit(out, { id });
					out.log(`Added destination ${id}.`);
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
					yield* (yield* Client.at(flags.server)).call(routes.packagesSubscription, {
						destinationId: args.destination,
						registry,
						name,
						subscribed: true,
					});
					if (out.jsonMode) return yield* emit(out, { destination: args.destination, registry, name });
					out.log(`Subscribed ${args.destination} to ${registry}:${name}.`);
				}))
			),
	);
export const app = cli('beepboop')
	.manifest({ from: import.meta.url })
	.links()
	.command(auth).command(adopt).command(repositories).command(release).command(releases).command(runs)
	.command(secrets).command(notifications).completions();
if (import.meta.main) await app.run();
