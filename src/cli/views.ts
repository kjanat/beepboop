import type { Out } from '@kjanat/dreamcli';
import { Effect, Schema } from 'effect';
import type { Look, State } from '@/cli/look';
import { lookOf, registryOf, table } from '@/cli/look';
import { emit } from '@/cli/output';
import type { CredentialsView, ExecutionView, NotificationsView, RepositoryView } from '@/contract/views';
import { planReview } from '@/contract/views';
import { looseStruct, mutableArray, mutableRecord, safeDecode } from '@/schema';

const executionStates: Record<string, State> = {
	succeeded: 'published',
	failed: 'failed',
	cancelled: 'skipped',
};
export function executionState(look: Look, state: string): string {
	const kind = executionStates[state] ?? 'waiting';
	return `${look.mark(kind)} ${look.state(kind, state)}`;
}

function rows<T>(out: Out, value: T, render: (look: Look) => Record<string, string>[], empty: string) {
	if (out.jsonMode) return emit(out, value);
	return Effect.sync(() => {
		const rendered = render(lookOf(out));
		if (rendered.length) table(out, rendered);
		else out.log(lookOf(out).note(empty));
	});
}

export function repositoryTable(out: Out, repositories: readonly RepositoryView[]) {
	return rows(out, repositories, look =>
		repositories.map(row => ({
			repository: look.pkg(row.name),
			branch: row.defaultBranch,
			commit: look.sha(row.sha),
			streams: Object.keys(row.configuration?.streams ?? {}).join(', '),
			problems: row.diagnostics.length
				? look.state('failed', row.diagnostics.join('; '))
				: look.state('published', 'none'),
		})), 'No repositories are enrolled.');
}

const shownPackage = looseStruct({
	name: Schema.String,
	manager: Schema.String,
	version: Schema.optional(Schema.String),
	manifest: Schema.String,
	publicationStatus: Schema.optional(Schema.String),
	published: Schema.optional(Schema.String),
});
const shownRepository = looseStruct({
	inventory: Schema.optional(looseStruct({ packages: mutableArray(shownPackage) })),
	configuration: Schema.optional(looseStruct({
		streams: mutableRecord(
			Schema.String,
			looseStruct({
				packages: Schema.optional(mutableArray(Schema.String)),
				promote: Schema.optional(looseStruct({ approval: Schema.optional(Schema.String) })),
				prepare: Schema.optional(looseStruct({ bump: Schema.optional(Schema.String) })),
				start: Schema.optional(mutableArray(looseStruct({ via: Schema.String }))),
			}),
		),
	})),
});

export function repositoryView(out: Out, repository: RepositoryView) {
	if (out.jsonMode) return emit(out, repository);
	return Effect.sync(() => {
		const look = lookOf(out);
		const detail = safeDecode(shownRepository, repository);
		out.log(look.heading(`${look.pkg(repository.name)} on ${repository.defaultBranch} at ${look.sha(repository.sha)}`));
		const streams = Object.entries(detail.success ? detail.data.configuration?.streams ?? {} : {});
		if (streams.length) {
			table(
				out,
				streams.map(([name, stream]) => ({
					stream: name,
					starts: stream.start?.map(start => start.via).join(', ') || look.note('none'),
					bump: stream.prepare?.bump ?? look.note('pr until chosen'),
					approval: stream.promote?.approval ?? 'required',
				})),
			);
			for (const [name] of streams) {
				const summary = repository.releases[name]?.summary;
				if (summary) out.log(summary);
			}
		} else out.log(look.note('No release streams are configured.'));
		const packages = detail.success ? detail.data.inventory?.packages ?? [] : [];
		if (packages.length) {
			table(
				out,
				packages.map(pkg => {
					const state: State = pkg.publicationStatus === 'published'
						? 'published'
						: pkg.publicationStatus === 'missing'
						? 'waiting'
						: 'skipped';
					return {
						package: look.pkg(pkg.name),
						registry: registryOf(pkg.manager),
						version: look.version(pkg.version ?? 'unknown'),
						published: pkg.published ? look.version(pkg.published) : look.note('none'),
						status: `${look.mark(state)} ${look.state(state, pkg.publicationStatus ?? 'unchecked')}`,
					};
				}),
			);
		}
		for (const problem of repository.diagnostics) out.log(look.state('failed', problem));
	});
}

export function executionTable(out: Out, executions: readonly ExecutionView[], json: unknown = executions) {
	return rows(out, json, look =>
		executions.map(row => ({
			id: look.id(row.id),
			repository: look.pkg(row.repository),
			stream: row.stream,
			operation: row.operation,
			version: row.version ? look.version(row.version) : '',
			commit: look.sha(row.sourceSha),
			state: executionState(look, row.state),
		})), 'No release operations yet.');
}

const reasoned = looseStruct({ reason: Schema.optional(Schema.String) });

export function executionView(out: Out, execution: ExecutionView) {
	if (out.jsonMode) return emit(out, execution);
	return Effect.sync(() => {
		const look = lookOf(out);
		out.log(
			`${executionState(look, execution.state)} ${look.id(execution.id)} ${
				look.pkg(execution.repository)
			} / ${execution.stream} ${execution.operation}${
				execution.version ? ` ${look.version(execution.version)}` : ''
			} at ${look.sha(execution.sourceSha)}`,
		);
		const reason = safeDecode(reasoned, execution);
		if (reason.success && reason.data.reason) out.log(look.note(reason.data.reason));
	});
}

export function credentialTables(out: Out, view: CredentialsView, names: ReadonlyMap<number, string>) {
	if (out.jsonMode) return emit(out, view);
	return Effect.sync(() => {
		const look = lookOf(out);
		if (!view.credentials.length) out.log(look.note('No secrets are stored.'));
		else {
			table(
				out,
				view.credentials.map(row => ({
					secret: look.pkg(row.alias),
					version: look.version(String(row.version)),
					state: row.active
						? `${look.mark('published')} ${look.state('published', 'active')}`
						: look.state('skipped', 'replaced'),
					stored: new Date(row.created_at).toISOString(),
				})),
			);
		}
		if (view.grants.length) {
			const grant = looseStruct({ stream: Schema.optional(Schema.String), operation: Schema.optional(Schema.String) });
			table(
				out,
				view.grants.map(row => {
					const scope = safeDecode(grant, row);
					return {
						grant: look.id(row.id),
						secret: look.pkg(row.alias),
						repository: names.get(row.repositoryId) ?? String(row.repositoryId),
						use: scope.success ? [scope.data.stream, scope.data.operation].filter(Boolean).join('/') : '',
						delivery: row.delivery,
					};
				}),
			);
		}
	});
}

export function notificationTable(out: Out, view: NotificationsView) {
	return rows(out, view, look =>
		view.destinations.map(destination => ({
			id: look.id(destination.id),
			name: look.heading(destination.name),
			kind: destination.kind,
			secret: destination.credential,
			'new packages': destination.subscribeNew ? 'yes' : 'no',
			enabled: destination.enabled
				? `${look.mark('published')} ${look.state('published', 'yes')}`
				: `${look.mark('skipped')} ${look.state('skipped', 'no')}`,
			packages: view.subscriptions.filter(row => row.destinationId === destination.id)
				.map(row => look.pkg(`${row.registry}:${row.name}`)).join(', '),
		})), 'No notification destinations yet.');
}

export function planView(out: Out, plan: unknown, prepare: (sourceSha: string, planId: string) => string) {
	const parsed = safeDecode(planReview, plan);
	if (out.jsonMode || !parsed.success) return emit(out, plan);
	return Effect.sync(() => {
		const look = lookOf(out);
		const reviewed = parsed.data;
		out.log(
			look.heading(
				`${reviewed.version ? `Version ${look.version(reviewed.version)}` : 'Release set'} from ${
					look.sha(reviewed.sourceSha)
				}`,
			),
		);
		if (reviewed.groups?.length) {
			table(
				out,
				reviewed.groups.map(group => ({
					group: group.id,
					version: look.version(group.version),
					packages: group.packages.map(id => look.pkg(id)).join(', '),
				})),
			);
		}
		for (const edit of reviewed.edits) out.log(`${look.state('waiting', 'edit')} ${edit.path}`);
		if (reviewed.requiresPreparation) out.log(look.note('The preparation workflow writes the version changes.'));
		for (const note of reviewed.diagnostics ?? []) out.log(look.note(note));
		out.log(`Prepare it with: ${prepare(reviewed.sourceSha, reviewed.planId)}`);
	});
}
