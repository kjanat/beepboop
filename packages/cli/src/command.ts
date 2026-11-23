import type { CLIError } from '@kjanat/dreamcli';
import { arg, command, flag } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { Client } from '@/cli/client/api';
import { defaultServer } from '@/cli/config';
import { diagnostics } from '@/cli/render/output';
import { routes } from '@/contract/routes';

export const base = (name: string, description: string, promptServer = false) =>
	command(name).description(description)
		.flag('verbose', flag.boolean().default(false).describe('Show structured API error details on stderr'))
		.middleware(diagnostics)
		.flag(
			'server',
			(promptServer
				? flag.string().env('BEEPBOOP_SERVER').prompt({
					kind: 'input',
					message: 'Beepboop server URL',
					default: defaultServer,
				})
				: flag.string().env('BEEPBOOP_SERVER')).default(defaultServer).describe(
					'Beepboop server origin',
				),
		);
export const repositoryArg = arg.string().prompt({
	kind: 'input',
	message: 'Repository (name, owner/name or GitHub URL)',
})
	.required().describe('Repository: name, owner/name or GitHub URL');
export const checkoutArg = arg.string().optional().describe('Repository override; otherwise the current Git remote');
export const repository = (name: string, description: string) =>
	base(name, description).arg('repository', repositoryArg);
export function enrolled(client: Client, repository: string) {
	return client.call(routes.repositoriesResolve, { repository });
}

export function runCommand(work: Effect.Effect<unknown, CLIError>): Promise<void> {
	return Effect.runPromise(Effect.asVoid(work));
}

export function connected<P extends { flags: { server: string } }>(
	work: (client: Client, params: P) => Effect.Effect<unknown, CLIError>,
): (params: P) => Promise<void> {
	return params => runCommand(Client.at(params.flags.server).pipe(Effect.flatMap(client => work(client, params))));
}
