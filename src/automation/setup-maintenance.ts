import { Effect } from 'effect';
import { z } from 'zod';
import { resolveConfiguration } from '@/automation/configuration';
import type { RepositoryGateway } from '@/automation/github';
import { discover } from '@/automation/managers';
import { packageId } from '@/automation/package-identity';
import { exclusionLabel, publishable } from '@/automation/package-publication';
import { documentRow } from '@/automation/schemas';
import { previewSetup, releaseAfterMerge, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import type { SetupChoices } from '@/automation/setup-types';
import { decodeError, type Store } from '@/automation/store';
import type { Edit, Snapshot } from '@/automation/types';
import { type DomainError, precondition } from '@/contract/errors';
import { sha256Hex } from '@/contract/ids';
import { packageMarkdown } from '@/domain/package-label';
import { fromJson, fromPromise, fromSync, toDomainError } from '@/failure';
import { record } from '@/model';
import { parse, sql } from '@/persistence/d1/database';

const editsSchema = z.array(z.object({ path: z.string(), before: z.string(), after: z.string() }));
export function sameEdits(left: Edit[], right: Edit[]): boolean {
	const sorted = (edits: Edit[]) => JSON.stringify([...edits].sort((a, b) => a.path.localeCompare(b.path)));
	return sorted(left) === sorted(right);
}
export function setupEdits(saved: Record<string, unknown> | undefined): Edit[] {
	if (Array.isArray(saved?.edits)) return editsSchema.parse(saved.edits);
	return typeof saved?.content === 'string'
		? [{ path: '.github/beepboop.json', before: '', after: saved.content }]
		: [];
}

const superseded = 'A newer setup edit replaced this rebuild';
export function followsProposal(saved: Record<string, unknown> | undefined, body: string): boolean {
	return saved?.inferred === true || (saved?.inferred === undefined && body.includes('\n## Release plan\n'));
}

/** Reconcile an already-open proposal after discovery, without starting a release or changing human edits. */
export function maintainSetup(
	store: Store,
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	requested?: { number: number; choices: SetupChoices },
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const { name, id } = snapshot.repository;
		const db = sql(store.db);
		const row = yield* parse(
			documentRow.nullable(),
			yield* db.first('SELECT document FROM onboarding WHERE repository_id=?', id),
		);
		if (!row) return;
		const saved = yield* Effect.fromResult(record(yield* fromJson(row.document)));
		const pull = yield* gateway.openSetupPull(name, id);
		if (!pull || (requested && pull.number !== requested.number)) return;
		const generatedFiles = yield* gateway.generatedFiles(name, id, pull.head);
		if (!generatedFiles && saved.head !== pull.head) return;
		const previous = generatedFiles ?? (yield* fromSync(() => setupEdits(saved)));
		const stored = yield* store.repository(id);
		const inventory = withRegistryStatus(discover(snapshot), stored?.inventory);
		const summary = `Inspected [${snapshot.sha}](https://github.com/${name}/commit/${snapshot.sha}).\n\n`
			+ 'Discovered packages:\n'
			+ inventory.packages.map(pkg =>
				`- ${publishable(pkg) ? packageMarkdown(packageId(pkg)) : `\`${pkg.name}\``} (${
					[pkg.manifest, exclusionLabel(pkg.publication)].filter(Boolean).join(', ')
				})`
			).join(
				'\n',
			);
		const current = Effect.gen(function*() {
			const now = yield* parse(
				documentRow.nullable(),
				yield* db.first('SELECT document FROM onboarding WHERE repository_id=?', id),
			);
			if (now?.document !== row.document) return yield* precondition(superseded);
		});
		const save = (next: Record<string, unknown>) =>
			// Do not overwrite a newer explicit setup operation or another reconciliation's journal.
			db.run(
				'UPDATE onboarding SET document=? WHERE repository_id=? AND document=?',
				JSON.stringify(next),
				id,
				row.document,
			);
		yield* Effect.gen(function*() {
			const raw = yield* fromSync((): unknown => JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'));
			const resolved = yield* resolveConfiguration(raw, ref => gateway.preset(ref)).pipe(
				Effect.mapError(error => error instanceof z.ZodError ? toDomainError(error) : error),
			);
			const original = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
			const choices = requested?.choices
				?? ((snapshot.files['.github/beepboop.json'] ?? '') === original && !followsProposal(saved, pull.body)
					? saved.choices
					: undefined);
			const workflowPermission = yield* gateway.canEditWorkflows(name, id);
			const plan = yield* previewSetup(snapshot, inventory, choices, {
				head: pull.head,
				workflowPermission,
				presetShas: resolved.presetShas,
				prior: { url: pull.url, content: typeof saved.content === 'string' ? saved.content : undefined },
			}, resolved.configuration);
			const fingerprint = yield* fromPromise(() => sha256Hex(JSON.stringify({ plan, head: pull.head })));
			if (!requested && saved.maintenanceFingerprint === fingerprint && saved.options !== undefined) return;
			const applied = { choices: plan.choices, options: setupOptions(plan), inferred: plan.adoption !== undefined };
			if (plan.blockers.length || !plan.edits.length) {
				yield* current;
				yield* gateway.setupStatus(
					name,
					id,
					pull.number,
					`${summary}\n\n${
						plan.blockers.length
							? `Automatic update needs attention:\n${plan.blockers.map(message => `- ${message}`).join('\n')}`
							: 'The default branch already matches the proposed setup.'
					}`,
					setupBody(plan, releaseAfterMerge(pull.body)),
				);
				yield* save({ ...saved, ...applied, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha });
				return;
			}
			// Even an unchanged source may need a newer generator's output. An identical proposal needs no commit.
			if (saved.sourceSha === snapshot.sha && sameEdits(previous, plan.edits)) {
				yield* current;
				yield* gateway.setupStatus(
					name,
					id,
					pull.number,
					`${summary}\n\nThe proposal is up to date.`,
					setupBody(plan, releaseAfterMerge(pull.body)),
				);
				yield* save({ ...saved, ...applied, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha });
				return;
			}
			const result = yield* gateway.pullRequest(
				snapshot,
				'automation/onboarding',
				'chore: configure release automation',
				setupBody(plan, releaseAfterMerge(pull.body)),
				plan.edits,
				pull.head,
				() => current,
				previous,
				pull.number,
				{ coAuthored: true },
			);
			const generated = new Map(
				previous.flatMap(edit => {
					const after = snapshot.files[edit.path];
					return after === undefined ? [] : [[edit.path, { ...edit, after }] as const];
				}),
			);
			for (const edit of plan.edits) generated.set(edit.path, edit);
			yield* save({
				...saved,
				...result,
				sourceSha: snapshot.sha,
				checkedSha: snapshot.sha,
				content: plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after
					?? snapshot.files['.github/beepboop.json'],
				choices: plan.choices,
				options: setupOptions(plan),
				inferred: plan.adoption !== undefined,
				edits: [...generated.values()],
				maintenanceFingerprint: undefined,
			});
			yield* store.audit(
				'beepboop',
				requested ? 'repository.setup.edited' : 'repository.setup.refreshed',
				`${name} ${snapshot.sha} ${result.url}`,
			);
		}).pipe(
			Effect.catchIf(error => decodeError(error) === superseded, () => Effect.void),
			Effect.tapError(error =>
				gateway.setupStatus(
					name,
					id,
					pull.number,
					`${summary}\n\nAutomatic update stopped: ${
						decodeError(error)
					}\n\nReview the reported conflict or permissions. Beepboop will recheck this proposal on the next repository refresh.`,
				)
			),
		);
	});
}
export function currentOptions(
	store: Store,
	gateway: RepositoryGateway,
	repository: { name: string; id: number },
	choices: SetupChoices,
): Effect.Effect<ReturnType<typeof setupOptions>, DomainError> {
	return Effect.gen(function*() {
		const snapshot = yield* gateway.snapshot(repository.name, repository.id);
		const stored = yield* store.repository(repository.id);
		const raw = yield* fromSync((): unknown => JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'));
		const resolved = yield* resolveConfiguration(raw, ref => gateway.preset(ref)).pipe(
			Effect.mapError(error => error instanceof z.ZodError ? toDomainError(error) : error),
		);
		const plan = yield* previewSetup(
			snapshot,
			withRegistryStatus(discover(snapshot), stored?.inventory),
			choices,
			{ head: null },
			resolved.configuration,
		);
		return setupOptions(plan);
	});
}
