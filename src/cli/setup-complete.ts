import type { CLIError, CompletionContext, CompletionHandler } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupPlan } from '@/automation/setup-types';
import { Client } from '@/cli/client';
import { checkoutRepository } from '@/cli/release';
import { routes } from '@/contract/routes';

export const defaultServer = 'https://beepboop.kjanat.dev';

function flagValue(argv: readonly string[], name: string): string | undefined {
	let value: string | undefined;
	for (const [index, token] of argv.entries()) {
		if (token === `--${name}`) value = argv[index + 1];
		else if (token.startsWith(`--${name}=`)) value = token.slice(name.length + 3);
	}
	return value;
}

function adoptedRepository({ argv, commandPath }: CompletionContext): Effect.Effect<string, CLIError> {
	const [first] = argv.slice(commandPath.length);
	return first && !first.startsWith('-') ? Effect.succeed(first) : checkoutRepository(process.cwd());
}

function candidates(pick: (plan: SetupPlan) => readonly string[]): CompletionHandler {
	return context =>
		Effect.runPromise(Effect.gen(function*() {
			const client = yield* Client.at(
				flagValue(context.argv, 'server') ?? context.env.BEEPBOOP_SERVER ?? defaultServer,
			);
			const repository = yield* adoptedRepository(context);
			return pick(yield* parseSetupPlan(yield* client.call(routes.setupPreview, { repository })));
		}));
}

export const packageCandidates = candidates(plan =>
	plan.inventory.packages.map((pkg, index) =>
		plan.inventory.packages.filter(other => other.name === pkg.name).length === 1
			? pkg.name
			: plan.packageIds[index] ?? pkg.name
	)
);

export const binaryCandidates = candidates(plan =>
	[
		...plan.choices.streams.flatMap(stream => stream.promote?.binaries?.builds ?? []),
		...(plan.binaryCandidates ?? []).map(candidate => candidate.build),
	].map(build => build.name)
);
