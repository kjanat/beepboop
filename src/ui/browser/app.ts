import { z } from 'zod';
import { type NotificationKind, notificationKinds, type WatchedRegistry, watchedRegistries } from '@/contract/catalog';
import { routes } from '@/contract/routes';
import { array, integer, record, string } from '@/model';
import { api } from '@/ui/browser/api';
import { FieldError, find, findAll, show, showError, watchValidity } from '@/ui/browser/dom.ts';
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
function registry(value: string | undefined): WatchedRegistry {
	const found = watchedRegistries.find(name => name === value);
	if (!found) throw new Error('Choose npm or JSR.');
	return found;
}
function notificationKind(value: string | undefined): NotificationKind {
	const found = notificationKinds.find(kind => kind === value);
	if (!found) throw new Error('Choose a destination type.');
	return found;
}
function storedVersion(form: HTMLFormElement, alias: string): number | undefined {
	return z.record(z.string(), z.number()).parse(JSON.parse(form.dataset.versions ?? '{}'))[alias];
}
function overwriteConfirmed(form: HTMLFormElement, alias: string): boolean {
	const versions = z.record(z.string(), z.number()).parse(JSON.parse(form.dataset.versions ?? '{}'));
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

function input(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement {
	const field = form.elements.namedItem(name);
	if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
		throw new Error(`Missing field: ${name}`);
	}
	return field;
}
function selectInput(form: HTMLFormElement, name: string): HTMLSelectElement {
	const field = form.elements.namedItem(name);
	if (!(field instanceof HTMLSelectElement)) throw new Error(`Missing field: ${name}`);
	return field;
}
function repositoryChoices(form: HTMLFormElement): RepositoryChoice[] {
	return array(JSON.parse(form.dataset.repositories ?? '[]')).map(raw => {
		const repository = record(raw);
		return {
			id: integer(repository.id),
			name: string(repository.name),
			workflows: array(repository.workflows).map(value => {
				const workflow = record(value);
				return {
					stream: string(workflow.stream),
					operation: string(workflow.operation),
					file: string(workflow.file),
					ref: string(workflow.ref),
					credentials: array(workflow.credentials).map(string),
				};
			}),
		};
	});
}
function fields(form: HTMLFormElement): Record<string, string> {
	return Object.fromEntries(
		[...new FormData(form)].filter((entry): entry is [string, string] =>
			typeof entry[1] === 'string' && entry[1] !== ''
		),
	);
}
async function elevated(form: HTMLFormElement): Promise<string> {
	show('Touch your enrolled security key to approve this action.', form);
	const challenge = await api(routes.authenticatorsOptions, { register: false });
	const credential = await navigator.credentials.get({
		publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(requestOptions.parse(challenge.options)),
	});
	if (!(credential instanceof PublicKeyCredential)) throw new Error('Security key authentication cancelled.');
	const { proof } = await api(routes.authenticatorsVerify, { id: challenge.id, response: credential.toJSON() });
	if (!proof) throw new Error('The server returned no security-key proof.');
	return proof;
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
function selectedWorkflow(form: HTMLFormElement): Choice {
	const repository = repositoryChoices(form).find(r => String(r.id) === input(form, 'repositoryId').value);
	const choice = repository?.workflows[Number(input(form, 'choice').value)];
	if (!choice) {
		throw new FieldError('Choose a repository and workflow.', [input(form, 'repositoryId'), input(form, 'choice')]);
	}
	return choice;
}
function attempt(work: () => void): void {
	try {
		work();
	} catch (error) {
		showError(error);
	}
}
function each(selector: string, setup: (form: HTMLFormElement) => void): void {
	for (const form of findAll(document, selector, HTMLFormElement)) attempt(() => setup(form));
}
const wingetPlans = new WeakMap<HTMLFormElement, { digest: string }>();
each('form[data-action="winget-submit"]', form => {
	const submit = find(form, 'button[value="submit"]', HTMLButtonElement);
	if (!submit) throw Error('Missing WinGet submit button');
	let revision = 0;
	form.addEventListener('change', async event => {
		wingetPlans.delete(form);
		submit.disabled = true;
		form.querySelector('.plan-result')?.replaceChildren();
		if (event.target !== input(form, 'repositoryId')) return;
		const current = ++revision;
		const release = selectInput(form, 'releaseId');
		release.disabled = true;
		release.replaceChildren(new Option('Loading releases…', ''));
		if (!input(form, 'repositoryId').value) {
			release.replaceChildren(new Option('Choose a repository first', ''));
			return;
		}
		try {
			const rows = await api(routes.wingetReleases, { repositoryId: Number(input(form, 'repositoryId').value) });
			if (revision !== current) return;
			release.replaceChildren(new Option(rows.length ? 'Choose a release' : 'No eligible stable releases', ''));
			for (const row of rows) release.add(new Option(`${row.name} (${row.tag})`, String(row.id)));
			release.disabled = !rows.length;
		} catch (error) {
			if (revision === current) {
				release.replaceChildren(new Option('Unable to load releases', ''));
				showError(error, form);
			}
		}
	});
});
each('form[data-action="grant-save"]', form => {
	const repositories = repositoryChoices(form);
	const repository = input(form, 'repositoryId'), choice = selectInput(form, 'choice');
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
					const [label, value] of [['Stream', selected.stream], ['Operation', selected.operation], [
						'Workflow',
						selected.file,
					], ['Allowed ref', selected.ref]]
				) {
					const field = node('div', '');
					field.append(node('dt', label ?? ''), node('dd', value ?? ''));
					details.append(field);
				}
				scope.append(details);
			} else scope.textContent = 'Choose a repository and workflow.';
		}
		const runtime = selectInput(form, 'delivery').options[0];
		if (runtime) runtime.disabled = !!selected && !selected.credentials.includes(input(form, 'alias').value);
		const help = find(form, '.delivery-help', HTMLElement);
		if (help) {
			help.textContent = selected && !selected.credentials.includes(input(form, 'alias').value)
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
	input(form, 'delivery').addEventListener('change', () => {
		const delivery = input(form, 'delivery').value;
		const label = find(form, '[data-secret-name]', HTMLElement);
		if (label) label.hidden = delivery === 'runtime';
		const secretName = input(form, 'secretName');
		secretName.disabled = delivery === 'runtime';
		secretName.required = delivery !== 'runtime';
		input(form, 'environment').required = delivery === 'environment';
		updateScope();
	});
});
each('form[data-action="release-prepare"],form[data-action="release-set"]', form => {
	form.addEventListener('change', () => {
		const mode = form.elements.namedItem('versionMode');
		if (!(mode instanceof HTMLSelectElement)) return;
		for (const element of findAll(form, '[data-explicit]', HTMLElement)) {
			element.hidden = mode.value !== 'explicit';
		}
		for (const element of findAll(form, '[data-prerelease]', HTMLElement)) {
			element.hidden = mode.value !== 'prerelease';
		}
		input(form, 'version').required = mode.value === 'explicit';
	});
});
each('form[data-action="approve"]', form => {
	const status = find(form, '.approval-status', HTMLElement);
	const approve = find(form, 'button', HTMLButtonElement);
	const id = input(form, 'id').value;
	const automatic = form.dataset.automatic === 'true';
	const override = () => {
		input(form, 'force').value = 'true';
		if (!approve) return;
		approve.textContent = automatic ? 'Release now anyway' : 'Approve anyway';
		approve.hidden = false;
	};
	api(routes.executionsApproval, { id }).then(({ problems }) => {
		status?.replaceChildren(
			...(problems.length ? problems : ['Signature verified and checks passed.']).map(text => node('li', text)),
		);
		if (problems.length) override();
	}).catch((error: unknown) => {
		status?.replaceChildren(node('li', error instanceof Error ? error.message : 'Could not check this commit.'));
		override();
	}).finally(() => {
		if (approve) approve.disabled = false;
	});
});
attempt(() => {
	const repositorySelection = find(document, '.selection select[name="repository"]', HTMLSelectElement);
	if (!repositorySelection) return;
	repositorySelection.addEventListener('change', () => {
		location.assign(`/releases?repository=${encodeURIComponent(repositorySelection.value)}`);
	});
});

attempt(() => {
	const runsLatest = find(document, '[data-runs-latest]', HTMLElement);
	if (!runsLatest) return;
	const rendered = Number(runsLatest.dataset.runsLatest);
	setInterval(() => {
		if (document.hidden) return;
		api(routes.executionsList, {}).then(runs => {
			if (Math.max(0, ...runs.map(run => run.updatedAt)) > rendered) location.reload();
		}).catch(() => undefined);
	}, 5000);
});

each('form[data-action]', form => {
	watchValidity(form);
	form.addEventListener('submit', async event => {
		event.preventDefault();
		const action = form.dataset.action;
		const data = fields(form);
		const submitter = event.submitter;
		const button = submitter instanceof HTMLButtonElement ? submitter : form.querySelector('button');
		if (!button || form.dataset.busy === 'true') return;
		const clicked = button.value;
		form.dataset.busy = 'true';
		button.disabled = true;
		try {
			if (action === 'setup') {
				await setup(form, clicked);
			} else if (action === 'winget-refresh') {
				await api(routes.wingetRefresh, {});
				location.reload();
			} else if (action === 'winget-retry') {
				await api(routes.wingetSubmit, {
					repositoryId: Number(data.repositoryId),
					releaseId: Number(data.releaseId),
					digest: data.digest ?? '',
				});
				location.reload();
			} else if (action === 'winget-submit') {
				const selection = { repositoryId: Number(data.repositoryId), releaseId: Number(data.releaseId) };
				if (clicked === 'preview') {
					const plan = await api(routes.wingetPreview, selection);
					if (
						input(form, 'repositoryId').value !== data.repositoryId || input(form, 'releaseId').value !== data.releaseId
					) throw Error('Selection changed; preview again.');
					wingetPlans.set(form, plan);
					const result = form.querySelector('.plan-result');
					if (!result) throw Error('Missing WinGet preview');
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
					if (!submit) throw Error('Missing WinGet submit button');
					submit.disabled = submit.dataset.submitReady !== 'true';
					show('Review the manifests, then submit. Microsoft controls acceptance and merging.', form);
				} else {
					const plan = wingetPlans.get(form);
					if (!plan) throw Error('Preview the release before submitting.');
					await api(routes.wingetSubmit, { ...selection, digest: plan.digest });
					location.reload();
				}
			} else if (action === 'release-prepare' || action === 'release-set') {
				const common = { repositoryId: Number(data.repositoryId), stream: data.stream ?? '' };
				const version = data.versionMode === 'explicit'
					? data.version
					: data.versionMode === 'prerelease'
					? { bump: 'prerelease', base: data.base, identifier: data.identifier }
					: { bump: data.versionMode };
				const groups = findAll(form, 'fieldset[data-group]', HTMLFieldSetElement).filter(group => {
					const selected = group.querySelector('input[type=checkbox]');
					return selected instanceof HTMLInputElement && selected.checked;
				}).map(group => ({
					id: group.dataset.group,
					packages: array(JSON.parse(group.dataset.packages ?? '[]')).map(string),
					version: input(form, `version-${group.dataset.group}`).value,
				}));
				const operations = findAll(form, 'select[data-operation]', HTMLSelectElement).filter(select => select.value)
					.map(select => ({ id: select.dataset.operation, group: select.value }));
				if (action === 'release-set' && !groups.length) {
					throw new FieldError(
						'Select at least one package group.',
						findAll(form, 'fieldset[data-group] input[type=checkbox]', HTMLInputElement),
					);
				}
				const unversioned = groups.filter(group => !group.version);
				if (action === 'release-set' && unversioned.length) {
					throw new FieldError(
						'Enter a version for each selected group.',
						unversioned.map(group => input(form, `version-${group.id}`)),
					);
				}
				let run: { id: string };
				if (action === 'release-set') {
					const request = { ...common, plan: { groups, operations } };
					const reviewed = await api(routes.releasesPlanSet, request);
					run = await api(routes.releasesPrepareSet, {
						...request,
						sourceSha: reviewed.sourceSha,
						planId: reviewed.planId,
					});
				} else {
					const request = { ...common, version };
					const reviewed = await api(routes.releasesPlan, request);
					run = await api(routes.releasesPrepare, {
						...request,
						sourceSha: reviewed.sourceSha,
						planId: reviewed.planId,
					});
				}
				location.assign(`/runs#${encodeURIComponent(run.id)}`);
			} else if (action === 'discover') {
				show(`Inspecting ${data.repository ?? 'repository'}…`, form);
				const undo = inspecting(form, data.repository ?? '');
				try {
					const repository = await api(routes.repositoriesDiscover, { repository: data.repository ?? '' });
					location.assign(`/repositories?repository=${encodeURIComponent(repository.name)}`);
				} catch (error) {
					undo();
					throw error;
				}
			} else if (action === 'cancel') {
				await api(routes.executionsCancel, { id: data.id ?? '' });
				location.reload();
			} else if (action === 'approve' || action === 'recover') {
				if (action === 'approve') {
					await api(routes.executionsApprove, {
						id: data.id ?? '',
						sourceSha: data.sourceSha ?? '',
						force: data.force === 'true',
					});
				} else await api(routes.executionsRecover, { id: data.id ?? '', action: recovery(data.action) });
				location.reload();
			} else if (action === 'start-set') {
				await api(routes.releasesStartSet, {
					preparationId: data.preparationId ?? '',
					sourceSha: data.sourceSha ?? '',
				});
				location.assign('/runs');
			} else if (action === 'secret-save') {
				if (!overwriteConfirmed(form, data.alias ?? '')) return;
				const value = data.value;
				const proof = await elevated(form);
				input(form, 'value').value = '';
				await api(routes.credentialsReplace, {
					alias: data.alias ?? '',
					value: value ?? '',
					proof,
					expectedVersion: storedVersion(form, data.alias ?? '') ?? null,
				});
				location.reload();
			} else if (action === 'secret-reveal') {
				clearRevealed();
				const result = await api(routes.credentialsReveal, { alias: data.alias ?? '', proof: await elevated(form) });
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
				const results = await api(routes.credentialsSync, { alias: data.alias ?? '', proof: await elevated(form) });
				const failed = results.filter(r => r.state !== 'succeeded').length;
				show(
					failed
						? `${failed} destination(s) failed. Refresh to see which permissions need another copy.`
						: `Latest value copied to ${results.length} GitHub destination(s). Refresh to update their status.`,
					form,
				);
			} else if (action === 'grant-save') {
				const selected = selectedWorkflow(form);
				if (data.delivery === 'runtime' && !selected.credentials.includes(data.alias ?? '')) {
					throw new FieldError('Add this name to the stream’s credentials list before choosing runtime delivery.', [
						input(form, 'delivery'),
					]);
				}
				await api(routes.credentialsGrant, {
					selection: {
						alias: data.alias,
						repositoryId: Number(data.repositoryId),
						stream: selected.stream,
						operation: selected.operation,
						delivery: data.delivery,
						environment: data.environment,
						secretName: data.secretName,
					},
					proof: await elevated(form),
				});
				location.reload();
			} else if (action === 'grant-revoke') {
				if (
					form.dataset.delivery !== 'runtime'
					&& !confirm(
						'Remove this permission? The value already copied to GitHub will remain there. Delete that GitHub secret separately to remove it.',
					)
				) return;
				await api(routes.credentialsRevoke, { grantId: data.grantId ?? '', proof: await elevated(form) });
				location.reload();
			} else if (action === 'package-add' || action === 'package-remove') {
				const watch = { registry: registry(data.registry), name: data.name ?? '' };
				await api(action === 'package-add' ? routes.packagesAdd : routes.packagesRemove, watch);
				location.reload();
			} else if (action === 'package-subscription') {
				await api(routes.packagesSubscription, {
					destinationId: data.destinationId ?? '',
					registry: registry(data.registry),
					name: data.name ?? '',
					subscribed: data.subscribed === 'true',
				});
				location.reload();
			} else if (action === 'notification-save') {
				await api(routes.notificationsSave, {
					destination: {
						...(data.id ? { id: data.id } : {}),
						name: data.name ?? '',
						kind: notificationKind(data.kind),
						credential: data.credential ?? '',
						subscribeNew: data.subscribeNew === 'true',
						enabled: data.enabled === 'true',
					},
					proof: await elevated(form),
				});
				location.reload();
			} else if (action === 'notification-remove') {
				if (!confirm('Remove this destination? Its package subscriptions are removed too.')) return;
				await api(routes.notificationsRemove, { id: data.id ?? '' });
				location.reload();
			} else if (action === 'key-enroll') {
				const proof = form.dataset.first === 'true' ? undefined : await elevated(form);
				const challenge = await api(routes.authenticatorsOptions, { register: true, label: data.label, proof });
				show('Touch the security key you want to enroll.', form);
				const credential = await navigator.credentials.create({
					publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(creationOptions.parse(challenge.options)),
				});
				if (!(credential instanceof PublicKeyCredential)) throw new Error('Security key enrollment cancelled.');
				await api(routes.authenticatorsVerify, { id: challenge.id, response: credential.toJSON() });
				location.reload();
			} else if (action === 'cli-revoke' || action === 'cli-revoke-all') {
				if (action === 'cli-revoke') await api(routes.cliSessionsRevoke, { id: data.id ?? '' });
				else await api(routes.cliSessionsRevokeAll, {});
				location.reload();
			} else if (action === 'key-remove') {
				await api(routes.authenticatorsRemove, { id: data.id ?? '', proof: await elevated(form) });
				location.reload();
			}
		} catch (error) {
			showError(error, form);
		} finally {
			form.dataset.busy = 'false';
			button.disabled = action === 'setup' && clicked === 'apply' && !canApplySetup(form);
		}
	});
});
