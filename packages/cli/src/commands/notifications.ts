import { arg, flag, group } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { Client } from '@/cli/client/api';
import { base, connected, runCommand } from '@/cli/command';
import { lookOf, step } from '@/cli/render/look';
import { emit, failure } from '@/cli/render/output';
import { notificationTable } from '@/cli/render/views';
import { routes } from '@/contract/routes';
import { notificationKinds, parseWatchedPackage, watchedPackagePattern } from '@/domain/catalog.ts';
import { credentialAliasPattern } from '@/kernel/schema/ids.ts';

export const notifications = group('notifications').description('Send package releases to Slack and HTTPS webhooks')
	.command(
		base('list', 'List notification destinations and their packages').action(
			connected((client, { out }) =>
				Effect.gen(function*() {
					yield* notificationTable(
						out,
						yield* step(
							out,
							'Listing notification destinations',
							client.call(routes.notificationsList, {}),
							view => `${view.destinations.length} destinations`,
						),
					);
				})
			),
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
			.action(connected((client, { flags, out }) =>
				Effect.gen(function*() {
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
				})
			)),
	)
	.command(
		base('subscribe', "Send a package's releases to a destination")
			.arg('destination', arg.string().describe('Destination ID from notifications list'))
			.arg(
				'package',
				arg.string({ pattern: watchedPackagePattern }).describe('Package as registry:name, for example npm:svgo'),
			)
			.action(({ flags, args, out }) =>
				runCommand(out)(Effect.gen(function*() {
					const watched = parseWatchedPackage(args.package);
					if (!watched) {
						return yield* Effect.fail(failure('Name the package as npm:name or jsr:@scope/name', 'INVALID_PACKAGE'));
					}
					const { registry, name } = watched;
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
