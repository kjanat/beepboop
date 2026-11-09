import type { CLIError, Out, ProgressHandle } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { z } from 'zod';
import type { Client } from '@/cli/client';
import type { Look, State } from '@/cli/look';
import { lookOf, registryOf, table } from '@/cli/look';
import { failure } from '@/cli/output';
import { routes } from '@/contract/routes';
import type { BinaryProgress } from '@/contract/views';

const result = z.looseObject({ url: z.string(), head: z.string(), kind: z.literal('commit').optional() });
const tracked = z.looseObject({
	id: z.string(),
	repositoryId: z.number(),
	repository: z.string(),
	stream: z.string(),
	operation: z.string(),
	state: z.string(),
	version: z.string().optional(),
	sourceSha: z.string(),
	reason: z.string().optional(),
	runId: z.number().optional(),
	approvedBy: z.string().optional(),
	release: z.looseObject({ tag: z.string().optional() }).optional(),
	draftRelease: z.looseObject({ tag: z.string() }).optional(),
	workflow: z.looseObject({ file: z.string() }).optional(),
	managed: z.looseObject({ result: result.optional() }).optional(),
	prepared: z.looseObject({ result: result.optional() }).optional(),
	publications: z.array(
		z.looseObject({ id: z.string(), name: z.string(), manager: z.string(), version: z.string(), outcome: z.string() }),
	).default([]),
	configuration: z.looseObject({
		streams: z.record(z.string(), z.looseObject({ required: z.array(z.string()).optional() })),
	}).optional(),
});
type Tracked = z.output<typeof tracked>;

export const followInterval = 5_000;

export interface Followed {
	repository: string;
	repositoryId: number;
	defaultBranch: string;
	stream: string;
	version: string;
	execution: { id: string };
	bumped: boolean;
}

const outcomeState: Record<string, State> = {
	succeeded: 'published',
	failed: 'failed',
	skipped: 'skipped',
	pending: 'waiting',
	uncertain: 'waiting',
	'rate-limited': 'waiting',
};

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
		const state = outcomeState[publication.outcome] ?? 'waiting';
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
	const ended = legs.filter(leg => ['succeeded', 'failed', 'skipped'].includes(leg.state)).length;
	const broken = legs.filter(leg => leg.state === 'failed').length;
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
		const built: State = leg.state === 'succeeded'
			? 'published'
			: leg.state === 'failed'
			? 'failed'
			: leg.state === 'skipped'
			? 'skipped'
			: 'waiting';
		const asset = binaries.assets.find(entry => entry.build === leg.build && entry.target === leg.target);
		const upload: State = asset?.uploaded ? 'published' : 'waiting';
		return {
			binary: look.pkg(leg.build),
			target: leg.target,
			build: `${look.mark(built)} ${look.state(built, leg.state)}`,
			asset: asset?.name ?? '',
			upload: `${look.mark(upload)} ${look.state(upload, asset?.uploaded ? 'uploaded' : 'waiting')}`,
		};
	});
}

function snapshot(client: Client, followed: Followed): Effect.Effect<Tracked[], CLIError> {
	return client.call(routes.executionsList, {}).pipe(
		Effect.flatMap(rows =>
			Effect.try({
				try: () =>
					z.array(tracked).parse(rows).filter(row =>
						row.repositoryId === followed.repositoryId && row.stream === followed.stream
					),
				catch: () => failure('Server returned an invalid execution list', 'INVALID_RESPONSE'),
			})
		),
	);
}

export function followRelease(client: Client, out: Out, followed: Followed): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		const look = lookOf(out);
		const spinner = out.spinner(
			followed.bumped
				? `Applying the ${look.version(followed.version)} version bump`
				: `Starting the release of ${look.version(followed.version)}`,
		);
		let progress: ProgressHandle | undefined;
		let phase: string | undefined;
		let announced = !followed.bumped;
		for (;;) {
			yield* client.pause(followInterval);
			const rows = yield* snapshot(client, followed);
			const preparation = rows.find(row => row.id === followed.execution.id);
			const promotion = rows.find(row =>
				row.operation === 'promote' && row.version === followed.version && row.approvedBy === 'start'
			);
			if (!announced && preparation) {
				const prepared = preparation.managed?.result ?? preparation.prepared?.result;
				if (preparation.state === 'failed' || preparation.state === 'cancelled') {
					spinner.fail(`The version bump stopped: ${preparation.reason ?? preparation.state}`);
					out.setExitCode(1);
					return;
				}
				if (preparation.state === 'succeeded' && prepared) {
					announced = true;
					if (prepared.kind !== 'commit') {
						spinner.succeed(`Version PR ${look.link(prepared.url)}`);
						out.log('Merging the version PR continues the release without another approval.');
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
				spinner.update(`Waiting for checks on ${sha}${promotion.reason ? `: ${promotion.reason}` : ''}`);
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
				if (progress) progress.fail(reason);
				else spinner.fail(reason);
				report();
				out.setExitCode(1);
				return;
			}
			if (phase === undefined) {
				const run = runUrl(promotion);
				spinner.succeed(run ? `Release run ${look.link(run)}` : `Release of ${sha} started`);
			}
			const phases = stages(promotion, binaries, finished);
			let index = phase === undefined ? 0 : phases.findIndex(stage => stage.label === phase);
			for (; index < phases.length; index++) {
				const stage = phases[index];
				if (!stage) break;
				if (phase !== stage.label) {
					phase = stage.label;
					progress = out.progress({ total: stage.total, label: stage.label });
				}
				progress?.update(stage.done);
				if (!stage.complete) break;
				if (stage.failed) progress?.fail(stage.summary);
				else progress?.done(stage.summary);
			}
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
