#!/usr/bin/env bun
import { arg, cli, command, flag, group } from '@kjanat/dreamcli';
import { repositoryReference } from '@/automation/repository-name';
import { Client } from '@/cli/client';
import { emit, failure } from '@/cli/output';
import { setupRepository } from '@/cli/setup';
import { array, integer, record, string, text } from '@/model';

function repositoryRows(value: unknown) {
	return array(value).map(raw => {
		const row = record(raw);
		return {
			raw: row,
			id: integer(row.id),
			name: text(row.name),
			defaultBranch: text(row.defaultBranch),
			streams: Object.keys(row.configuration === undefined ? {} : record(record(row.configuration).streams)),
			diagnostics: array(row.diagnostics).map(string),
		};
	});
}
function executionRows(value: unknown) {
	return array(value).map(raw => {
		const row = record(raw);
		return {
			id: text(row.id),
			repository: text(row.repository),
			stream: text(row.stream),
			operation: text(row.operation),
			version: row.version === undefined ? '' : text(row.version),
			state: text(row.state),
		};
	});
}

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
async function enrolled(client: Client, input: string) {
	const reference = repositoryReference(input);
	const rows = repositoryRows(await client.request('/api/repositories'));
	const matches = rows.filter(row =>
		reference.owner ? row.name === `${reference.owner}/${reference.name}` : row.name.endsWith(`/${reference.name}`)
	);
	const [found, ...others] = matches;
	if (found && !others.length) return found;
	throw others.length
		? failure(`Repository ${input} matches ${matches.map(row => row.name).join(', ')}`, 'AMBIGUOUS', 'Name the owner')
		: failure(`Repository ${input} is not enrolled`, 'NOT_ENROLLED', `Run beepboop repositories discover ${input}`);
}
async function repositoryId(client: Client, input: string): Promise<number> {
	return (await enrolled(client, input)).id;
}
export const authStatus = base('status', 'Verify your saved session with the server').action(async ({ flags, out }) =>
	emit(out, await new Client(flags.server).request('/auth/cli/status'))
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
			const response = await new Client(flags.server).request('/api/repositories');
			const rows = repositoryRows(response);
			if (out.jsonMode) await emit(out, response);
			else {out.table(
					rows.map(row => ({
						repository: row.name,
						branch: row.defaultBranch,
						streams: row.streams.join(', '),
						problems: row.diagnostics.join('; '),
					})),
				);}
		}),
	)
	.command(
		repository('show', 'Show repository configuration, packages and workflows').action(async ({ flags, args, out }) => {
			await emit(out, (await enrolled(new Client(flags.server), args.repository)).raw);
		}),
	)
	.command(
		repository('discover', 'Inspect a repository installed on the Beepboop GitHub App').action(
			async ({ flags, args, out }) => {
				await emit(
					out,
					await new Client(flags.server).request('/api/repositories/discover', { repository: args.repository }),
				);
			},
		),
	);
const runs = group('runs').description('Follow, approve and recover release operations')
	.command(
		base('list', 'List release operations').action(async ({ flags, out }) => {
			const response = await new Client(flags.server).request('/api/executions');
			const rows = executionRows(response);
			if (out.jsonMode) await emit(out, response);
			else out.table(rows);
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
				emit(
					out,
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
				emit(
					out,
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
				'releaseVersion',
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
					throw failure('Prepare needs --sourceSha and --planId', 'PLAN_REQUIRED', 'Run beepboop releases plan first');
				}
				const client = new Client(flags.server);
				await emit(
					out,
					await client.request(`/api/releases/${operation}`, {
						repositoryId: await repositoryId(client, args.repository),
						stream: flags.stream,
						version: flags.releaseVersion,
						sourceSha: flags.sourceSha,
						planId: flags.planId,
					}),
				);
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
				flag.string({ pattern: /^[a-f0-9]{40}$/ }).describe('Required for prepare-set: source SHA from plan-set'),
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
				await emit(
					out,
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
			emit(
				out,
				await new Client(flags.server).request('/api/releases/start-set', {
					preparationId: args.preparationId,
					sourceSha: flags.sourceSha,
				}),
			)
		),
);
export const app = cli('beepboop')
	.manifest({ from: import.meta.url })
	.links()
	.command(auth).command(repositories).command(releases).command(runs)
	.command(
		base('secrets', 'List secret names and workflow access')
			.action(async ({ flags, out }) => emit(out, await new Client(flags.server).request('/api/credentials'))),
	).completions();
if (import.meta.main) await app.run();
