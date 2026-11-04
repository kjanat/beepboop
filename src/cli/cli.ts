#!/usr/bin/env bun
import { arg, cli, command, flag, group } from '@kjanat/dreamcli';
import { Client } from '@/cli/client';
import { emit, failure } from '@/cli/output';
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
export const authStatus = base('status', 'Verify your saved session with the server').action(async ({ flags, out }) =>
	emit(out, await new Client(flags.server).status())
);
const auth = group('auth').description('Sign in, inspect your session, or revoke it')
	.command(
		base('login', 'Approve this terminal in your browser; the session lasts until logout', true)
			.flag(
				'browser',
				flag.boolean().prompt({ kind: 'confirm', message: 'Open the login page in your browser?', default: true })
					.default(true),
			)
			.action(async ({ flags, out }) => {
				await new Client(flags.server).login(async (url, code) => {
					out.status(`Login page: ${url}\nConfirm code: ${code}`);
					if (flags.browser) {
						const launcher = process.platform === 'darwin'
							? ['open', url]
							: process.platform === 'win32'
							? ['rundll32', 'url.dll,FileProtocolHandler', url]
							: ['xdg-open', url];
						try {
							const child = Bun.spawn(launcher, { stdout: 'ignore', stderr: 'ignore' });
							if (await child.exited !== 0) out.status('Could not open the browser. Open the login page above.');
						} catch {
							out.status('Could not open the browser. Open the login page above.');
						}
					}
				});
				out.log('Signed in.');
			}),
	)
	.command(authStatus)
	.command(
		base('logout', 'Revoke this terminal session and remove its local credential').action(async ({ flags, out }) => {
			await new Client(flags.server).logout();
			out.log('Signed out.');
		}),
	);
const repositories = group('repositories').description('Inspect and configure repository releases')
	.command(
		repository('setup', 'Review release configuration and workflow integration in a setup PR')
			.flag(
				'choices',
				flag.path({ mustExist: true }).describe('JSON setup choices; preview without interactive prompts'),
			)
			.flag('output', flag.path().describe('Save the reviewed preview as JSON'))
			.flag('plan', flag.path({ mustExist: true }).describe('Previously reviewed preview to apply'))
			.flag('apply', flag.boolean().default(false).describe('Apply the exact reviewed --plan'))
			.action(async ({ flags, args, ask, out }) =>
				setupRepository(new Client(flags.server), args.repository, flags, ask, out)
			),
	)
	.command(
		base('list', 'List enrolled repositories').action(async ({ flags, out }) => {
			const rows = await new Client(flags.server).call(routes.repositoriesList, {});
			if (out.jsonMode) await emit(out, rows);
			else {
				out.table(rows.map(row => ({
					repository: row.name,
					branch: row.defaultBranch,
					streams: Object.keys(row.configuration?.streams ?? {}).join(', '),
					problems: row.diagnostics.join('; '),
				})));
			}
		}),
	)
	.command(
		repository('show', 'Show repository configuration, packages and workflows').action(async ({ flags, args, out }) => {
			await emit(out, await enrolled(new Client(flags.server), args.repository));
		}),
	)
	.command(
		repository('discover', 'Inspect a repository installed on the Beepboop GitHub App').action(
			async ({ flags, args, out }) => {
				await emit(
					out,
					await new Client(flags.server).call(routes.repositoriesDiscover, { repository: args.repository }),
				);
			},
		),
	);
const runs = group('runs').description('Follow, approve and recover release operations')
	.command(
		base('list', 'List release operations').action(async ({ flags, out }) => {
			const rows = await new Client(flags.server).call(routes.executionsList, {});
			if (out.jsonMode) await emit(out, rows);
			else {
				out.table(rows.map(row => ({
					id: row.id,
					repository: row.repository,
					stream: row.stream,
					operation: row.operation,
					version: row.version ?? '',
					state: row.state,
				})));
			}
		}),
	)
	.command(
		base('approve', 'Approve the exact reviewed source commit')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'sourceSha',
				flag.string({ pattern: shaPattern }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
					.required(),
			)
			.flag('force', flag.boolean().default(false).describe('Approve even when the signature or checks fail'))
			.action(async ({ flags, args, out }) =>
				emit(
					out,
					await new Client(flags.server).call(routes.executionsApprove, {
						id: args.id,
						sourceSha: flags.sourceSha,
						force: flags.force,
					}),
				)
			),
	)
	.command(
		base('recover', 'Reconcile an operation, or explicitly retry it')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'action',
				flag.enum(['reconcile', 'retry']).prompt({ kind: 'select', message: 'Recovery action' }).default('reconcile'),
			)
			.action(async ({ flags, args, out }) =>
				emit(
					out,
					await new Client(flags.server).call(routes.executionsRecover, { id: args.id, action: flags.action }),
				)
			),
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
			.action(async ({ flags, args, out }) => {
				if (operation === 'prepare' && (!flags.sourceSha || !flags.planId)) {
					throw failure('Prepare needs --sourceSha and --planId', 'PLAN_REQUIRED', 'Run beepboop releases plan first');
				}
				const client = new Client(flags.server);
				const request = {
					repositoryId: (await enrolled(client, args.repository)).id,
					stream: flags.stream,
					version: flags.releaseVersion,
				};
				if (operation === 'plan') await emit(out, await client.call(routes.releasesPlan, request));
				else if (flags.sourceSha && flags.planId) {
					await emit(
						out,
						await client.call(routes.releasesPrepare, {
							...request,
							sourceSha: flags.sourceSha,
							planId: flags.planId,
						}),
					);
				}
			}),
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
			.action(async ({ flags, args, out }) => {
				if (operation === 'prepare-set' && (!flags.sourceSha || !flags.planId)) {
					throw failure(
						'prepare-set needs --sourceSha and --planId',
						'PLAN_REQUIRED',
						'Run beepboop releases plan-set first',
					);
				}
				const client = new Client(flags.server);
				const request = {
					repositoryId: (await enrolled(client, args.repository)).id,
					stream: flags.stream,
					plan: await Bun.file(flags.plan).json(),
				};
				if (operation === 'plan-set') await emit(out, await client.call(routes.releasesPlanSet, request));
				else if (flags.sourceSha && flags.planId) {
					await emit(
						out,
						await client.call(routes.releasesPrepareSet, {
							...request,
							sourceSha: flags.sourceSha,
							planId: flags.planId,
						}),
					);
				}
			}),
	);
}
releases = releases.command(
	base('start', 'Start the release operations for a completed preparation')
		.arg('preparationId', arg.string().prompt({ kind: 'input', message: 'Preparation ID' }).required()).flag(
			'sourceSha',
			flag.string({ pattern: shaPattern }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
				.required(),
		)
		.action(async ({ flags, args, out }) =>
			emit(
				out,
				await new Client(flags.server).call(routes.releasesStartSet, {
					preparationId: args.preparationId,
					sourceSha: flags.sourceSha,
				}),
			)
		),
);
function securityKey(ask: (prompt: { kind: 'password'; message: string }) => Promise<unknown>) {
	return {
		async pin() {
			const value = await ask({ kind: 'password', message: 'Security key PIN' });
			if (typeof value !== 'string' || !value) throw failure('A security key PIN is required', 'PIN_REQUIRED');
			return value;
		},
		touch() {
			process.stderr.write('Touch your security key.\n');
		},
	};
}
const secrets = group('secrets').description('Store secret values and list workflow access')
	.command(
		base('list', 'List secret names and workflow access')
			.action(async ({ flags, out }) => emit(out, await new Client(flags.server).call(routes.credentialsList, {}))),
	)
	.command(
		base('set', 'Store a secret value from stdin or a hidden prompt')
			.arg(
				'alias',
				arg.string({ pattern: credentialAliasPattern }).describe(
					'Secret name: 1-64 letters, numbers, underscores or hyphens',
				),
			)
			.action(async ({ flags, args, ask, out }) => {
				const client = new Client(flags.server);
				const stored = (await client.call(routes.credentialsList, {})).credentials
					.find(row => row.alias === args.alias && row.active === 1)?.version;
				const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
				if (
					stored !== undefined && interactive
					&& !await ask({
						kind: 'confirm',
						message: `Overwrite secret ${args.alias} (version ${stored})?`,
						default: false,
					})
				) {
					throw failure('Secret left unchanged', 'ABORTED');
				}
				const value = process.stdin.isTTY
					? await ask({ kind: 'password', message: `Value for ${args.alias}` })
					: (await Bun.stdin.text()).replace(/\r?\n$/, '');
				if (!value) {
					throw failure('Secret value is empty', 'EMPTY_VALUE', 'Pipe the value on stdin or type it at the prompt');
				}
				const proof = await client.elevated(securityKey(ask));
				const { version } = await client.call(routes.credentialsReplace, {
					alias: args.alias,
					value,
					proof,
					expectedVersion: stored ?? null,
				});
				if (out.jsonMode) await emit(out, { alias: args.alias, version });
				else out.log(`Saved ${args.alias} as version ${version}.`);
			}),
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
			.action(async ({ flags, args, ask, out }) => {
				const client = new Client(flags.server);
				const target = await enrolled(client, args.repository);
				const streams = Object.keys(target.configuration?.streams ?? {});
				const [only, ...more] = streams;
				const stream = flags.stream ?? (only && !more.length ? only : undefined);
				if (!stream) {
					throw failure(
						`${target.name} has streams ${streams.join(', ') || 'none'}`,
						'STREAM_REQUIRED',
						'Pass --stream',
					);
				}
				out.log(`Granting ${target.name} ${stream}/${flags.operation} access to ${args.alias}.`);
				const proof = await client.elevated(securityKey(ask));
				await client.call(routes.credentialsGrant, {
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
				});
				if (out.jsonMode) {
					await emit(out, { alias: args.alias, repository: target.name, stream, operation: flags.operation });
				} else out.log(`${target.name} ${stream}/${flags.operation} can use ${args.alias}.`);
			}),
	)
	.command(
		base('revoke', "Remove a workflow's access to a secret")
			.arg('grantId', arg.string().describe('Grant ID from beepboop secrets list'))
			.action(async ({ flags, args, ask, out }) => {
				const client = new Client(flags.server);
				const proof = await client.elevated(securityKey(ask));
				await emit(out, await client.call(routes.credentialsRevoke, { grantId: args.grantId, proof }));
			}),
	);
const notifications = group('notifications').description('Send package releases to Slack and HTTPS webhooks')
	.command(
		base('list', 'List notification destinations and their packages').action(async ({ flags, out }) => {
			const response = await new Client(flags.server).call(routes.notificationsList, {});
			if (out.jsonMode) {
				await emit(out, response);
				return;
			}
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
		}),
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
			.action(async ({ flags, ask, out }) => {
				const client = new Client(flags.server);
				const proof = await client.elevated(securityKey(ask));
				const { id } = await client.call(routes.notificationsSave, {
					proof,
					destination: {
						name: flags.name,
						kind: flags.kind,
						credential: flags.secret,
						subscribeNew: flags['subscribe-new'],
						enabled: true,
					},
				});
				if (out.jsonMode) await emit(out, { id });
				else out.log(`Added destination ${id}.`);
			}),
	)
	.command(
		base('subscribe', "Send a package's releases to a destination")
			.arg('destination', arg.string().describe('Destination ID from notifications list'))
			.arg(
				'package',
				arg.string({ pattern: watchedPackagePattern }).describe('Package as registry:name, for example npm:svgo'),
			)
			.action(async ({ flags, args, out }) => {
				const separator = args.package.indexOf(':');
				const registry = watchedRegistries.find(candidate => candidate === args.package.slice(0, separator));
				const name = args.package.slice(separator + 1);
				if (!registry) throw failure('Name the package as npm:name or jsr:@scope/name', 'INVALID_PACKAGE');
				await new Client(flags.server).call(routes.packagesSubscription, {
					destinationId: args.destination,
					registry,
					name,
					subscribed: true,
				});
				if (out.jsonMode) await emit(out, { destination: args.destination, registry, name });
				else out.log(`Subscribed ${args.destination} to ${registry}:${name}.`);
			}),
	);
export const app = cli('beepboop')
	.manifest({ from: import.meta.url })
	.links()
	.command(auth).command(repositories).command(releases).command(runs)
	.command(secrets).command(notifications).completions();
if (import.meta.main) await app.run();
