import type { Ask, CLIError, Out } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { repositoryReference } from '@/automation/repository-name';
import { parseSetupPlan } from '@/automation/setup-plan';
import { listed, streamSummary } from '@/automation/setup-summary';
import type { SetupPlan } from '@/automation/setup-types';
import type { Client } from '@/cli/client';
import { readJson } from '@/cli/json-file';
import type { Look } from '@/cli/look';
import { lookOf, registryOf, step, table } from '@/cli/look';
import { emit, failure } from '@/cli/output';
import { chooseSetup } from '@/cli/setup-choices';
import { routes } from '@/contract/routes';

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
		const look = lookOf(out);
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
				yield* step(
					out,
					`Opening the setup PR for ${look.pkg(reviewed.repository)}`,
					client.call(routes.setupApply, {
						repository,
						choices: reviewed.choices,
						planId: reviewed.planId,
						sourceSha: reviewed.sourceSha,
						setupHead: reviewed.setupHead,
					}),
					result => `Setup PR ${look.link(result.url)}`,
				),
			);
			return;
		}
		if (flags.apply) {
			return yield* Effect.fail(failure('--apply needs --plan pointing to a reviewed preview', 'PLAN_REQUIRED'));
		}
		yield* step(
			out,
			`Inspecting ${look.pkg(repository)}`,
			client.call(routes.repositoriesResolve, { repository }).pipe(
				Effect.catchIf(
					error => error.code === 'NOT_FOUND',
					() => client.call(routes.repositoriesDiscover, { repository }),
				),
			),
			found => `Inspected ${look.pkg(found.name)} at ${look.sha(found.sha)}`,
		);
		const initial = yield* step(
			out,
			'Building the setup plan',
			client.call(routes.setupPreview, { repository }).pipe(Effect.flatMap(parsePlan)),
			plan => `Setup plan for ${look.sha(plan.sourceSha)} is ready`,
		);
		const reviewing = !!flags.choices || !!flags.output || out.jsonMode;
		const describe = (plan: SetupPlan) => {
			out.log(look.heading(`Proposed setup for ${look.pkg(plan.repository)} at ${look.sha(plan.sourceSha)}:`));
			for (const stream of plan.choices.streams) {
				out.log(`Release group ${stream.name}:\n${streamSummary(stream, plan).map(line => `- ${line}`).join('\n')}`);
				const rows = packageRows(plan, stream.packages, stream.required, look);
				if (rows.length) table(out, rows);
				const targets = targetRows(plan, stream, look);
				if (targets.length) table(out, targets);
			}
			if (plan.edits.length) out.log(`The setup PR writes ${listed(plan.edits.map(edit => edit.path))}.`);
			for (const message of plan.blockers) out.log(look.state('failed', message));
			for (const message of plan.notes) out.log(message);
		};
		const opened = (plan: SetupPlan) =>
			step(
				out,
				'Opening the setup PR',
				client.call(routes.setupApply, {
					repository,
					choices: plan.choices,
					planId: plan.planId,
					sourceSha: plan.sourceSha,
					setupHead: plan.setupHead,
				}),
				result => `Setup PR ${look.link(result.url)}`,
			);
		const open = (plan: SetupPlan) =>
			opened(plan).pipe(Effect.map(result => out.log(`Setup PR: ${look.link(result.url)}`)));
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
		const preview = yield* step(
			out,
			'Building the setup plan from your choices',
			client.call(routes.setupPreview, { repository, choices }),
			() => 'Setup plan is ready',
		);
		const plan = yield* parsePlan(preview);
		const output = flags.output;
		if (output) yield* Effect.promise(() => Bun.write(output, `${JSON.stringify(preview, null, 2)}\n`));
		if (out.jsonMode) return yield* emit(out, preview);
		if (output) {
			describe(plan);
			if (plan.blockers.length) return out.setExitCode(1);
			return out.log(`Open the setup PR with: beepboop adopt ${repository} --plan ${output} --apply`);
		}
		out.log(`Inspected commit: ${look.sha(plan.sourceSha)}`);
		for (const edit of plan.edits) {
			out.log(`\n${look.heading(edit.path)}\nCurrent:\n${edit.before}\nProposed:\n${edit.after}`);
		}
		for (const message of plan.blockers) out.log(look.state('failed', message));
		for (const message of plan.notes) out.log(message);
		if (plan.blockers.length) return out.setExitCode(1);
		if (!plan.edits.length) return out.log('Release setup already matches.');
		if (
			!flags.choices
			&& (yield* Effect.promise(() =>
				ask({ kind: 'confirm', message: 'Open or refresh the setup PR with these exact changes?', default: false })
			))
		) {
			const result = yield* step(
				out,
				'Opening the setup PR',
				client.call(routes.setupApply, {
					repository,
					choices,
					planId: plan.planId,
					sourceSha: plan.sourceSha,
					setupHead: plan.setupHead,
				}),
				applied => `Setup PR ${look.link(applied.url)}`,
			);
			out.log(look.link(result.url));
		}
	});
}

function packageRows(plan: SetupPlan, ids: readonly string[], required: readonly string[], look: Look) {
	return ids.flatMap(id => {
		const pkg = plan.inventory.packages[plan.packageIds.indexOf(id)];
		return pkg
			? [{
				package: look.pkg(pkg.name),
				registry: pkg.manager ? registryOf(pkg.manager) : 'unknown',
				manifest: pkg.manifest,
				release: required.includes(id) ? look.state('published', 'required') : look.state('skipped', 'optional'),
			}]
			: [];
	});
}
function targetRows(plan: SetupPlan, stream: SetupPlan['choices']['streams'][number], look: Look) {
	const release = stream.promote?.binaries;
	return (release?.builds ?? []).flatMap(build => {
		const candidate = plan.binaryCandidates?.find(entry => entry.build.name === build.name);
		return release?.targets.map(target => {
			const failing = candidate !== undefined && !candidate.targets.includes(target);
			return {
				binary: look.pkg(build.name),
				target,
				build: failing ? look.state('failed', 'expected to fail') : look.state('published', 'builds'),
			};
		}) ?? [];
	});
}
