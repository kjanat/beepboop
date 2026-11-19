import type { Ask, CLIError, Out } from '@kjanat/dreamcli';
import { Effect, Schema } from 'effect';
import type { Client } from '@/cli/client';
import type { Look, State } from '@/cli/look';
import { lookOf, step, table } from '@/cli/look';
import { emit, failure, prompted, unprompted } from '@/cli/output';
import { checkoutRepository } from '@/cli/release';
import { routes } from '@/contract/routes';
import type { PackageTagView } from '@/contract/views';
import { looseStruct, mutableArray, safeDecode } from '@/kernel/schema/structs.ts';

export interface PackageTagOptions {
	repository?: string | undefined;
	stream?: string | undefined;
	yes: boolean;
	dryRun: boolean;
}

const tagged = looseStruct({ packageTags: Schema.optional(mutableArray(Schema.String)) });

const states: Record<PackageTagView['outcome'], State> = {
	exists: 'skipped',
	conflict: 'failed',
	unpublished: 'skipped',
	publishable: 'waiting',
	created: 'published',
	failed: 'failed',
};
const labels: Record<PackageTagView['outcome'], string> = {
	exists: 'exists',
	conflict: 'targets another commit',
	unpublished: 'not published',
	publishable: 'to create',
	created: 'created',
	failed: 'failed',
};

function packageTags(
	client: Client,
	request: { repositoryId: number; stream: string; apply: boolean },
): Effect.Effect<PackageTagView[], CLIError> {
	return Effect.gen(function*() {
		const results: PackageTagView[] = [];
		let after: string | undefined;
		do {
			const page = yield* client.call(
				routes.repositoriesPackageTags,
				after === undefined ? request : { ...request, after },
			);
			results.push(...page.results);
			after = page.next;
		} while (after !== undefined);
		return results;
	});
}

function rows(look: Look, results: readonly PackageTagView[]) {
	return results.map(result => ({
		tag: look.pkg(result.tag),
		version: look.version(result.version),
		commit: look.sha(result.commit),
		state: `${look.mark(states[result.outcome])} ${look.state(states[result.outcome], labels[result.outcome])}`,
		...(result.reason ? { reason: result.reason } : {}),
	}));
}

export function backfillPackageTags(
	client: Client,
	options: PackageTagOptions,
	ask: Ask,
	out: Out,
	cwd = process.cwd(),
): Effect.Effect<void, CLIError> {
	return Effect.gen(function*() {
		const look = lookOf(out);
		const reference = options.repository ?? (yield* checkoutRepository(cwd));
		const repository = yield* step(
			out,
			`Reading ${look.pkg(reference)} from Beepboop`,
			client.call(routes.repositoriesResolve, { repository: reference }),
			found => `Read ${look.pkg(found.name)}`,
		);
		const streams = Object.entries(repository.configuration?.streams ?? {}).filter(([, raw]) => {
			const stream = safeDecode(tagged, raw);
			return stream.success && (stream.data.packageTags?.length ?? 0) > 0;
		}).map(([name]) => name);
		const stream = options.stream ?? (streams.length === 1 ? streams[0] : undefined);
		if (!stream) {
			return yield* Effect.fail(
				streams.length
					? failure(`Choose a stream: ${streams.join(', ')}`, 'STREAM_REQUIRED', 'Pass --stream NAME')
					: failure(
						`${repository.name} names no packageTags in any stream`,
						'NO_PACKAGE_TAGS',
						'Add packageTags to a stream in .github/beepboop.json',
					),
			);
		}
		const preview = yield* step(
			out,
			`Checking the package tags of ${look.pkg(repository.name)} / ${stream}`,
			packageTags(client, { repositoryId: repository.id, stream, apply: false }),
			found => `Checked ${found.length} package tags`,
		);
		const missing = preview.filter(result => result.outcome === 'publishable');
		const broken = preview.some(result => result.outcome === 'conflict' || result.outcome === 'failed');
		if (out.jsonMode && (options.dryRun || !options.yes || !missing.length)) {
			if (broken) out.setExitCode(1);
			return yield* emit(out, preview);
		}
		if (!out.jsonMode) {
			table(out, rows(look, preview.filter(result => result.outcome !== 'exists')));
			out.log(
				`${preview.filter(result => result.outcome === 'exists').length} exist, ${missing.length} to create, ${
					preview.filter(result => result.outcome === 'unpublished').length
				} not published, ${preview.filter(result => result.outcome === 'conflict').length} on another commit, ${
					preview.filter(result => result.outcome === 'failed').length
				} unchecked.`,
			);
		}
		if (!missing.length) {
			if (broken) out.setExitCode(1);
			else out.log('Every published package has its tag.');
			return;
		}
		if (options.dryRun) {
			if (broken) out.setExitCode(1);
			return out.log(look.note('Dry run: Beepboop created no tags.'));
		}
		if (
			!options.yes
			&& !(yield* unprompted(
				prompted(() =>
					ask({
						kind: 'confirm',
						message: `Create ${missing.length} signed package tags on their release commits?`,
						default: false,
					})
				),
				() => Effect.succeed(true),
			))
		) {
			if (broken) out.setExitCode(1);
			return out.log('Package tags unchanged.');
		}
		const results = yield* step(
			out,
			`Creating ${missing.length} package tags`,
			packageTags(client, { repositoryId: repository.id, stream, apply: true }),
			done => `Created ${done.filter(result => result.outcome === 'created').length} package tags`,
		);
		if (out.jsonMode) yield* emit(out, results);
		else table(out, rows(look, results.filter(result => result.outcome !== 'exists')));
		if (results.some(result => result.outcome === 'failed' || result.outcome === 'conflict')) out.setExitCode(1);
	});
}
