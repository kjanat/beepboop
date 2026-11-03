import { array, integer, record, string } from '@/model';
import { api, show, showError } from '@/ui/browser/dom.ts';
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
interface Plan {
	sourceSha: string;
	planId: string;
	version?: string;
	edits: { path: string; before: string; after: string }[];
	groups?: { id: string; version: string; packages: string[] }[];
	diagnostics?: string[];
}
interface Preview {
	identity: string;
	plan: Plan;
}
const previews = new WeakMap<HTMLFormElement, Preview>();
const revealTimers = new Map<HTMLOutputElement, ReturnType<typeof setTimeout>>();

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
async function elevated(): Promise<string> {
	show('Touch your enrolled security key to approve this action.');
	const challenge = await api<{ id: string; options: PublicKeyCredentialRequestOptionsJSON }>(
		'/api/authenticators/options',
		{ register: false },
	);
	const credential = await navigator.credentials.get({
		publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(challenge.options),
	});
	if (!(credential instanceof PublicKeyCredential)) throw new Error('Security key authentication cancelled.');
	return (await api<{ proof: string }>('/api/authenticators/verify', {
		id: challenge.id,
		response: credential.toJSON(),
	})).proof;
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
function renderPlan(form: HTMLFormElement, plan: Plan) {
	const result = form.querySelector<HTMLElement>('.plan-result');
	if (!result) return;
	result.replaceChildren(node('h3', plan.version ? `Review version ${plan.version}` : 'Review release set'));
	result.append(node('p', `Source commit: ${plan.sourceSha}`));
	for (const group of plan.groups ?? []) result.append(node('p', `${group.packages.join(', ')} → ${group.version}`));
	for (const diagnostic of plan.diagnostics ?? []) result.append(node('p', diagnostic));
	if (!plan.edits.length) {
		result.append(node('p', 'No manifest edits. Preparation follows the configured repository workflow.'));
	}
	for (const edit of plan.edits) {
		const details = node('details', '');
		details.append(
			node('summary', edit.path),
			node('h3', 'Current'),
			node('pre', edit.before),
			node('h3', 'Proposed'),
			node('pre', edit.after),
		);
		result.append(details);
	}
	result.append(node('p', 'Review these changes before preparing. You will merge the preparation PR yourself.'));
}
function selectedWorkflow(form: HTMLFormElement): Choice {
	const repository = repositoryChoices(form).find(r => String(r.id) === input(form, 'repositoryId').value);
	const choice = repository?.workflows[Number(input(form, 'choice').value)];
	if (!choice) throw new Error('Choose a repository and workflow.');
	return choice;
}
const wingetPlans = new WeakMap<HTMLFormElement, { digest: string }>();
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-action="winget-submit"]')) {
	const submit = form.querySelector<HTMLButtonElement>('button[value="submit"]');
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
			const rows = await api<{ id: number; tag: string; name: string }[]>('/api/winget/releases', {
				repositoryId: Number(input(form, 'repositoryId').value),
			});
			if (revision !== current) return;
			release.replaceChildren(new Option(rows.length ? 'Choose a release' : 'No eligible stable releases', ''));
			for (const row of rows) release.add(new Option(`${row.name} (${row.tag})`, String(row.id)));
			release.disabled = !rows.length;
		} catch (error) {
			if (revision === current) {
				release.replaceChildren(new Option('Unable to load releases', ''));
				showError(error);
			}
		}
	});
}
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-action="grant-save"]')) {
	const repositories = repositoryChoices(form);
	const repository = input(form, 'repositoryId'), choice = selectInput(form, 'choice');
	const updateScope = () => {
		const scope = form.querySelector<HTMLElement>('.workflow-scope');
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
		const help = form.querySelector<HTMLElement>('.delivery-help');
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
		const label = form.querySelector<HTMLElement>('[data-secret-name]');
		if (label) label.hidden = delivery === 'runtime';
		const secretName = input(form, 'secretName');
		secretName.disabled = delivery === 'runtime';
		secretName.required = delivery !== 'runtime';
		input(form, 'environment').required = delivery === 'environment';
		updateScope();
	});
}
for (
	const form of document.querySelectorAll<HTMLFormElement>(
		'form[data-action="release-prepare"],form[data-action="release-set"]',
	)
) {
	const prepare = form.querySelector<HTMLButtonElement>('button[value="prepare"]');
	form.addEventListener('input', () => {
		previews.delete(form);
		if (prepare) prepare.disabled = true;
		form.querySelector('.plan-result')?.replaceChildren();
	});
	form.addEventListener('change', () => {
		const mode = form.elements.namedItem('versionMode');
		if (!(mode instanceof HTMLSelectElement)) return;
		for (const element of form.querySelectorAll<HTMLElement>('[data-explicit]')) {
			element.hidden = mode.value !== 'explicit';
		}
		for (const element of form.querySelectorAll<HTMLElement>('[data-prerelease]')) {
			element.hidden = mode.value !== 'prerelease';
		}
		input(form, 'version').required = mode.value === 'explicit';
	});
}
const repositorySelection = document.querySelector<HTMLSelectElement>('.selection select[name="repository"]');
repositorySelection?.addEventListener('change', () => {
	location.assign(`/releases?repository=${encodeURIComponent(repositorySelection.value)}`);
});

for (const form of document.querySelectorAll<HTMLFormElement>('form[data-action]')) {
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
				await api('/api/winget/refresh', {});
				location.reload();
			} else if (action === 'winget-retry') {
				await api('/api/winget/submit', {
					...data,
					repositoryId: Number(data.repositoryId),
					releaseId: Number(data.releaseId),
				});
				location.reload();
			} else if (action === 'winget-submit') {
				const selection = { repositoryId: Number(data.repositoryId), releaseId: Number(data.releaseId) };
				if (clicked === 'preview') {
					const plan = await api<{ digest: string; sourceSha: string; files: Record<string, string> }>(
						'/api/winget/preview',
						selection,
					);
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
					const submit = form.querySelector<HTMLButtonElement>('button[value="submit"]');
					if (!submit) throw Error('Missing WinGet submit button');
					submit.disabled = submit.dataset.submitReady !== 'true';
					show('Review the manifests, then submit. Microsoft controls acceptance and merging.');
				} else {
					const plan = wingetPlans.get(form);
					if (!plan) throw Error('Preview the release before submitting.');
					await api('/api/winget/submit', { ...selection, digest: plan.digest });
					location.reload();
				}
			} else if (action === 'release-prepare' || action === 'release-set') {
				const common = { repositoryId: Number(data.repositoryId), stream: data.stream };
				const version = data.versionMode === 'explicit'
					? data.version
					: data.versionMode === 'prerelease'
					? { bump: 'prerelease', base: data.base, identifier: data.identifier }
					: { bump: data.versionMode };
				const groups = [...form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-group]')].filter(group => {
					const selected = group.querySelector('input[type=checkbox]');
					return selected instanceof HTMLInputElement && selected.checked;
				}).map(group => ({
					id: group.dataset.group,
					packages: array(JSON.parse(group.dataset.packages ?? '[]')).map(string),
					version: input(form, `version-${group.dataset.group}`).value,
				}));
				const operations = [...form.querySelectorAll<HTMLSelectElement>('select[data-operation]')].filter(select =>
					select.value
				).map(select => ({ id: select.dataset.operation, group: select.value }));
				if (action === 'release-set' && !groups.length) throw new Error('Select at least one package group.');
				if (action === 'release-set' && groups.some(group => !group.version)) {
					throw new Error('Enter a version for each selected group.');
				}
				const request = action === 'release-set' ? { ...common, plan: { groups, operations } } : { ...common, version };
				const identity = JSON.stringify(request);
				if (clicked === 'preview') {
					previews.delete(form);
					const plan = await api<Plan>(`/api/releases/${action === 'release-set' ? 'plan-set' : 'plan'}`, request);
					previews.set(form, { identity, plan });
					renderPlan(form, plan);
					const prepare = form.querySelector<HTMLButtonElement>('button[value="prepare"]');
					if (prepare) prepare.disabled = false;
					show('Review the proposed changes below, then prepare the release.');
				} else {
					const preview = previews.get(form);
					if (!preview || preview.identity !== identity) {
						throw new Error('Preview these choices again before preparing.');
					}
					const run = await api<{ id: string }>(
						`/api/releases/${action === 'release-set' ? 'prepare-set' : 'prepare'}`,
						{ ...request, sourceSha: preview.plan.sourceSha, planId: preview.plan.planId },
					);
					previews.delete(form);
					location.assign(`/runs#${encodeURIComponent(run.id)}`);
				}
			} else if (action === 'discover') {
				await api('/api/repositories/discover', { repository: data.repository });
				location.reload();
			} else if (action === 'approve' || action === 'recover') {
				await api(`/api/executions/${action === 'approve' ? 'approve' : 'recover'}`, data);
				location.reload();
			} else if (action === 'start' || action === 'start-set') {
				await api(
					action === 'start' ? '/api/executions/start' : '/api/releases/start-set',
					action === 'start'
						? { ...data, repositoryId: Number(data.repositoryId), requestId: crypto.randomUUID() }
						: data,
				);
				location.assign('/runs');
			} else if (action === 'secret-save') {
				const value = data.value;
				input(form, 'value').value = '';
				await api('/api/credentials/replace', { alias: data.alias, value, proof: await elevated() });
				location.reload();
			} else if (action === 'secret-reveal') {
				clearRevealed();
				const result = await api<{ value: string }>('/api/credentials/reveal', {
					alias: data.alias,
					proof: await elevated(),
				});
				const output = form.querySelector('output');
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
				show('Value revealed for 30 seconds. It also clears when you leave this page.');
			} else if (action === 'secret-sync') {
				const results = await api<{ id: string; state: string }[]>('/api/credentials/sync', {
					alias: data.alias,
					proof: await elevated(),
				});
				const failed = results.filter(r => r.state !== 'succeeded').length;
				show(
					failed
						? `${failed} destination(s) failed. Refresh to see which permissions need another copy.`
						: `Latest value copied to ${results.length} GitHub destination(s). Refresh to update their status.`,
				);
			} else if (action === 'grant-save') {
				const selected = selectedWorkflow(form);
				if (data.delivery === 'runtime' && !selected.credentials.includes(data.alias ?? '')) {
					throw new Error('Add this name to the stream’s credentials list before choosing runtime delivery.');
				}
				await api('/api/credentials/grant', {
					selection: {
						alias: data.alias,
						repositoryId: Number(data.repositoryId),
						stream: selected.stream,
						operation: selected.operation,
						delivery: data.delivery,
						environment: data.environment,
						secretName: data.secretName,
					},
					proof: await elevated(),
				});
				location.reload();
			} else if (action === 'grant-revoke') {
				if (
					form.dataset.delivery !== 'runtime'
					&& !confirm(
						'Remove this permission? The value already copied to GitHub will remain there. Delete that GitHub secret separately to remove it.',
					)
				) return;
				await api('/api/credentials/revoke', { ...data, proof: await elevated() });
				location.reload();
			} else if (action === 'key-enroll') {
				const proof = form.dataset.first === 'true' ? undefined : await elevated();
				const challenge = await api<{ id: string; options: PublicKeyCredentialCreationOptionsJSON }>(
					'/api/authenticators/options',
					{ register: true, label: data.label, proof },
				);
				show('Touch the security key you want to enroll.');
				const credential = await navigator.credentials.create({
					publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(challenge.options),
				});
				if (!(credential instanceof PublicKeyCredential)) throw new Error('Security key enrollment cancelled.');
				await api('/api/authenticators/verify', { id: challenge.id, response: credential.toJSON() });
				location.reload();
			} else if (action === 'key-remove') {
				await api('/api/authenticators/remove', { ...data, proof: await elevated() });
				location.reload();
			}
		} catch (error) {
			showError(error);
			document.querySelector<HTMLElement>('#feedback')?.focus();
		} finally {
			form.dataset.busy = 'false';
			button.disabled = (clicked === 'prepare' && !previews.has(form))
				|| (action === 'setup' && clicked === 'apply' && !canApplySetup(form));
		}
	});
}
