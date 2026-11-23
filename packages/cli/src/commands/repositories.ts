import { group } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { base, connected, enrolled, repository, repositoryArg } from '@/cli/command';
import { adoptCommand } from '@/cli/commands/adopt/index';
import { lookOf, step } from '@/cli/render/look';
import { repositoryTable, repositoryView } from '@/cli/render/views';
import { routes } from '@/contract/routes';

export const repositories = group('repositories').alias('repo').description('Inspect and configure repository releases')
	.command(
		adoptCommand('adopt', 'Propose release setup for a repository and open the setup PR', repositoryArg).alias('setup'),
	)
	.command(
		base('list', 'List enrolled repositories').action(connected((client, { out }) =>
			Effect.gen(function*() {
				yield* repositoryTable(
					out,
					yield* step(
						out,
						'Listing enrolled repositories',
						client.call(routes.repositoriesList, {}),
						rows => `${rows.length} ${rows.length === 1 ? 'repository' : 'repositories'}`,
					),
				);
			})
		)),
	)
	.command(
		repository('show', 'Show repository configuration, packages and workflows').action(
			connected((client, { args, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					yield* repositoryView(
						out,
						yield* step(
							out,
							`Reading ${look.pkg(args.repository)}`,
							enrolled(client, args.repository),
							found => `Read ${look.pkg(found.name)} at ${look.sha(found.sha)}`,
						),
					);
				})
			),
		),
	)
	.command(
		repository('discover', 'Inspect a repository installed on the Beepboop GitHub App').action(
			connected((client, { args, out }) =>
				Effect.gen(function*() {
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
				})
			),
		),
	);
