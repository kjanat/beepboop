import type { CLIError, CLISchema, CommandSchema, CompletionContext, CompletionHandler } from '@kjanat/dreamcli';
import { flag, parse } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { Client } from '@/cli/client/api';
import { defaultServer } from '@/cli/config';
import { checkoutRepository } from '@/cli/git-checkout';
import { routes } from '@/contract/routes';
import { parseSetupPlan } from '@/setup/plan.ts';
import type { SetupPlan } from '@/setup/types.ts';

function flagValue(argv: readonly string[], name: string): string | undefined {
	let value: string | undefined;
	for (const [index, token] of argv.entries()) {
		if (token === `--${name}`) value = argv[index + 1];
		else if (token.startsWith(`--${name}=`)) value = token.slice(name.length + 3);
	}
	return value;
}

function adoptedRepository(
	{ argv, commandPath }: CompletionContext,
	schema: CLISchema,
): Effect.Effect<string, CLIError> {
	let commands = schema.commands, offset = 0, selected: CommandSchema | undefined;
	for (const name of commandPath) {
		selected = commands.find(command => command.name === name);
		if (!selected) return checkoutRepository(process.cwd());
		const command = selected;
		const index = argv.findIndex((token, index) =>
			index >= offset && (token === command.name || command.aliases.includes(token))
		);
		if (index < 0) return checkoutRepository(process.cwd());
		offset = index + 1;
		commands = selected.commands;
	}
	if (!selected) return checkoutRepository(process.cwd());
	const builtins = Object.fromEntries(
		Object.entries(schema.builtins)
			.filter(([, mode]) => mode === 'on')
			.map(([name]) => [
				name,
				(name === 'quiet' ? flag.boolean().alias('q') : name === 'help' ? flag.boolean().alias('h') : flag.boolean())
					.schema,
			]),
	);
	const repository =
		parse({ ...selected, flags: { ...builtins, ...selected.flags } }, argv.slice(offset)).args.repository;
	if (typeof repository === 'string' && repository) return Effect.succeed(repository);
	return checkoutRepository(process.cwd());
}

function candidates(pick: (plan: SetupPlan) => readonly string[]): CompletionHandler {
	return context =>
		Effect.runPromise(Effect.gen(function*() {
			const { app } = yield* Effect.promise(() => import('@/cli/main'));
			const client = yield* Client.at(
				flagValue(context.argv, 'server') ?? context.env.BEEPBOOP_SERVER ?? defaultServer,
			);
			const repository = yield* adoptedRepository(context, app.schema);
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
		...plan.choices.streams.flatMap(stream => stream.release?.binaries?.builds ?? []),
		...(plan.binaryCandidates ?? []).map(candidate => candidate.build),
	].map(build => build.name)
);
