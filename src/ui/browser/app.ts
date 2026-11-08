import { Cause, Effect } from 'effect';
import { z } from 'zod';
import { type NotificationKind, notificationKinds, type WatchedRegistry, watchedRegistries } from '@/contract/catalog';
import { routes } from '@/contract/routes';
import { api } from '@/ui/browser/api';
import {
	element,
	FieldError,
	field,
	find,
	findAll,
	listen,
	Refused,
	refuse,
	report,
	selectField,
	show,
	showError,
	watchValidity,
} from '@/ui/browser/dom.ts';
import { canApplySetup, setup } from '@/ui/browser/setup';

interface Choice {
	stream: string;
	operation: string;
	file: string;
	ref: string;
	credentials: string[];
}
interface RepositoryChoice {
	id: number;
	name: string;
	workflows: Choice[];
}
const credentialDescriptor = z.looseObject({
	id: z.string(),
	type: z.string(),
	transports: z.array(z.string()).optional(),
});
const extensions = z.looseObject({ appid: z.string().optional(), credProps: z.boolean().optional() });
const requirement = z.enum(['discouraged', 'preferred', 'required']);
const requestOptions: z.ZodType<PublicKeyCredentialRequestOptionsJSON> = z.looseObject({
	allowCredentials: z.array(credentialDescriptor).optional(),
	challenge: z.string(),
	extensions: extensions.optional(),
	hints: z.array(z.string()).optional(),
	rpId: z.string().optional(),
	timeout: z.number().optional(),
	userVerification: z.string().optional(),
});
const creationOptions: z.ZodType<PublicKeyCredentialCreationOptionsJSON> = z.looseObject({
	attestation: z.string().optional(),
	authenticatorSelection: z.looseObject({
		authenticatorAttachment: z.enum(['cross-platform', 'platform']).optional(),
		requireResidentKey: z.boolean().optional(),
		residentKey: requirement.optional(),
		userVerification: requirement.optional(),
	}).optional(),
	challenge: z.string(),
	excludeCredentials: z.array(credentialDescriptor).optional(),
	extensions: extensions.optional(),
	hints: z.array(z.string()).optional(),
	pubKeyCredParams: z.array(z.looseObject({ alg: z.number(), type: z.literal('public-key') })),
	rp: z.looseObject({ id: z.string().optional(), name: z.string() }),
	timeout: z.number().optional(),
	user: z.looseObject({ displayName: z.string(), id: z.string(), name: z.string() }),
});
function recovery(value: string | undefined): 'retry' | 'reconcile' {
	return value === 'retry' ? 'retry' : 'reconcile';
}
function registry(value: string | undefined): Effect.Effect<WatchedRegistry, Refused> {
	const found = watchedRegistries.find(name => name === value);
	return found ? Effect.succeed(found) : refuse('Choose npm or JSR.');
}
function notificationKind(value: string | undefined): Effect.Effect<NotificationKind, Refused> {
	const found = notificationKinds.find(kind => kind === value);
	return found ? Effect.succeed(found) : refuse('Choose a destination type.');
}
function storedVersions(form: HTMLFormElement): Effect.Effect<Record<string, number>, Refused> {
	return dataset(z.record(z.string(), z.number()), form.dataset.versions, '{}');
}
function overwriteConfirmed(form: HTMLFormElement, alias: string, versions: Record<string, number>): boolean {
	const version = versions[alias];
	if (version === undefined || form.dataset.confirmed === 'true') {
		delete form.dataset.confirmed;
		form.querySelector('[data-overwrite]')?.remove();
		return true;
	}
	form.querySelector('[data-overwrite]')?.remove();
	const panel = document.createElement('div');
	panel.dataset.overwrite = '';
	panel.className = 'confirm';
	panel.setAttribute('role', 'alertdialog');
	panel.append(node('p', `Overwrite secret ${alias} (version ${version})?`));
	const cancel = node('button', 'Cancel');
	cancel.type = 'button';
	const overwrite = node('button', 'Overwrite');
	overwrite.type = 'button';
	overwrite.className = 'danger';
	cancel.addEventListener('click', () => panel.remove());
	overwrite.addEventListener('click', () => {
		form.dataset.confirmed = 'true';
		panel.remove();
		form.requestSubmit();
	});
	panel.append(cancel, overwrite);
	form.append(panel);
	cancel.focus();
	return false;
}
const revealTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

const repositoryChoice: z.ZodType<RepositoryChoice> = z.object({
	id: z.number().int().positive(),
	name: z.string(),
	workflows: z.array(z.object({
		stream: z.string(),
		operation: z.string(),
		file: z.string(),
		ref: z.string(),
		credentials: z.array(z.string()),
	})),
});
function decoded<S extends z.ZodType>(schema: S, value: unknown, message: string): Effect.Effect<z.output<S>, Refused> {
	const parsed = schema.safeParse(value);
	return parsed.success ? Effect.succeed(parsed.data) : refuse(message);
}
function dataset<S extends z.ZodType>(schema: S, source: string | undefined, fallback: string) {
	const malformed = 'The dashboard sent malformed form data.';
	return Effect.try({
		try: (): unknown => JSON.parse(source ?? fallback),
		catch: () => new Refused({ message: malformed }),
	}).pipe(Effect.flatMap(value => decoded(schema, value, malformed)));
}
function repositoryChoices(form: HTMLFormElement): Effect.Effect<RepositoryChoice[], Refused> {
	return dataset(z.array(repositoryChoice), form.dataset.repositories, '[]');
}
function fields(form: HTMLFormElement): Record<string, string> {
	return Object.fromEntries(
		[...new FormData(form)].filter((entry): entry is [string, string] =>
			typeof entry[1] === 'string' && entry[1] !== ''
		),
	);
}
function browser<A>(run: () => Promise<A>): Effect.Effect<A, Refused> {
	return Effect.tryPromise({
		try: run,
		catch: error => new Refused({ message: error instanceof Error ? error.message : String(error) }),
	});
}
function elevated(form: HTMLFormElement) {
	return Effect.gen(function*() {
		show('Touch your enrolled security key to approve this action.', form);
		const challenge = yield* api(routes.authenticatorsOptions, { register: false });
		const options = yield* decoded(requestOptions, challenge.options, 'The server sent invalid security-key options.');
		const credential = yield* browser(() =>
			navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })
		);
		if (!(credential instanceof PublicKeyCredential)) return yield* refuse('Security key authentication cancelled.');
		const { proof } = yield* api(routes.authenticatorsVerify, { id: challenge.id, response: credential.toJSON() });
		if (!proof) return yield* refuse('The server returned no security-key proof.');
		return proof;
	});
}
function clearRevealed() {
	for (const [output, timer] of revealTimers) {
		clearTimeout(timer);
		output.textContent = '';
	}
	revealTimers.clear();
}
window.addEventListener('pagehide', clearRevealed);
document.addEventListener('visibilitychange', () => {
	if (document.hidden) clearRevealed();
});
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	element.textContent = text;
	return element;
}
function inspecting(form: HTMLFormElement, name: string): () => void {
	const card = form.closest('article');
	if (!card) return () => {};
	if (form.querySelector('input[type="hidden"][name="repository"]')) {
		const badge = find(card, 'summary .badge', HTMLElement);
		const previous = { label: badge?.textContent ?? '', tone: badge?.dataset.tone ?? 'neutral' };
		card.classList.add('pending');
		if (badge) {
			badge.textContent = 'Inspecting…';
			badge.dataset.tone = 'active';
		}
		return () => {
			card.classList.remove('pending');
			if (badge) {
				badge.textContent = previous.label;
				badge.dataset.tone = previous.tone;
			}
		};
	}
	const placeholder = node('article', '');
	placeholder.className = 'pending';
	const heading = node('div', '');
	heading.className = 'section-heading';
	const badge = node('span', 'Inspecting…');
	badge.className = 'badge';
	badge.dataset.tone = 'active';
	heading.append(node('h2', name), badge);
	placeholder.append(heading);
	card.after(placeholder);
	return () => placeholder.remove();
}
function selectedWorkflow(form: HTMLFormElement) {
	return Effect.gen(function*() {
		const repositoryId = yield* field(form, 'repositoryId'), choiceField = yield* field(form, 'choice');
		const repository = (yield* repositoryChoices(form)).find(r => String(r.id) === repositoryId.value);
		const choice = repository?.workflows[Number(choiceField.value)];
		if (!choice) {
			return yield* new FieldError({
				message: 'Choose a repository and workflow.',
				fields: [repositoryId, choiceField],
			});
		}
		return choice;
	});
}
function each<E>(selector: string, setup: (form: HTMLFormElement) => Effect.Effect<void, E>): void {
	for (const form of findAll(document, selector, HTMLFormElement)) Effect.runSync(report(setup(form)));
}
const wingetPlans = new WeakMap<HTMLFormElement, { digest: string }>();
each('form[data-action="winget-submit"]', form =>
	Effect.gen(function*() {
		const submit = yield* element(form, 'button[value="submit"]', HTMLButtonElement);
		const repositoryId = yield* field(form, 'repositoryId');
		const release = yield* selectField(form, 'releaseId');
		let revision = 0;
		listen(form, 'change', event =>
			Effect.gen(function*() {
				wingetPlans.delete(form);
				submit.disabled = true;
				form.querySelector('.plan-result')?.replaceChildren();
				if (event.target !== repositoryId) return;
				const current = ++revision;
				release.disabled = true;
				release.replaceChildren(new Option('Loading releases…', ''));
				if (!repositoryId.value) {
					release.replaceChildren(new Option('Choose a repository first', ''));
					return;
				}
				yield* api(routes.wingetReleases, { repositoryId: Number(repositoryId.value) }).pipe(
					Effect.matchCause({
						onSuccess: rows => {
							if (revision !== current) return;
							release.replaceChildren(new Option(rows.length ? 'Choose a release' : 'No eligible stable releases', ''));
							for (const row of rows) release.add(new Option(`${row.name} (${row.tag})`, String(row.id)));
							release.disabled = !rows.length;
						},
						onFailure: cause => {
							if (revision !== current) return;
							release.replaceChildren(new Option('Unable to load releases', ''));
							showError(Cause.squash(cause), form);
						},
					}),
				);
			}), form);
	}));
each('form[data-action="grant-save"]', form =>
	Effect.gen(function*() {
		const repositories = yield* repositoryChoices(form);
		const repository = yield* field(form, 'repositoryId'), choice = yield* selectField(form, 'choice');
		const delivery = yield* selectField(form, 'delivery'), alias = yield* field(form, 'alias');
		const secretName = yield* field(form, 'secretName'), environment = yield* field(form, 'environment');
		const updateScope = () => {
			const scope = find(form, '.workflow-scope', HTMLElement);
			const selected = choice.value === ''
				? undefined
				: repositories.find(r => String(r.id) === repository.value)?.workflows[Number(choice.value)];
			if (scope) {
				scope.replaceChildren();
				if (selected) {
					const details = node('dl', '');
					details.className = 'metadata-grid';
					for (
						const [label, value] of [
							['Stream', selected.stream],
							['Operation', selected.operation],
							['Workflow', selected.file],
							['Allowed ref', selected.ref],
						]
					) {
						const entry = node('div', '');
						entry.append(node('dt', label ?? ''), node('dd', value ?? ''));
						details.append(entry);
					}
					scope.append(details);
				} else scope.textContent = 'Choose a repository and workflow.';
			}
			const runtime = delivery.options[0];
			if (runtime) runtime.disabled = !!selected && !selected.credentials.includes(alias.value);
			const help = find(form, '.delivery-help', HTMLElement);
			if (help) {
				help.textContent = selected && !selected.credentials.includes(alias.value)
					? 'Runtime retrieval is unavailable until this name is added to this release stream’s credentials list in .github/beepboop.json. You can choose GitHub delivery instead.'
					: 'Runtime retrieval uses the credentials Action. GitHub delivery is copied separately after saving access.';
			}
		};
		repository.addEventListener('change', () => {
			const selected = repositories.find(r => String(r.id) === repository.value);
			choice.replaceChildren(new Option('Choose a workflow', ''));
			selected?.workflows.forEach((w, index) => {
				choice.add(new Option(`${w.stream} / ${w.operation} (${w.file})`, String(index)));
			});
			choice.disabled = !selected;
			updateScope();
		});
		choice.addEventListener('change', updateScope);
		delivery.addEventListener('change', () => {
			const label = find(form, '[data-secret-name]', HTMLElement);
			if (label) label.hidden = delivery.value === 'runtime';
			secretName.disabled = delivery.value === 'runtime';
			secretName.required = delivery.value !== 'runtime';
			environment.required = delivery.value === 'environment';
			updateScope();
		});
	}));
each(
	'form[data-action="release-prepare"],form[data-action="release-set"]',
	form =>
		Effect.sync(() =>
			listen(form, 'change', () =>
				Effect.gen(function*() {
					const mode = form.elements.namedItem('versionMode');
					if (!(mode instanceof HTMLSelectElement)) return;
					for (const hidden of findAll(form, '[data-explicit]', HTMLElement)) {
						hidden.hidden = mode.value !== 'explicit';
					}
					for (const hidden of findAll(form, '[data-prerelease]', HTMLElement)) {
						hidden.hidden = mode.value !== 'prerelease';
					}
					(yield* field(form, 'version')).required = mode.value === 'explicit';
				}), form)
		),
);
each('form[data-action="approve"]', form =>
	Effect.gen(function*() {
		const status = find(form, '.approval-status', HTMLElement);
		const approve = find(form, 'button', HTMLButtonElement);
		const id = (yield* field(form, 'id')).value;
		const force = yield* field(form, 'force');
		const automatic = form.dataset.automatic === 'true';
		const override = () => {
			force.value = 'true';
			if (!approve) return;
			approve.textContent = automatic ? 'Release now anyway' : 'Approve anyway';
			approve.hidden = false;
		};
		yield* Effect.forkDetach(
			api(routes.executionsApproval, { id }).pipe(
				Effect.matchCause({
					onSuccess: ({ problems, blocked }) => {
						status?.replaceChildren(
							...(blocked.length ? blocked : problems.length ? problems : ['Signature verified and checks passed.'])
								.map(
									text => node('li', text),
								),
						);
						if (blocked.length) {
							if (approve) approve.hidden = true;
						} else if (problems.length) override();
					},
					onFailure: cause => {
						const error = Cause.squash(cause);
						status?.replaceChildren(
							node('li', error instanceof Error ? error.message : 'Could not check this commit.'),
						);
						override();
					},
				}),
				Effect.ensuring(Effect.sync(() => {
					if (approve) approve.disabled = false;
				})),
			),
		);
	}));
const repositorySelection = find(document, '.selection select[name="repository"]', HTMLSelectElement);
repositorySelection?.addEventListener('change', () => {
	location.assign(`/releases?repository=${encodeURIComponent(repositorySelection.value)}`);
});

const runsLatest = find(document, '[data-runs-latest]', HTMLElement);
if (runsLatest) {
	const rendered = Number(runsLatest.dataset.runsLatest);
	setInterval(() => {
		if (document.hidden) return;
		Effect.runFork(
			api(routes.executionsList, {}).pipe(
				Effect.tap(runs =>
					Effect.sync(() => {
						if (Math.max(0, ...runs.map(run => run.updatedAt)) > rendered) location.reload();
					})
				),
				Effect.ignoreCause,
			),
		);
	}, 5000);
}

const reload = Effect.sync(() => location.reload());
function navigate(url: string) {
	return Effect.sync(() => location.assign(url));
}

function submitted(form: HTMLFormElement, action: string | undefined, clicked: string, data: Record<string, string>) {
	return Effect.gen(function*() {
		if (action === 'setup') {
			yield* setup(form, clicked);
		} else if (action === 'winget-refresh') {
			yield* api(routes.wingetRefresh, {});
			yield* reload;
		} else if (action === 'winget-retry') {
			yield* api(routes.wingetSubmit, {
				repositoryId: Number(data.repositoryId),
				releaseId: Number(data.releaseId),
				digest: data.digest ?? '',
			});
			yield* reload;
		} else if (action === 'winget-submit') {
			const selection = { repositoryId: Number(data.repositoryId), releaseId: Number(data.releaseId) };
			if (clicked === 'preview') {
				const plan = yield* api(routes.wingetPreview, selection);
				if (
					(yield* field(form, 'repositoryId')).value !== data.repositoryId
					|| (yield* field(form, 'releaseId')).value !== data.releaseId
				) return yield* refuse('Selection changed; preview again.');
				wingetPlans.set(form, plan);
				const result = form.querySelector('.plan-result');
				if (!result) return yield* refuse('Missing WinGet preview');
				result.replaceChildren(
					node('h3', 'Review the WinGet submission'),
					node('p', `Source commit: ${plan.sourceSha}`),
				);
				for (const [path, content] of Object.entries(plan.files)) {
					const detail = node('details', '');
					detail.append(node('summary', path), node('pre', content));
					result.append(detail);
				}
				const submit = find(form, 'button[value="submit"]', HTMLButtonElement);
				if (!submit) return yield* refuse('Missing WinGet submit button');
				submit.disabled = submit.dataset.submitReady !== 'true';
				show('Review the manifests, then submit. Microsoft controls acceptance and merging.', form);
			} else {
				const plan = wingetPlans.get(form);
				if (!plan) return yield* refuse('Preview the release before submitting.');
				yield* api(routes.wingetSubmit, { ...selection, digest: plan.digest });
				yield* reload;
			}
		} else if (action === 'release-prepare' || action === 'release-set') {
			const common = { repositoryId: Number(data.repositoryId), stream: data.stream ?? '' };
			const version = data.versionMode === 'explicit'
				? data.version
				: data.versionMode === 'prerelease'
				? { bump: 'prerelease', base: data.base, identifier: data.identifier }
				: { bump: data.versionMode };
			const chosen = findAll(form, 'fieldset[data-group]', HTMLFieldSetElement).filter(group => {
				const selected = group.querySelector('input[type=checkbox]');
				return selected instanceof HTMLInputElement && selected.checked;
			});
			const entries = yield* Effect.forEach(chosen, group =>
				Effect.gen(function*() {
					const versionField = yield* field(form, `version-${group.dataset.group}`);
					return {
						group: {
							id: group.dataset.group,
							packages: yield* dataset(z.array(z.string()), group.dataset.packages, '[]'),
							version: versionField.value,
						},
						versionField,
					};
				}));
			const groups = entries.map(entry => entry.group);
			const operations = findAll(form, 'select[data-operation]', HTMLSelectElement).filter(select => select.value)
				.map(select => ({ id: select.dataset.operation, group: select.value }));
			if (action === 'release-set' && !groups.length) {
				return yield* new FieldError({
					message: 'Select at least one package group.',
					fields: findAll(form, 'fieldset[data-group] input[type=checkbox]', HTMLInputElement),
				});
			}
			const unversioned = entries.filter(entry => !entry.group.version);
			if (action === 'release-set' && unversioned.length) {
				return yield* new FieldError({
					message: 'Enter a version for each selected group.',
					fields: unversioned.map(entry => entry.versionField),
				});
			}
			let run: { id: string };
			if (action === 'release-set') {
				const request = { ...common, plan: { groups, operations } };
				const reviewed = yield* api(routes.releasesPlanSet, request);
				run = yield* api(routes.releasesPrepareSet, {
					...request,
					sourceSha: reviewed.sourceSha,
					planId: reviewed.planId,
				});
			} else {
				const request = { ...common, version };
				const reviewed = yield* api(routes.releasesPlan, request);
				run = yield* api(routes.releasesPrepare, {
					...request,
					sourceSha: reviewed.sourceSha,
					planId: reviewed.planId,
				});
			}
			yield* navigate(`/runs#${encodeURIComponent(run.id)}`);
		} else if (action === 'discover') {
			show(`Inspecting ${data.repository ?? 'repository'}…`, form);
			const undo = inspecting(form, data.repository ?? '');
			const repository = yield* api(routes.repositoriesDiscover, { repository: data.repository ?? '' }).pipe(
				Effect.onError(() => Effect.sync(undo)),
			);
			yield* navigate(`/repositories?repository=${encodeURIComponent(repository.name)}`);
		} else if (action === 'cancel') {
			yield* api(routes.executionsCancel, { id: data.id ?? '' });
			yield* reload;
		} else if (action === 'approve' || action === 'recover') {
			if (action === 'approve') {
				yield* api(routes.executionsApprove, {
					id: data.id ?? '',
					sourceSha: data.sourceSha ?? '',
					force: data.force === 'true',
				});
			} else yield* api(routes.executionsRecover, { id: data.id ?? '', action: recovery(data.action) });
			yield* reload;
		} else if (action === 'start-set') {
			yield* api(routes.releasesStartSet, {
				preparationId: data.preparationId ?? '',
				sourceSha: data.sourceSha ?? '',
			});
			yield* navigate('/runs');
		} else if (action === 'secret-save') {
			const versions = yield* storedVersions(form);
			if (!overwriteConfirmed(form, data.alias ?? '', versions)) return;
			const value = data.value;
			const valueField = yield* field(form, 'value');
			const proof = yield* elevated(form);
			valueField.value = '';
			yield* api(routes.credentialsReplace, {
				alias: data.alias ?? '',
				value: value ?? '',
				proof,
				expectedVersion: versions[data.alias ?? ''] ?? null,
			});
			yield* reload;
		} else if (action === 'secret-reveal') {
			clearRevealed();
			const result = yield* api(routes.credentialsReveal, { alias: data.alias ?? '', proof: yield* elevated(form) });
			const output = find(form, '.revealed', HTMLElement);
			if (output) {
				output.textContent = result.value;
				revealTimers.set(
					output,
					setTimeout(() => {
						output.textContent = '';
						revealTimers.delete(output);
					}, 30_000),
				);
			}
			show('Value shown for 30 seconds. It also clears when you leave this page.', form);
		} else if (action === 'secret-sync') {
			const results = yield* api(routes.credentialsSync, { alias: data.alias ?? '', proof: yield* elevated(form) });
			const failed = results.filter(r => r.state !== 'succeeded').length;
			show(
				failed
					? `${failed} destination(s) failed. Refresh to see which permissions need another copy.`
					: `Latest value copied to ${results.length} GitHub destination(s). Refresh to update their status.`,
				form,
			);
		} else if (action === 'grant-save') {
			const selected = yield* selectedWorkflow(form);
			if (data.delivery === 'runtime' && !selected.credentials.includes(data.alias ?? '')) {
				return yield* new FieldError({
					message: 'Add this name to the stream’s credentials list before choosing runtime delivery.',
					fields: [yield* field(form, 'delivery')],
				});
			}
			yield* api(routes.credentialsGrant, {
				selection: {
					alias: data.alias,
					repositoryId: Number(data.repositoryId),
					stream: selected.stream,
					operation: selected.operation,
					delivery: data.delivery,
					environment: data.environment,
					secretName: data.secretName,
				},
				proof: yield* elevated(form),
			});
			yield* reload;
		} else if (action === 'grant-revoke') {
			if (
				form.dataset.delivery !== 'runtime'
				&& !confirm(
					'Remove this permission? The value already copied to GitHub will remain there. Delete that GitHub secret separately to remove it.',
				)
			) return;
			yield* api(routes.credentialsRevoke, { grantId: data.grantId ?? '', proof: yield* elevated(form) });
			yield* reload;
		} else if (action === 'package-add' || action === 'package-remove') {
			const watch = { registry: yield* registry(data.registry), name: data.name ?? '' };
			yield* api(action === 'package-add' ? routes.packagesAdd : routes.packagesRemove, watch);
			yield* reload;
		} else if (action === 'package-subscription') {
			yield* api(routes.packagesSubscription, {
				destinationId: data.destinationId ?? '',
				registry: yield* registry(data.registry),
				name: data.name ?? '',
				subscribed: data.subscribed === 'true',
			});
			yield* reload;
		} else if (action === 'notification-save') {
			yield* api(routes.notificationsSave, {
				destination: {
					...(data.id ? { id: data.id } : {}),
					name: data.name ?? '',
					kind: yield* notificationKind(data.kind),
					credential: data.credential ?? '',
					subscribeNew: data.subscribeNew === 'true',
					enabled: data.enabled === 'true',
				},
			});
			yield* reload;
		} else if (action === 'notification-remove') {
			if (!confirm('Remove this destination? Its package subscriptions are removed too.')) return;
			yield* api(routes.notificationsRemove, { id: data.id ?? '' });
			yield* reload;
		} else if (action === 'key-enroll') {
			const proof = form.dataset.first === 'true' ? undefined : yield* elevated(form);
			const challenge = yield* api(routes.authenticatorsOptions, { register: true, label: data.label, proof });
			show('Touch the security key you want to enroll.', form);
			const options = yield* decoded(creationOptions, challenge.options, 'The server sent invalid enrollment options.');
			const credential = yield* browser(() =>
				navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) })
			);
			if (!(credential instanceof PublicKeyCredential)) return yield* refuse('Security key enrollment cancelled.');
			yield* api(routes.authenticatorsVerify, { id: challenge.id, response: credential.toJSON() });
			yield* reload;
		} else if (action === 'cli-revoke' || action === 'cli-revoke-all') {
			if (action === 'cli-revoke') yield* api(routes.cliSessionsRevoke, { id: data.id ?? '' });
			else yield* api(routes.cliSessionsRevokeAll, {});
			yield* reload;
		} else if (action === 'key-remove') {
			yield* api(routes.authenticatorsRemove, { id: data.id ?? '', proof: yield* elevated(form) });
			yield* reload;
		}
	});
}

each('form[data-action]', form =>
	Effect.sync(() => {
		watchValidity(form);
		form.addEventListener('submit', event => {
			event.preventDefault();
			const action = form.dataset.action;
			const data = fields(form);
			const submitter = event.submitter;
			const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector('button');
			if (!button || form.dataset.busy === 'true') return;
			const clicked = button.value;
			form.dataset.busy = 'true';
			button.disabled = true;
			Effect.runFork(
				report(submitted(form, action, clicked, data), form).pipe(
					Effect.ensuring(Effect.sync(() => {
						form.dataset.busy = 'false';
						button.disabled = action === 'setup' && clicked === 'apply' && !canApplySetup(form);
					})),
				),
			);
		});
	}));
