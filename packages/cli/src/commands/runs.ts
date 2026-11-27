import type { CLIError, Out } from '@kjanat/dreamcli';
import { arg, flag, group } from '@kjanat/dreamcli';
import { Deferred, Effect } from 'effect';
import type { Client } from '@/cli/client/api';
import { base, connected } from '@/cli/command';
import { checkoutRepository } from '@/cli/git-checkout';
import { followInterval, followRelease } from '@/cli/render/follow';
import { lookOf, step } from '@/cli/render/look';
import { executionTable, executionView } from '@/cli/render/views';
import { routes } from '@/contract/routes';
import type { ExecutionStateView, ExecutionView } from '@/contract/views';
import { executionStates } from '@/contract/views';
import { checkChoices } from '@/domain/release-gates.ts';
import { approvalShaPattern } from '@/kernel/schema/ids.ts';

const recoveryVerb = { reconcile: 'Reconciling', retry: 'Retrying', redispatch: 'Dispatching' } as const;
const checkVerb = {
	rerun: 'Rerunning the checks of',
	skip: 'Skipping the checks of',
	always: 'Switching off the checks of',
} as const;

interface RunFilters {
	repository?: string | undefined;
	all: boolean;
	stream?: string | undefined;
	operation?: string | undefined;
	state: readonly ExecutionStateView[];
	version?: string | undefined;
	limit?: number | undefined;
}

const ownerName = /^[\w.-]+\/[\w.-]+$/;

function listedRepository(
	client: Client,
	filters: Pick<RunFilters, 'repository' | 'all'>,
	cwd = process.cwd(),
): Effect.Effect<string | undefined, CLIError> {
	return Effect.gen(function*() {
		if (filters.all) return undefined;
		if (filters.repository === undefined) {
			return yield* checkoutRepository(cwd).pipe(Effect.orElseSucceed(() => undefined));
		}
		if (ownerName.test(filters.repository)) return filters.repository;
		return (yield* client.call(routes.repositoriesResolve, { repository: filters.repository })).name;
	});
}

export function slimRun(run: ExecutionView) {
	const publications = Array.isArray(run.publications)
		? run.publications.flatMap((entry: unknown) => {
			if (typeof entry !== 'object' || entry === null || !('id' in entry) || !('outcome' in entry)) return [];
			return [{ id: entry.id, outcome: entry.outcome }];
		})
		: [];
	return {
		id: run.id,
		repository: run.repository,
		stream: run.stream,
		operation: run.operation,
		state: run.state,
		version: run.version,
		sourceSha: run.sourceSha,
		updatedAt: run.updatedAt,
		publications,
	};
}

function serverFilter(repository: string | undefined, filters: RunFilters) {
	return {
		...(repository === undefined ? {} : { repository }),
		...(filters.stream === undefined ? {} : { stream: filters.stream }),
		...(filters.operation === undefined ? {} : { operation: filters.operation }),
		...(filters.state.length ? { states: filters.state.join(',') } : {}),
		...(filters.version === undefined ? {} : { version: filters.version }),
		...(filters.limit === undefined ? {} : { limit: filters.limit }),
	};
}

function watchApproval(client: Client, out: Out, queued: ExecutionView) {
	return Effect.gen(function*() {
		const input = process.stdin;
		const id = { id: queued.id, repositoryId: queued.repositoryId };
		const key = yield* Deferred.make<'detach' | 'cancel' | 'force'>();
		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const raw = input.isRaw;
				const paused = input.isPaused();
				const receive = (data: Buffer) => {
					const pressed = data.toString();
					const action = pressed === '\x03'
						? 'cancel'
						: pressed === 'q'
						? 'detach'
						: pressed === 'f'
						? 'force'
						: undefined;
					if (action) Deferred.doneUnsafe(key, Effect.succeed(action));
				};
				input.setRawMode(true);
				input.on('data', receive);
				input.resume();
				return () => {
					input.off('data', receive);
					input.setRawMode(raw);
					if (paused || !input.listenerCount('data')) input.pause();
				};
			}),
			restore => Effect.sync(restore),
		);
		out.status('q detach · Ctrl+C cancel release · f force publish');
		let current = queued;
		const poll = Effect.gen(function*() {
			while (true) {
				yield* client.pause(followInterval);
				const next = yield* client.call(routes.executionsGet, id);
				if (!next.pendingApproval) return next;
				if (next.reason && next.reason !== current.reason) out.status(next.reason);
				current = next;
			}
		});
		const result = yield* Effect.raceFirst(Deferred.await(key), poll);
		if (result === 'cancel') {
			const cancelled = yield* step(
				out,
				'Cancelling the release',
				client.call(routes.executionsCancel, id),
				() => 'Release cancelled',
			);
			out.setExitCode(130);
			return cancelled;
		}
		if (result === 'force') {
			return yield* step(
				out,
				'Forcing publication',
				client.call(routes.executionsApprove, {
					...id,
					sourceSha: queued.sourceSha,
					force: true,
				}),
				() => 'Forced publication started',
			);
		}
		if (result === 'detach') return current;
		if (result.state === 'awaiting-approval' || result.state === 'failed' || result.state === 'cancelled') {
			out.setExitCode(1);
		}
		return result;
	}).pipe(Effect.scoped);
}

export const runs = group('runs').description('Follow, publish, cancel and recover release operations')
	.command(
		base('list', 'List release operations; in a Git checkout only that repository, unless --all')
			.example('beepboop runs list', "This checkout's repository, or every repository outside a checkout")
			.example('beepboop runs list --all --state failed --state blocked', 'Failed and blocked runs everywhere')
			.example('beepboop runs list --repository owner/name --stream main --limit 5', 'The latest runs of one stream')
			.flag(
				'repository',
				flag.string().env('BEEPBOOP_REPOSITORY').describe(
					'Repository: name, owner/name or GitHub URL; default the checkout',
				),
			)
			.flag(
				'all',
				flag.boolean().default(false).describe('List every repository, ignoring the checkout and --repository'),
			)
			.flag('stream', flag.string().describe('Only this release stream'))
			.flag('operation', flag.string().describe('Only this operation, such as prepare or promote'))
			.flag('state', flag.array(flag.enum(executionStates)).describe('Only these states; repeat it'))
			.flag('releaseVersion', flag.string().describe('Only this version'))
			.flag('limit', flag.number().int().min(1).max(200).describe('Show at most this many runs, 1 to 200'))
			.flag('full', flag.boolean().default(false).describe('With --json, print whole records instead of the summary'))
			.action(connected((client, { flags, out }) =>
				Effect.gen(function*() {
					const filters = {
						repository: flags.repository,
						all: flags.all,
						stream: flags.stream,
						operation: flags.operation,
						state: flags.state ?? [],
						version: flags.releaseVersion,
						limit: flags.limit,
					};
					const repository = yield* listedRepository(client, filters);
					const found = yield* step(
						out,
						'Listing release operations',
						client.call(routes.executionsList, serverFilter(repository, filters)),
						rows => `${rows.length} ${rows.length === 1 ? 'operation' : 'operations'}`,
					);
					yield* executionTable(out, found, flags.full ? found : found.map(slimRun));
				})
			)),
	)
	.command(
		base('publish', 'Publish a release waiting for you, from the exact reviewed source commit')
			.alias('approve')
			.details(
				'While Beepboop waits for checks, press q to detach, Ctrl+C to cancel the release, or f to force publication. After detaching, use runs cancel or runs publish --force.',
			)
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'sourceSha',
				flag.string({ pattern: approvalShaPattern }).describe('Reviewed commit SHA, full or at least 7 characters')
					.prompt({ kind: 'input', message: 'Reviewed source commit SHA (7+ characters)' })
					.required(),
			)
			.flag(
				'force',
				flag.boolean().default(false).describe('Publish even when the signature or checks fail or are running'),
			)
			.flag(
				'detach',
				flag.boolean().default(false).describe('Queue publication if checks are running and return immediately'),
			)
			.action(connected((client, { flags, args, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					const approved = yield* step(
						out,
						`Approving ${look.id(args.id)} at ${look.sha(flags.sourceSha)}`,
						client.call(routes.executionsApprove, {
							id: args.id,
							sourceSha: flags.sourceSha,
							force: flags.force,
							waitForChecks: true,
						}),
						run => run.pendingApproval ? 'Approval queued' : `Publishing ${look.id(run.id)} started`,
					);
					const interactive = !out.jsonMode && process.stdin.isTTY && process.stderr.isTTY;
					let run = approved;
					if (approved.pendingApproval && interactive && !flags.detach) {
						if (approved.reason) out.status(approved.reason);
						run = yield* watchApproval(client, out, approved);
					}
					if (run.pendingApproval && !out.jsonMode) {
						out.status('Beepboop will publish after the checks pass.');
					}
					yield* executionView(out, run);
				})
			)),
	)
	.command(
		base('checks', 'Rerun the checks that stop a release, or release without them')
			.details(
				'`rerun` reruns the failed jobs of each failing check and waits for them. `skip` releases this release without the checks that stop it. `always` switches those checks off for every later release of the stream.',
			)
			.example('beepboop runs checks EXECUTION_ID --choice rerun', 'Rerun the failed checks and wait')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required())
			.flag(
				'choice',
				flag.enum(checkChoices).prompt({ kind: 'select', message: 'What next?' }).required().describe(
					'rerun, skip or always',
				),
			)
			.action(connected((client, { flags, args, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					yield* executionView(
						out,
						yield* step(
							out,
							`${checkVerb[flags.choice]} ${look.id(args.id)}`,
							client.call(routes.executionsChecks, { id: args.id, choice: flags.choice }),
							execution => `${look.id(execution.id)} is ${execution.state}`,
						),
					);
				})
			)),
	)
	.command(
		base('cancel', 'Cancel an operation and its running workflow')
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required())
			.action(connected((client, { args, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					yield* executionView(
						out,
						yield* step(
							out,
							`Cancelling ${look.id(args.id)}`,
							client.call(routes.executionsCancel, { id: args.id }),
							cancelled => `Cancelled ${look.id(cancelled.id)}`,
						),
					);
				})
			)),
	)
	.command(
		base('backfill', 'Run a configured operation for a published release')
			.arg('id', arg.string().required())
			.arg('operation', arg.string().required())
			.action(
				connected((client, { args, out }) =>
					client.call(routes.executionsBackfill, { id: args.id, operation: args.operation }).pipe(
						Effect.flatMap(run => executionView(out, run)),
					)
				),
			),
	)
	.command(
		base('recover', 'Reconcile an operation, retry it, or run the current workflow for its release commit')
			.details(
				[
					'`reconcile` rereads the operation from GitHub. `retry` re-runs the failed jobs of its workflow run, or dispatches a new run.',
					'`redispatch` runs the workflow at the head of the stream workflow ref for a failed or cancelled promotion whose version tags already target its release commit. The workflow must check out the `sourceSha` from `actions/begin`. Use it when the fix for the failure is in the workflow and the version tag cannot move. The command follows the release.',
				].join('\n\n'),
			)
			.example('beepboop runs recover EXECUTION_ID --action retry', 'Re-run the failed jobs')
			.example(
				'beepboop runs recover EXECUTION_ID --action redispatch',
				'Release the tagged commit with the current workflow',
			)
			.arg('id', arg.string().prompt({ kind: 'input', message: 'Execution ID' }).required()).flag(
				'action',
				flag.enum(['reconcile', 'retry', 'redispatch']).prompt({ kind: 'select', message: 'Recovery action' })
					.default('reconcile'),
			)
			.action(connected((client, { flags, args, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					const recovered = yield* step(
						out,
						`${recoveryVerb[flags.action]} ${look.id(args.id)}`,
						client.call(routes.executionsRecover, { id: args.id, action: flags.action }),
						execution => `${look.id(execution.id)} is ${execution.state}`,
					);
					if (flags.action !== 'redispatch' || out.jsonMode || recovered.version === undefined) {
						return yield* executionView(out, recovered);
					}
					return yield* followRelease(client, out, {
						repository: recovered.repository,
						repositoryId: recovered.repositoryId,
						defaultBranch: '',
						stream: recovered.stream,
						version: recovered.version,
						execution: recovered,
						bumped: false,
						promotion: recovered.id,
					});
				})
			)),
	);
