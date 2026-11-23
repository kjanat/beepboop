import type { CLIError } from '@kjanat/dreamcli';
import { arg, flag, group } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { base, connected, enrolled, repository } from '@/cli/command';
import type { SecurityKeyPrompts } from '@/cli/fido2/index';
import { lookOf, step } from '@/cli/render/look';
import { emit, failure, prompted, unprompted } from '@/cli/render/output';
import { credentialTables } from '@/cli/render/views';
import { routes } from '@/contract/routes';
import { credentialAliasPattern, githubSecretNamePattern } from '@/kernel/schema/ids.ts';

function securityKey(
	ask: (prompt: { kind: 'password'; message: string }) => Promise<unknown>,
): SecurityKeyPrompts<CLIError> {
	return {
		pin: prompted(() => ask({ kind: 'password', message: 'Security key PIN' })).pipe(
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

export const secrets = group('secrets').description('Store secret values and list workflow access')
	.command(
		base('list', 'List secret names and workflow access')
			.action(connected((client, { out }) =>
				Effect.gen(function*() {
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
				})
			)),
	)
	.command(
		base('set', 'Store a secret value from stdin or a hidden prompt')
			.arg(
				'alias',
				arg.string({ pattern: credentialAliasPattern }).describe(
					'Secret name: 1-64 letters, numbers, underscores or hyphens',
				),
			)
			.flag('value', flag.string().stdin({ argv: false, trim: true }).sensitive())
			.action(connected((client, { flags, args, ask, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					const stored = (yield* step(
						out,
						`Reading the stored versions of ${look.pkg(args.alias)}`,
						client.call(routes.credentialsList, {}),
						() => `Read ${look.pkg(args.alias)}`,
					)).credentials.find(row => row.alias === args.alias && row.active === 1)?.version;
					const value = flags.value === undefined
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
						: flags.value;
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
				})
			)),
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
			.action(connected((client, { flags, args, ask, out }) =>
				Effect.gen(function*() {
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
				})
			)),
	)
	.command(
		base('revoke', "Remove a workflow's access to a secret")
			.arg('grantId', arg.string().describe('Grant ID from beepboop secrets list'))
			.action(connected((client, { args, ask, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					const result = yield* client.elevatedCall(
						routes.credentialsRevoke,
						proof => ({ grantId: args.grantId, proof }),
						securityKey(ask),
					);
					if (out.jsonMode) return yield* emit(out, result);
					out.log(`${look.mark('published')} Revoked grant ${look.id(args.grantId)}.`);
				})
			)),
	);
