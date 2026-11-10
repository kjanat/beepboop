import { Effect } from 'effect';
import { z } from 'zod';
import { resolveConfiguration } from '@/automation/configuration';
import type { RepositoryGateway } from '@/automation/github';
import { discover } from '@/automation/managers';
import { object } from '@/automation/managers/helpers';
import { packageId, selectorKey } from '@/automation/package-identity';
import { exclusionLabel, publishable } from '@/automation/package-publication';
import { documentRow } from '@/automation/schemas';
import { previewSetup, releaseAfterMerge, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import { marked } from '@/automation/setup-body';
import { setupBranch, setupTitle } from '@/automation/setup-changes';
import type { SetupChoices } from '@/automation/setup-types';
import type { Store } from '@/automation/store';
import { decodeError } from '@/automation/store';
import type { Edit, Inventory, Snapshot } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { sha256Hex } from '@/contract/ids';
import { setupChoicesSchema } from '@/contract/setup';
import { packageMarkdown } from '@/domain/package-label';
import { fromJson, fromPromise, fromSync, toDomainError } from '@/failure';
import { record } from '@/model';
import { parse, replaceDocument, sql } from '@/persistence/d1/database';

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
const settled = 'The proposal is up to date.';
const rebuilding = 'Beepboop is rebuilding the proposal from your edit.';
export function rebuildingStatus(body: string): string {
	const start = '<!-- beepboop:setup-status -->\n', end = '\n<!-- /beepboop:setup-status -->';
	const from = body.indexOf(start), to = body.indexOf(end, from);
	if (from < 0 || to < 0) return rebuilding;
	const status = [settled, rebuilding].reduce(
		(text, line) => text.endsWith(line) ? text.slice(0, -line.length).trimEnd() : text,
		body.slice(from + start.length, to),
	);
	return status ? `${status}\n\n${rebuilding}` : rebuilding;
}
export function savedSetup(saved: Record<string, unknown> | undefined): { saved?: SetupChoices } {
	const parsed = setupChoicesSchema.safeParse(saved?.choices);
	return parsed.success ? { saved: parsed.data } : {};
}
export const observationsKept = { observationsKept: true } as const;
function storedObservation(choices: unknown, raw: unknown, inventory: Inventory): unknown {
	const parsed = setupChoicesSchema.safeParse(choices);
	if (!parsed.success) return choices;
	const streams = object(object(raw).streams);
	const boxed = new Set(inventory.packages.filter(publishable).map(packageId));
	return {
		...parsed.data,
		streams: parsed.data.streams.map(stream => {
			const workflows = object(object(streams[stream.name]).workflows);
			return stream.observe
				? {
					...stream,
					observe: stream.observe.map(entry => {
						const binding = object(workflows[entry.name]);
						if (binding.mode !== 'observe') return entry;
						const needs = Array.isArray(binding.needs) ? binding.needs.map(String) : [];
						const stored = Array.isArray(binding.publications)
							? binding.publications.map(id => selectorKey(String(id), inventory.packages))
							: [];
						return {
							...entry,
							publications: [
								...stored.filter(id => entry.publications.includes(id) || !boxed.has(id)),
								...entry.publications.filter(id => !stored.includes(id)),
							],
							...(!entry.needs?.length && needs.length ? { needs } : {}),
						};
					}),
				}
				: stream;
		}),
	};
}
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
		if (!pull && !requested) return yield* migrateSetup(store, gateway, snapshot, saved, row.document);
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
			replaceDocument(db, 'onboarding', 'repository_id', id, row.document, next);
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
			const repaired = saved.observationsKept === true ? choices : storedObservation(choices, raw, inventory);
			const plan = yield* previewSetup(snapshot, inventory, repaired, {
				...savedSetup(saved),
				head: pull.head,
				workflowPermission,
				presetShas: resolved.presetShas,
				prior: { url: pull.url, content: typeof saved.content === 'string' ? saved.content : undefined },
			}, resolved.configuration);
			const fingerprint = yield* fromPromise(() =>
				sha256Hex(JSON.stringify({ plan, head: pull.head, marked: marked(pull.body) }))
			);
			if (!requested && saved.maintenanceFingerprint === fingerprint && saved.options !== undefined) return;
			const applied = {
				choices: plan.choices,
				options: setupOptions(plan),
				inferred: plan.adoption !== undefined,
				...observationsKept,
			};
			const proposal = {
				title: setupTitle(pull.branch, plan.edits),
				body: setupBody(plan, {
					branch: pull.branch,
					defaultBranch: snapshot.repository.defaultBranch,
					release: releaseAfterMerge(pull.body),
				}),
			};
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
					proposal,
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
					`${summary}\n\n${settled}`,
					proposal,
				);
				yield* save({ ...saved, ...applied, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha });
				return;
			}
			const result = yield* gateway.pullRequest(
				snapshot,
				pull.branch,
				proposal.title,
				proposal.body,
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
				...observationsKept,
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
/** A binding without setup input predates repository-held setup; the stored choices fill it once. */
export function setupMissing(raw: unknown, saved: SetupChoices): boolean {
	const streams = object(object(raw).streams);
	const lacking = (binding: unknown, file: string | undefined) =>
		file !== undefined && object(binding).file === file && object(binding).setup === undefined;
	return (saved.actionsRevision !== undefined && object(raw).actionsRevision === undefined)
		|| saved.streams.some(stream => {
			const current = object(streams[stream.name]);
			return lacking(object(current.prepare).workflow, stream.prepare?.file)
				|| lacking(object(current.promote).workflow, stream.promote?.file)
				|| (stream.operations ?? []).some(entry => lacking(object(current.workflows)[entry.name], entry.file));
		});
}
function migrateSetup(
	store: Store,
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	saved: Record<string, unknown>,
	document: string,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const { name, id } = snapshot.repository;
		const source = snapshot.files['.github/beepboop.json'];
		const choices = savedSetup(saved).saved;
		if (source === undefined || !choices || saved.migration === 'proposed') return;
		const raw = yield* fromSync((): unknown => JSON.parse(source));
		if (!setupMissing(raw, choices)) return;
		const resolved = yield* resolveConfiguration(raw, ref => gateway.preset(ref)).pipe(
			Effect.mapError(error => error instanceof z.ZodError ? toDomainError(error) : error),
		);
		const stored = yield* store.repository(id);
		const branch = setupBranch(snapshot);
		const head = yield* gateway.setupHead(name, id, branch);
		const plan = yield* previewSetup(snapshot, withRegistryStatus(discover(snapshot), stored?.inventory), undefined, {
			saved: choices,
			head,
			workflowPermission: yield* gateway.canEditWorkflows(name, id),
			presetShas: resolved.presetShas,
		}, resolved.configuration);
		if (plan.blockers.length || !plan.edits.length) return;
		const result = yield* gateway.pullRequest(
			snapshot,
			branch,
			setupTitle(branch, plan.edits),
			setupBody(plan, { branch, defaultBranch: snapshot.repository.defaultBranch }),
			plan.edits,
			head ?? undefined,
			undefined,
			[],
			undefined,
			{ coAuthored: true },
		);
		yield* replaceDocument(sql(store.db), 'onboarding', 'repository_id', id, document, {
			...saved,
			...result,
			sourceSha: snapshot.sha,
			content: plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? source,
			choices: plan.choices,
			options: setupOptions(plan),
			inferred: plan.adoption !== undefined,
			edits: plan.edits,
			migration: 'proposed',
			maintenanceFingerprint: undefined,
			...observationsKept,
		});
		yield* store.audit('beepboop', 'repository.setup.migrated', `${name} ${snapshot.sha} ${result.url}`);
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
