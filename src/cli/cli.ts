#!/usr/bin/env bun
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, cli, command, flag, group } from '@kjanat/dreamcli';
import type { Execution, RepositoryRecord } from '@/automation/types';
import { Client } from '@/cli/client';

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
			arg.string().prompt({ kind: 'input', message: 'Repository (owner/name)' }).required().describe(
				'Enrolled repository, owner/name',
			),
		);
async function repositoryId(client: Client, name: string): Promise<number> {
	const repositories = await client.request<RepositoryRecord[]>('/api/repositories');
	const found = repositories.find(repository => repository.name === name);
	if (!found) throw new Error(`Repository ${name} is not enrolled; run beepboop repositories discover ${name}`);
	return found.id;
}
export const authStatus = base('status', 'Verify your saved session with the server').action(async ({ flags, out }) =>
	out.json(await new Client(flags.server).request('/auth/cli/status'))
);
const auth = group('auth').description('Sign in, inspect your session, or revoke it')
	.command(
		base('login', 'Approve this terminal in your browser; session lasts eight hours', true)
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
const repositories = group('repositories').description('Inspect and discover repositories')
	.command(
		base('list', 'List enrolled repositories').action(async ({ flags, out }) => {
			const rows = await new Client(flags.server).request<RepositoryRecord[]>('/api/repositories');
			if (out.jsonMode) out.json(rows);
			else {out.table(
					rows.map(row => ({
						repository: row.name,
						branch: row.defaultBranch,
						streams: Object.keys(row.configuration?.streams ?? {}).join(', '),
						problems: row.diagnostics.join('; '),
					})),
				);}
		}),
	)
	.command(
		repository('show', 'Show repository configuration, packages and workflows').action(async ({ flags, args, out }) => {
			const rows = await new Client(flags.server).request<RepositoryRecord[]>('/api/repositories');
			const found = rows.find(row => row.name === args.repository);
			if (!found) throw new Error('Repository not enrolled');
			out.json(found);
		}),
	)
	.command(
		repository('discover', 'Inspect a repository installed on the Beepboop GitHub App').action(
			async ({ flags, args, out }) => {
				out.json(await new Client(flags.server).request('/api/repositories/discover', { repository: args.repository }));
			},
		),
	);
const runs = group('runs').description('Follow, approve and recover release operations')
	.command(
		base('list', 'List release operations').action(async ({ flags, out }) => {
			const rows = await new Client(flags.server).request<Execution[]>('/api/executions');
			if (out.jsonMode) out.json(rows);
			else {out.table(
					rows.map(row => ({
						id: row.id,
						repository: row.repository,
						stream: row.stream,
						operation: row.operation,
						version: row.version ?? '',
						state: row.state,
					})),
				);}
		}),
	)
	.command(
		base('approve', 'Approve the exact reviewed source commit')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'sourceSha',
				flag.string({ pattern: /^[a-f0-9]{40}$/ }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
					.required(),
			)
			.action(async ({ flags, args, out }) =>
				out.json(
					await new Client(flags.server).request('/api/executions/approve', {
						id: args.id,
						sourceSha: flags.sourceSha,
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
				out.json(
					await new Client(flags.server).request('/api/executions/recover', { id: args.id, action: flags.action }),
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
				'version',
				flag.string().prompt({ kind: 'input', message: 'Version or bump (major, minor, patch)' }).required(),
			)
			.flag(
				'sourceSha',
				flag.string({ pattern: /^[a-f0-9]{40}$/ }).describe('Required for prepare: source SHA from plan'),
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
					throw new Error('Run releases plan first; supply its --sourceSha and --planId');
				}
				const client = new Client(flags.server);
				out.json(
					await client.request(`/api/releases/${operation}`, {
						repositoryId: await repositoryId(client, args.repository),
						stream: flags.stream,
						version: flags.version,
						sourceSha: flags.sourceSha,
						planId: flags.planId,
					}),
				);
			}),
	);
}
for (const operation of ['plan-set', 'prepare-set'] as const) {
	releases = releases.command(
		repository(operation, 'Preview or prepare an independent monorepo release plan')
			.flag('stream', flag.string().prompt({ kind: 'input', message: 'Release stream' }).required())
			.flag(
				'plan',
				flag.path({ type: 'file' }).prompt({ kind: 'input', message: 'Release plan JSON file' }).required().describe(
					'Release plan JSON file',
				),
			)
			.flag('sourceSha', flag.string({ pattern: /^[a-f0-9]{40}$/ }))
			.flag('planId', flag.string())
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
					throw new Error('Run releases plan-set first; supply its --sourceSha and --planId');
				}
				const client = new Client(flags.server);
				out.json(
					await client.request(`/api/releases/${operation}`, {
						repositoryId: await repositoryId(client, args.repository),
						stream: flags.stream,
						plan: await Bun.file(flags.plan).json(),
						sourceSha: flags.sourceSha,
						planId: flags.planId,
					}),
				);
			}),
	);
}
releases = releases.command(
	base('start', 'Start the release operations for a completed preparation')
		.arg('preparationId', arg.string().prompt({ kind: 'input', message: 'Preparation ID' }).required()).flag(
			'sourceSha',
			flag.string({ pattern: /^[a-f0-9]{40}$/ }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
				.required(),
		)
		.action(async ({ flags, args, out }) =>
			out.json(
				await new Client(flags.server).request('/api/releases/start-set', {
					preparationId: args.preparationId,
					sourceSha: flags.sourceSha,
				}),
			)
		),
);
export const app = cli('beepboop').description('Coordinate repository releases through Beepboop')
	.command(auth).command(repositories).command(releases).command(runs)
	.command(
		base('secrets', 'List secret metadata and grants; values and security-key operations stay in the dashboard')
			.action(async ({ flags, out }) => out.json(await new Client(flags.server).request('/api/credentials'))),
	);
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await app.run();
