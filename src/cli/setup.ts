import type { Ask, CLIError, Out } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { repositoryReference } from '@/automation/repository-name';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupPlan } from '@/automation/setup-types';
import type { Client } from '@/cli/client';
import { emit, failure } from '@/cli/output';
import { chooseSetup } from '@/cli/setup-choices';
import { listed, streamSummary } from '@/cli/setup-summary';
import { routes } from '@/contract/routes';

function readJson(path: string): Effect.Effect<unknown, CLIError> {
	return Effect.tryPromise({
		try: (): Promise<unknown> => Bun.file(path).json(),
		catch: () => failure(`${path} is not readable JSON`, 'INVALID_FILE'),
	});
}
function parsePlan(value: unknown): Effect.Effect<SetupPlan, CLIError> {
	return parseSetupPlan(value).pipe(Effect.mapError(error => failure(error.message, 'INVALID_PLAN')));
}
export function setupRepository(
	client: Client,
	repository: string,
	flags: { choices?: string; plan?: string; apply: boolean; output?: string },
	ask: Ask,
	out: Out,
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		if (flags.plan) {
			if (!flags.apply || flags.choices) {
				return yield* Effect.fail(failure('Use --plan with --apply, without --choices', 'INVALID_FLAGS'));
			}
			const reviewed = yield* parsePlan(yield* readJson(flags.plan));
			const requested = yield* repositoryReference(repository).pipe(
				Effect.mapError(error => failure(error.message, 'INVALID_REPOSITORY')),
			);
			if (
				requested.owner
					? reviewed.repository !== `${requested.owner}/${requested.name}`
					: !reviewed.repository.endsWith(`/${requested.name}`)
			) {
				return yield* Effect.fail(failure('The reviewed plan belongs to another repository', 'PLAN_MISMATCH'));
			}
			yield* emit(
				out,
				yield* client.call(routes.setupApply, {
					repository,
					choices: reviewed.choices,
					planId: reviewed.planId,
					sourceSha: reviewed.sourceSha,
					setupHead: reviewed.setupHead,
				}),
			);
			return;
		}
		if (flags.apply) {
			return yield* Effect.fail(failure('--apply needs --plan pointing to a reviewed preview', 'PLAN_REQUIRED'));
		}
		yield* client.call(routes.repositoriesResolve, { repository }).pipe(
			Effect.catchIf(
				error => error.code === 'NOT_FOUND',
				() => client.call(routes.repositoriesDiscover, { repository }),
			),
		);
		const initial = yield* parsePlan(yield* client.call(routes.setupPreview, { repository }));
		const reviewing = !!flags.choices || !!flags.output || out.jsonMode;
		const describe = (plan: SetupPlan) => {
			out.log(`Proposed setup for ${plan.repository} at ${plan.sourceSha}:`);
			for (const stream of plan.choices.streams) {
				out.log(`Release group ${stream.name}:\n${streamSummary(stream, plan).map(line => `- ${line}`).join('\n')}`);
			}
			if (plan.edits.length) out.log(`The setup PR writes ${listed(plan.edits.map(edit => edit.path))}.`);
			for (const message of [...plan.blockers, ...plan.notes]) out.log(message);
		};
		const open = (plan: SetupPlan) =>
			client.call(routes.setupApply, {
				repository,
				choices: plan.choices,
				planId: plan.planId,
				sourceSha: plan.sourceSha,
				setupHead: plan.setupHead,
			}).pipe(Effect.map(result => out.log(`Setup PR: ${result.url}`)));
		if (!reviewing) {
			describe(initial);
			if (!initial.blockers.length && !initial.edits.length) return out.log('Release setup already matches.');
			if (!initial.blockers.length) {
				const accepted = !out.isTTY || (yield* Effect.promise(() =>
					ask({
						kind: 'confirm',
						message: 'Open or refresh the setup PR with this proposal? Answer no to choose the setup yourself.',
						default: true,
					})
				));
				if (accepted) return yield* open(initial);
			} else if (!out.isTTY) return out.setExitCode(1);
		}
		const choices: unknown = flags.choices
			? yield* readJson(flags.choices)
			: out.jsonMode || flags.output
			? initial.choices
			: yield* chooseSetup(initial, ask, out);
		const preview = yield* client.call(routes.setupPreview, { repository, choices });
		const plan = yield* parsePlan(preview);
		const output = flags.output;
		if (output) yield* Effect.promise(() => Bun.write(output, `${JSON.stringify(preview, null, 2)}\n`));
		if (out.jsonMode) return yield* emit(out, preview);
		if (output) {
			describe(plan);
			if (plan.blockers.length) return out.setExitCode(1);
			return out.log(`Open the setup PR with: beepboop adopt ${repository} --plan ${output} --apply`);
		}
		out.log(`Inspected commit: ${plan.sourceSha}`);
		for (const edit of plan.edits) out.log(`\n${edit.path}\nCurrent:\n${edit.before}\nProposed:\n${edit.after}`);
		for (const message of [...plan.blockers, ...plan.notes]) out.log(message);
		if (plan.blockers.length) return out.setExitCode(1);
		if (!plan.edits.length) return out.log('Release setup already matches.');
		if (
			!flags.choices
			&& (yield* Effect.promise(() =>
				ask({ kind: 'confirm', message: 'Open or refresh the setup PR with these exact changes?', default: false })
			))
		) {
			const result = yield* client.call(routes.setupApply, {
				repository,
				choices,
				planId: plan.planId,
				sourceSha: plan.sourceSha,
				setupHead: plan.setupHead,
			});
			out.log(result.url);
		}
	});
}
