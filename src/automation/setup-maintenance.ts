import { Effect, Result, Schema } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { discover } from '@/automation/managers';
import { object } from '@/automation/managers/helpers';
import { pullRequest } from '@/automation/preparation-pull-requests';
import {
	previewSetup,
	releaseAfterMerge,
	releaseAfterMergeBox,
	setupBody,
	setupOptions,
	withRegistryStatus,
} from '@/automation/setup';
import { marked } from '@/automation/setup-body';
import { changeDetails, setupBranch, setupTitle } from '@/automation/setup-changes';
import type { PublishingAccess } from '@/automation/setup-publishing';
import {
	autoMergeSetup,
	generatedFiles,
	openSetupPull,
	proposalScope,
	revokeAutoMerge,
	setupHead,
	setupStatus,
} from '@/automation/setup-pull-requests';
import type { SetupChoices } from '@/automation/setup-types';
import { repositorySnapshot } from '@/automation/snapshot';
import type { Store } from '@/automation/store';
import { setupChoicesSchema } from '@/contract/setup';
import { canonicalConfiguration, outdatedConfiguration } from '@/domain/configuration/canonical.ts';
import { resolveConfiguration } from '@/domain/configuration/presets.ts';
import type { Edit, Inventory, Snapshot } from '@/domain/inventory.ts';
import { packageId, selectorKey } from '@/domain/package-identity.ts';
import { packageMarkdown } from '@/domain/package-label';
import { exclusionLabel, publishable } from '@/domain/package-publication.ts';
import { fromJson, fromPromise, fromSync, toDomainError } from '@/kernel/errors/classify.ts';
import { decodeError } from '@/kernel/errors/decoding.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';
import { retryTransient } from '@/kernel/http/retry.ts';
import { logRecovered } from '@/kernel/logging/failure-log.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';
import { record } from '@/kernel/schema/result.ts';
import { decodeSync, mutableArray, mutableStruct, safeDecode } from '@/kernel/schema/structs.ts';
import { formatJson, json } from '@/kernel/text/json.ts';
import { parse, replaceDocument, sql } from '@/persistence/d1/database';
import { documentRow } from '@/persistence/d1/document-row';

const editsSchema = mutableArray(mutableStruct({ path: Schema.String, before: Schema.String, after: Schema.String }));
export function sameEdits(left: Edit[], right: Edit[]): boolean {
	const sorted = (edits: Edit[]) => JSON.stringify([...edits].sort((a, b) => a.path.localeCompare(b.path)));
	return sorted(left) === sorted(right);
}
export function setupEdits(saved: Record<string, unknown> | undefined): Edit[] {
	if (Array.isArray(saved?.edits)) return decodeSync(editsSchema, saved.edits);
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
	const parsed = safeDecode(setupChoicesSchema, saved?.choices);
	return parsed.success ? { saved: parsed.data } : {};
}
export const observationsKept = { observationsKept: true } as const;
function storedObservation(choices: unknown, raw: unknown, inventory: Inventory): unknown {
	const parsed = safeDecode(setupChoicesSchema, choices);
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
	publishing: PublishingAccess,
	requested?: { number: number; choices: SetupChoices },
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const { name, id } = snapshot.repository;
		const db = sql(store.db);
		const row = yield* parse(
			Schema.NullOr(documentRow),
			yield* db.first('SELECT document FROM onboarding WHERE repository_id=?', id),
		);
		if (!row) return yield* formatSetup(store, gateway, snapshot, {}, undefined);
		const saved = yield* Effect.fromResult(record(yield* fromJson(row.document)));
		const pull = yield* openSetupPull(gateway, name, id);
		if (!pull && !requested) return yield* migrateSetup(store, gateway, snapshot, saved, row.document, publishing);
		if (!pull || (requested && pull.number !== requested.number)) return;
		if (!requested && saved.formatOnly === true && !savedSetup(saved).saved) {
			return yield* formatSetup(store, gateway, snapshot, saved, row.document, pull);
		}
		const generated = yield* generatedFiles(gateway, name, id, pull.head);
		if (!generated && saved.head !== pull.head) return;
		const previous = generated ?? (yield* fromSync(() => setupEdits(saved)));
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
				Schema.NullOr(documentRow),
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
				Effect.mapError(error => error instanceof Schema.SchemaError ? toDomainError(error) : error),
			);
			const original = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
			const choices = requested?.choices
				?? ((snapshot.files['.github/beepboop.json'] ?? '') === original && !followsProposal(saved, pull.body)
					? saved.choices
					: undefined);
			const workflowPermission = yield* gateway.canEditWorkflows(name, id);
			const repaired = saved.observationsKept === true ? choices : storedObservation(choices, raw, inventory);
			const plan = yield* previewSetup(snapshot, inventory, repaired, {
				publishing,
				...savedSetup(saved),
				head: pull.head,
				workflowPermission,
				...(!workflowPermission ? { appPage: yield* gateway.appPage } : {}),
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
				yield* setupStatus(
					gateway,
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
				yield* setupStatus(gateway, name, id, pull.number, `${summary}\n\n${settled}`, proposal);
				yield* save({ ...saved, ...applied, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha });
				return;
			}
			const canonical = canonicalConfiguration(raw, inventory.packages);
			if ((yield* proposalScope(plan.edits, canonical)) !== 'format') {
				yield* revokeAutoMerge(gateway, name, id, pull.number);
			}
			const format = outdatedConfiguration(raw, inventory.packages)
				? yield* fromPromise(() => sha256Hex(JSON.stringify(canonical)))
				: undefined;
			const result = yield* pullRequest(gateway, {
				snapshot,
				branch: pull.branch,
				title: proposal.title,
				body: proposal.body,
				edits: plan.edits,
				expectedHead: pull.head,
				checkpoint: () => current,
				setupEdits: previous,
				existingPull: pull.number,
				coAuthored: true,
			});
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
				...(format === undefined ? {} : { formatMigration: format }),
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
				setupStatus(
					gateway,
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
	publishing: PublishingAccess,
): Effect.Effect<void, DomainError> {
	return Effect.gen(function*() {
		const { name, id } = snapshot.repository;
		const source = snapshot.files['.github/beepboop.json'];
		const choices = savedSetup(saved).saved;
		if (source === undefined) return;
		if (!choices) return yield* formatSetup(store, gateway, snapshot, saved, document);
		const raw = yield* fromSync((): unknown => JSON.parse(source));
		const stored = yield* store.repository(id);
		const inventory = withRegistryStatus(discover(snapshot), stored?.inventory);
		const missing = saved.migration !== 'proposed' && setupMissing(raw, choices);
		const canonical = canonicalConfiguration(raw, inventory.packages);
		const format = outdatedConfiguration(raw, inventory.packages)
			? yield* fromPromise(() => sha256Hex(JSON.stringify(canonical)))
			: undefined;
		if (!missing && (format === undefined || saved.formatMigration === format)) return;
		const resolved = yield* resolveConfiguration(raw, ref => gateway.preset(ref)).pipe(
			Effect.mapError(error => error instanceof Schema.SchemaError ? toDomainError(error) : error),
		);
		const branch = setupBranch(snapshot);
		const head = yield* setupHead(gateway, name, id, branch);
		const workflowPermission = yield* gateway.canEditWorkflows(name, id);
		const plan = yield* previewSetup(snapshot, inventory, undefined, {
			publishing,
			saved: choices,
			head,
			workflowPermission,
			...(!workflowPermission ? { appPage: yield* gateway.appPage } : {}),
			presetShas: resolved.presetShas,
		}, resolved.configuration);
		if (plan.blockers.length || !plan.edits.length) return;
		const result = yield* pullRequest(gateway, {
			snapshot,
			branch,
			title: setupTitle(branch, plan.edits),
			body: setupBody(plan, { branch, defaultBranch: snapshot.repository.defaultBranch }),
			edits: plan.edits,
			expectedHead: head ?? undefined,
			setupEdits: [],
			coAuthored: true,
		});
		yield* replaceDocument(sql(store.db), 'onboarding', 'repository_id', id, document, {
			...saved,
			...result,
			sourceSha: snapshot.sha,
			content: plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after ?? source,
			choices: plan.choices,
			options: setupOptions(plan),
			inferred: plan.adoption !== undefined,
			edits: plan.edits,
			...(missing ? { migration: 'proposed' } : {}),
			...(format === undefined ? {} : { formatMigration: format }),
			maintenanceFingerprint: undefined,
			...observationsKept,
		});
		yield* store.audit('beepboop', 'repository.setup.migrated', `${name} ${snapshot.sha} ${result.url}`);
		yield* autoMergeSetup(gateway, name, id, result.url, plan.edits, canonical).pipe(
			retryTransient<DomainError>({ attempts: 3, delay: 1000, while: error => error.problem.code === 'upstream' }),
			logRecovered('setup.auto-merge-failed', { repository: name, url: result.url }),
		);
	});
}
const formatSetup = Effect.fn('formatSetup')(function*(
	store: Store,
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	saved: Record<string, unknown>,
	document: string | undefined,
	pull?: { number: number; head: string; branch: string; body: string },
): Effect.fn.Return<void, DomainError> {
	const { name, id } = snapshot.repository;
	const source = snapshot.files['.github/beepboop.json'];
	if (source === undefined) return;
	const parsed = Result.try((): unknown => JSON.parse(source));
	if (Result.isFailure(parsed)) return;
	const raw = parsed.success;
	const stored = yield* store.repository(id);
	const inventory = withRegistryStatus(discover(snapshot), stored?.inventory);
	if (!outdatedConfiguration(raw, inventory.packages)) return;
	const canonical = canonicalConfiguration(raw, inventory.packages);
	const format = yield* fromPromise(() => sha256Hex(JSON.stringify(canonical)));
	if (saved.formatMigration === format) return;
	if (!pull && document === undefined && (yield* openSetupPull(gateway, name, id))) return;
	const after = formatJson(yield* Effect.fromResult(json(canonical)));
	const edits = [{ path: '.github/beepboop.json', before: source, after }];
	const branch = pull?.branch ?? setupBranch(snapshot);
	const head = pull ? pull.head : yield* setupHead(gateway, name, id, branch);
	const result = yield* pullRequest(gateway, {
		snapshot,
		branch,
		title: setupTitle(branch, edits),
		body: `Beepboop rewrites \`.github/beepboop.json\` in the current configuration format.\n\n${
			releaseAfterMergeBox(pull ? releaseAfterMerge(pull.body) : false)
		}\n\n${changeDetails(edits)}\n`,
		edits,
		expectedHead: head ?? undefined,
		setupEdits: pull ? setupEdits(saved) : [],
		existingPull: pull?.number,
		coAuthored: true,
	});
	const next = {
		...saved,
		...result,
		sourceSha: snapshot.sha,
		content: after,
		edits,
		formatMigration: format,
		formatOnly: true,
	};
	const db = sql(store.db);
	yield* document === undefined
		? db.run(
			'INSERT INTO onboarding(repository_id,document) VALUES(?,?) ON CONFLICT(repository_id) DO NOTHING',
			id,
			JSON.stringify(next),
		)
		: replaceDocument(db, 'onboarding', 'repository_id', id, document, next);
	if (pull) {
		yield* store.audit('beepboop', 'repository.setup.refreshed', `${name} ${snapshot.sha} ${result.url}`);
		return;
	}
	yield* store.audit('beepboop', 'repository.setup.migrated', `${name} ${snapshot.sha} ${result.url}`);
	yield* autoMergeSetup(gateway, name, id, result.url, edits, canonical).pipe(
		retryTransient<DomainError>({ attempts: 3, delay: 1000, while: error => error.problem.code === 'upstream' }),
		logRecovered('setup.auto-merge-failed', { repository: name, url: result.url }),
	);
});
export function currentOptions(
	store: Store,
	gateway: RepositoryGateway,
	repository: { name: string; id: number },
	choices: SetupChoices,
	publishing: PublishingAccess,
): Effect.Effect<ReturnType<typeof setupOptions>, DomainError> {
	return Effect.gen(function*() {
		const snapshot = yield* repositorySnapshot(gateway, repository.name, repository.id);
		const stored = yield* store.repository(repository.id);
		const raw = yield* fromSync((): unknown => JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'));
		const resolved = yield* resolveConfiguration(raw, ref => gateway.preset(ref)).pipe(
			Effect.mapError(error => error instanceof Schema.SchemaError ? toDomainError(error) : error),
		);
		const plan = yield* previewSetup(
			snapshot,
			withRegistryStatus(discover(snapshot), stored?.inventory),
			choices,
			{ head: null, publishing },
			resolved.configuration,
		);
		return setupOptions(plan);
	});
}
