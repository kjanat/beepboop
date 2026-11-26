import type { CLIError, InteractiveResult, Out } from '@kjanat/dreamcli';
import { arg, flag, group } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { Client } from '@/cli/client/api';
import { base, connected, enrolled, repository, runCommand } from '@/cli/command';
import { releaseVersion } from '@/cli/commands/release/index';
import { readJson } from '@/cli/json-file';
import { lookOf, step } from '@/cli/render/look';
import { emit, failure } from '@/cli/render/output';
import { executionTable, executionView, planView } from '@/cli/render/views';
import { routes } from '@/contract/routes';
import { executionView as executionViewSchema } from '@/contract/views';
import { shaPattern } from '@/kernel/schema/ids.ts';
import { safeDecode } from '@/kernel/schema/structs.ts';

interface Review {
	plan: string;
	prepare: string;
	subject: string;
}
interface ReviewFlags {
	server: string;
	stream: string;
	sourceSha?: string | undefined;
	planId?: string | undefined;
}
type ReleaseRequest<I> = I & { repositoryId: number; stream: string };
interface ReleaseReview<I> {
	review: Review;
	operation: string;
	flags: ReviewFlags;
	repository: string;
	input: Effect.Effect<I, CLIError>;
	selection: string;
	plan(client: Client, request: ReleaseRequest<I>): Effect.Effect<unknown, CLIError>;
	prepare(
		client: Client,
		request: ReleaseRequest<I> & { sourceSha: string; planId: string },
	): Effect.Effect<unknown, CLIError>;
}
const singleReview: Review = { plan: 'plan', prepare: 'prepare', subject: 'Prepare' };
const setReview: Review = { plan: 'plan-set', prepare: 'prepare-set', subject: 'prepare-set' };
const releaseStream = flag.string().prompt({ kind: 'input', message: 'Release stream' }).required();
const reviewFlags = (review: Review) => ({
	sourceSha: flag.string({ pattern: shaPattern }).describe(
		`Required for ${review.prepare}: source SHA from ${review.plan}`,
	),
	planId: flag.string().describe(`Required for ${review.prepare}: plan identity from ${review.plan}`),
});
function reviewPrompts(review: Review, operation: string): InteractiveResult {
	return operation === review.prepare
		? {
			sourceSha: { kind: 'input', message: 'Reviewed source SHA from plan' },
			planId: { kind: 'input', message: 'Plan ID from preview' },
		}
		: {};
}
function reviewRelease<I extends object>(
	{ review, operation, flags, repository, input, selection, plan, prepare }: ReleaseReview<I>,
	out: Out,
): Promise<void> {
	return runCommand(out)(Effect.gen(function*() {
		if (operation === review.prepare && (!flags.sourceSha || !flags.planId)) {
			return yield* Effect.fail(failure(
				`${review.subject} needs --sourceSha and --planId`,
				'PLAN_REQUIRED',
				`Run beepboop releases ${review.plan} first`,
			));
		}
		const client = yield* Client.at(flags.server);
		const look = lookOf(out);
		const target = yield* step(
			out,
			`Reading ${look.pkg(repository)}`,
			enrolled(client, repository),
			found => `${look.pkg(found.name)} at ${look.sha(found.sha)}`,
		);
		const request = { repositoryId: target.id, stream: flags.stream, ...(yield* input) };
		if (operation === review.plan) {
			const planned = yield* step(
				out,
				`Planning ${target.name} / ${flags.stream} on the server`,
				plan(client, request),
				() => 'Plan is ready',
			);
			return yield* planView(
				out,
				planned,
				(sourceSha, planId) =>
					`beepboop releases ${review.prepare} ${target.name} --stream ${flags.stream} ${selection} --sourceSha ${sourceSha} --planId ${planId}`,
			);
		}
		if (flags.sourceSha && flags.planId) {
			const prepared = yield* step(
				out,
				`Preparing ${target.name} / ${flags.stream}`,
				prepare(client, { ...request, sourceSha: flags.sourceSha, planId: flags.planId }),
				() => 'Preparation is queued',
			);
			const view = safeDecode(executionViewSchema, prepared);
			yield* view.success ? executionView(out, view.data) : emit(out, prepared);
		}
	}));
}
let releaseGroup = group('releases').description('Preview and prepare releases through repository policy');
for (const operation of ['plan', 'prepare'] as const) {
	const reviewed = reviewFlags(singleReview);
	releaseGroup = releaseGroup.command(
		repository(
			operation,
			operation === 'plan'
				? 'Preview a release without changing the repository'
				: 'Prepare a release from a reviewed plan',
		)
			.flag('stream', releaseStream).flag(
				'releaseVersion',
				flag.string().prompt({ kind: 'input', message: 'Version or bump (major, minor, patch)' }).required(),
			)
			.flag('sourceSha', reviewed.sourceSha)
			.flag('planId', reviewed.planId)
			.interactive(() => reviewPrompts(singleReview, operation))
			.action(({ flags, args, out }) =>
				reviewRelease({
					review: singleReview,
					operation,
					flags,
					repository: args.repository,
					input: releaseVersion(flags.releaseVersion).pipe(Effect.map(version => ({ version }))),
					selection: `--releaseVersion ${flags.releaseVersion}`,
					plan: (client, request) => client.call(routes.releasesPlan, request),
					prepare: (client, request) => client.call(routes.releasesPrepare, { ...request, start: false }),
				}, out)
			),
	);
}
for (const operation of ['plan-set', 'prepare-set'] as const) {
	const reviewed = reviewFlags(setReview);
	releaseGroup = releaseGroup.command(
		repository(
			operation,
			operation === 'plan-set'
				? 'Preview an independent monorepo release'
				: 'Prepare an independent monorepo release from a reviewed plan',
		)
			.flag('stream', releaseStream)
			.flag(
				'plan',
				flag.path({ type: 'file' }).prompt({ kind: 'input', message: 'Release plan JSON file' }).required().describe(
					'Release plan JSON file',
				),
			)
			.flag('sourceSha', reviewed.sourceSha)
			.flag('planId', reviewed.planId)
			.interactive(() => reviewPrompts(setReview, operation))
			.action(({ flags, args, out }) =>
				reviewRelease({
					review: setReview,
					operation,
					flags,
					repository: args.repository,
					input: readJson(flags.plan).pipe(Effect.map(plan => ({ plan }))),
					selection: `--plan ${flags.plan}`,
					plan: (client, request) => client.call(routes.releasesPlanSet, request),
					prepare: (client, request) => client.call(routes.releasesPrepareSet, request),
				}, out)
			),
	);
}
export const releases = releaseGroup.command(
	base('start', 'Start publication for a completed monorepo release set')
		.arg('preparationId', arg.string().prompt({ kind: 'input', message: 'Preparation ID' }).required()).flag(
			'sourceSha',
			flag.string({ pattern: shaPattern }).prompt({ kind: 'input', message: 'Reviewed source commit SHA' })
				.required(),
		)
		.action(connected((client, { flags, args, out }) =>
			Effect.gen(function*() {
				const look = lookOf(out);
				yield* executionTable(
					out,
					yield* step(
						out,
						`Starting the release set ${look.id(args.preparationId)} at ${look.sha(flags.sourceSha)}`,
						client.call(routes.releasesStartSet, {
							preparationId: args.preparationId,
							sourceSha: flags.sourceSha,
						}),
						started => `Started ${started.length} ${started.length === 1 ? 'operation' : 'operations'}`,
					),
				);
			})
		)),
);
