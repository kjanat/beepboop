import type { Ask, CLIError, Out, ProgressHandle } from '@kjanat/dreamcli';
import { Effect, Schema } from 'effect';
import type { Client } from '@/cli/client/api';
import type { Look, State } from '@/cli/render/look';
import { lookOf, registryOf, table } from '@/cli/render/look';
import { failure, prompted, unprompted } from '@/cli/render/output';
import { buildState, stateOf } from '@/cli/render/states';
import { routes } from '@/contract/routes';
import type { BinaryProgress } from '@/contract/views';
import type { CheckChoice } from '@/domain/release-gates.ts';
import { rerunnable, stoppedByGates } from '@/domain/release-gates.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { decodeSync, looseStruct, mutableArray, mutableRecord } from '@/kernel/schema/structs.ts';

const result = looseStruct({
	url: Schema.String,
	head: Schema.String,
	kind: Schema.optional(Schema.Literal('commit')),
});
const tracked = looseStruct({
	id: Schema.String,
	repositoryId: Schema.Finite,
	repository: Schema.String,
	stream: Schema.String,
	operation: Schema.String,
	state: Schema.String,
	version: Schema.optional(Schema.String),
	sourceSha: Schema.String,
	reason: Schema.optional(Schema.String),
	runId: Schema.optional(Schema.Finite),
	approvedBy: Schema.optional(Schema.String),
	release: Schema.optional(looseStruct({ tag: Schema.optional(Schema.String) })),
	draftRelease: Schema.optional(looseStruct({ tag: Schema.String })),
	workflow: Schema.optional(looseStruct({ file: Schema.String })),
	managed: Schema.optional(looseStruct({ result: Schema.optional(result) })),
	prepared: Schema.optional(looseStruct({ result: Schema.optional(result) })),
	publications: mutableArray(
		looseStruct({
			id: Schema.String,
			name: Schema.String,
			manager: Schema.String,
			version: Schema.String,
			outcome: Schema.String,
		}),
	).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
	configuration: Schema.optional(looseStruct({
		streams: mutableRecord(Schema.String, looseStruct({ required: Schema.optional(mutableArray(Schema.String)) })),
	})),
});
type Tracked = Decoded<typeof tracked>;

export const followInterval = 5_000;

export interface Followed {
	repository: string;
	repositoryId: number;
	defaultBranch: string;
	stream: string;
	version: string;
	execution: { id: string };
	bumped: boolean;
	promotion?: string;
}

function runUrl(execution: Tracked): string | undefined {
	return execution.runId ? `https://github.com/${execution.repository}/actions/runs/${execution.runId}` : undefined;
}

function links(out: Out, look: Look, execution: Tracked): void {
	const run = runUrl(execution);
	const tag = execution.release?.tag ?? execution.draftRelease?.tag;
	if (run) out.log(`Run: ${look.link(run)}`);
	if (tag && execution.state === 'succeeded') {
		out.log(`GitHub release: ${look.link(`https://github.com/${execution.repository}/releases/tag/${tag}`)}`);
	}
}

function publicationRows(look: Look, execution: Tracked) {
	return execution.publications.map(publication => {
		const state = stateOf('publication', publication.outcome);
		return {
			package: look.pkg(publication.name),
			registry: registryOf(publication.manager),
			version: look.version(publication.version),
			state: `${look.mark(state)} ${look.state(state, publication.outcome)}`,
		};
	});
}

interface Stage {
	label: string;
	total: number;
	done: number;
	complete: boolean;
	failed: boolean;
	summary: string;
}

function stages(promotion: Tracked, binaries: BinaryProgress, finished: boolean): Stage[] {
	const legs = binaries.legs;
	const ended = legs.filter(leg => leg.status === 'completed' || buildState(leg) !== 'waiting').length;
	const broken = legs.filter(leg => buildState(leg) === 'failed').length;
	const total = promotion.configuration?.streams[promotion.stream]?.required?.length
		|| promotion.publications.length;
	const published = promotion.publications.filter(publication => publication.outcome === 'succeeded').length;
	const uploaded = binaries.assets.filter(asset => asset.uploaded).length;
	return [
		...(legs.length
			? [{
				label: 'Building binaries',
				total: legs.length,
				done: ended,
				complete: ended === legs.length,
				failed: broken > 0,
				summary: broken ? `${broken} of ${legs.length} builds failed` : `Built ${legs.length} binaries`,
			}]
			: []),
		{
			label: 'Publishing',
			total,
			done: published,
			complete: finished || (total > 0 && published >= total),
			failed: false,
			summary: `Published ${published} of ${total}`,
		},
		...(binaries.assets.length
			? [{
				label: 'Uploading assets',
				total: binaries.assets.length,
				done: uploaded,
				complete: finished || uploaded === binaries.assets.length,
				failed: false,
				summary: `Uploaded ${uploaded} of ${binaries.assets.length} assets`,
			}]
			: []),
	];
}

function binaryRows(look: Look, binaries: BinaryProgress) {
	return binaries.legs.map(leg => {
		const kind = leg.kind ?? leg.state;
		const built = buildState(leg);
		const asset = binaries.assets.find(entry => entry.build === leg.build && entry.target === leg.target);
		const upload: State = asset?.uploaded ? 'published' : 'waiting';
		return {
			binary: look.pkg(leg.build),
			target: leg.target,
			build: `${look.mark(built)} ${look.state(built, kind)}`,
			asset: asset?.name ?? '',
			upload: `${look.mark(upload)} ${look.state(upload, asset?.uploaded ? 'uploaded' : 'waiting')}`,
		};
	});
}

function snapshot(client: Client, followed: Followed): Effect.Effect<Tracked[], CLIError> {
	return client.call(routes.executionsList, {
		repository: followed.repository,
		stream: followed.stream,
		version: followed.version,
	}).pipe(
		Effect.flatMap(rows =>
			Effect.try({
				try: () =>
					decodeSync(mutableArray(tracked), rows).filter(row =>
						row.repositoryId === followed.repositoryId && row.stream === followed.stream
					),
				catch: () => failure('Server returned an invalid execution list', 'INVALID_RESPONSE'),
			})
		),
	);
}

export interface CheckAnswers {
	ask?: Ask;
	yes: boolean;
}

const checkOptions = [
	{ value: 'rerun', label: 'Rerun the failed checks and wait' },
	{ value: 'skip', label: 'Release without the check' },
	{ value: 'always', label: 'Always release without the check' },
	{ value: 'stop', label: 'Stop' },
] as const satisfies readonly { value: CheckChoice | 'stop'; label: string }[];

const [rerunOption, ...laterOptions] = checkOptions;

const chosenNote: Record<CheckChoice, string> = {
	rerun: 'Beepboop reruns the failed checks and publishes once they pass.',
	skip: 'This release ignores the checks that stopped it.',
	always: 'Every later release of this stream ignores these checks too.',
};

function checkChoice(
	answers: CheckAnswers,
	reran: boolean,
	reason: string | undefined,
): Effect.Effect<CheckChoice | 'stop' | 'unanswered', CLIError> {
	const ask = answers.ask;
	if (answers.yes) return Effect.succeed(reran || !rerunnable(reason) ? 'unanswered' : 'rerun');
	if (!ask) return Effect.succeed('unanswered');
	return unprompted(
		prompted(() =>
			ask({
				kind: 'select',
				message: 'The checks stopped the release. What next?',
				choices: rerunnable(reason) ? [rerunOption, ...laterOptions] : [...laterOptions],
			})
		),
		() => Effect.succeed('unanswered'),
	).pipe(
		Effect.map(answer => checkOptions.find(option => option.value === answer)?.value ?? 'unanswered'),
	);
}

export function followRelease(
	client: Client,
	out: Out,
	followed: Followed,
	answers: CheckAnswers = { yes: false },
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		const look = lookOf(out);
		let spinner = out.spinner(
			followed.bumped
				? `Applying the ${look.version(followed.version)} version bump`
				: `Starting the release of ${look.version(followed.version)}`,
		);
		const bars = new Map<string, { handle: ProgressHandle; done: number }>();
		const open = () => [...bars.values()].filter(bar => bar.done >= 0);
		const advance = (phases: readonly Stage[]) => {
			for (const stage of phases) {
				const bar = bars.get(stage.label)
					?? { handle: out.progress({ total: stage.total, label: stage.label, concurrent: true }), done: 0 };
				if (bar.done < 0) continue;
				if (!bars.has(stage.label)) {
					bars.set(stage.label, bar);
					bar.handle.update(stage.done);
				} else if (bar.done !== stage.done) bar.handle.update(stage.done);
				bar.done = stage.done;
				if (!stage.complete) continue;
				bar.done = -1;
				if (stage.failed) bar.handle.fail(stage.summary);
				else bar.handle.done(stage.summary);
			}
		};
		let started = false;
		let announced = !followed.bumped;
		let promotionId = followed.promotion;
		let reran = false;
		for (;;) {
			yield* client.pause(followInterval);
			const rows = yield* snapshot(client, followed);
			const preparation = rows.find(row => row.id === followed.execution.id);
			const promotion = rows.find(row =>
				promotionId === undefined
					? row.operation === 'promote' && row.version === followed.version && row.approvedBy === 'start'
					: row.id === promotionId
			);
			if (!announced && preparation) {
				const prepared = preparation.managed?.result ?? preparation.prepared?.result;
				if (preparation.state === 'failed' || preparation.state === 'cancelled') {
					spinner.fail();
					out.error(`The version bump stopped: ${preparation.reason ?? preparation.state}`);
					out.setExitCode(1);
					return;
				}
				if (preparation.state === 'succeeded' && prepared) {
					announced = true;
					if (prepared.kind !== 'commit') {
						spinner.succeed(`Version PR ${look.link(prepared.url)}`);
						out.log('Merging the version PR publishes the release, and nothing asks again.');
						return;
					}
					spinner.update(
						`Version commit ${look.sha(prepared.head)} is on ${followed.defaultBranch}. Waiting for Beepboop to see it`,
					);
				}
			}
			if (promotion?.operation !== 'promote') continue;
			const sha = look.sha(promotion.sourceSha);
			if (promotion.state === 'awaiting-approval') {
				spinner.update(promotion.reason ? `${sha}: ${promotion.reason}` : `Waiting for checks on ${sha}`);
				continue;
			}
			if (['pending', 'ready', 'dispatching'].includes(promotion.state)) {
				spinner.update(`Dispatching ${promotion.workflow?.file ?? 'the release workflow'} for ${sha}`);
				continue;
			}
			const binaries = yield* client.call(routes.executionsBinaries, {
				id: promotion.id,
				repositoryId: promotion.repositoryId,
			});
			const finished = promotion.state === 'succeeded';
			const report = () => {
				if (promotion.publications.length) table(out, publicationRows(look, promotion));
				if (binaries.legs.length) table(out, binaryRows(look, binaries));
				links(out, look, promotion);
			};
			if (promotion.state === 'failed' || promotion.state === 'cancelled') {
				const reason = promotion.reason ?? `The release stopped: ${promotion.state}`;
				if (started) {
					advance(stages(promotion, binaries, false).filter(stage => bars.has(stage.label)));
					for (const bar of open()) bar.handle.fail();
				} else spinner.fail();
				out.error(reason);
				report();
				if (promotion.state === 'failed' && stoppedByGates(promotion.reason) && !out.jsonMode) {
					const choice: CheckChoice | 'stop' | 'unanswered' = yield* checkChoice(answers, reran, promotion.reason);
					const hint = `Choose with beepboop runs checks ${promotion.id} --choice rerun, skip or always`;
					if (choice === 'unanswered') {
						out.error(hint);
					} else if (choice !== 'stop') {
						const refused = yield* client.call(routes.executionsChecks, {
							id: promotion.id,
							repositoryId: promotion.repositoryId,
							choice,
						}).pipe(Effect.as(undefined), Effect.catch(error => Effect.succeed(error.message)));
						if (refused !== undefined) {
							out.error(refused);
							out.error(hint);
							out.setExitCode(1);
							return;
						}
						out.log(chosenNote[choice]);
						reran ||= choice === 'rerun';
						promotionId = promotion.id;
						bars.clear();
						started = false;
						spinner = out.spinner(`Waiting for checks on ${sha}`);
						continue;
					}
				}
				out.setExitCode(1);
				return;
			}
			if (!started) {
				started = true;
				const run = runUrl(promotion);
				spinner.succeed(run ? `Release run ${look.link(run)}` : `Release of ${sha} started`);
			}
			advance(stages(promotion, binaries, finished));
			if (finished) {
				out.log(
					`${look.mark('published')} Released ${look.version(followed.version)} of ${look.pkg(followed.repository)}`,
				);
				report();
				return;
			}
		}
	});
}
