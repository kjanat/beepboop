import { setupCredentials } from './credentials.ts';
import { api, displayJson, element, selectTab, show, showError, submit } from './dom.ts';
import { setupReleases } from './releases.ts';

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
const panels = [...document.querySelectorAll<HTMLElement>('body > section')];
for (const button of tabs) {
	button.addEventListener('click', () => {
		const name = button.dataset.tab ?? '';
		if (selectTab(name, tabs, panels)) history.replaceState(null, '', `#${name}`);
	});
}
selectTab(location.hash.slice(1), tabs, panels);

const onboardButtons = () =>
	document.querySelectorAll<HTMLButtonElement>('[data-onboard], #discover button[value="onboard"]');
async function onboard(repository: { repository: string; repositoryId?: number }): Promise<void> {
	for (const button of onboardButtons()) button.disabled = true;
	show(`Opening the onboarding PR for ${repository.repository}…`);
	try {
		const { url } = await api<{ url: string }>('/api/repositories/onboard', repository);
		const slot = document.querySelector<HTMLElement>(`[data-onboarding="${repository.repositoryId}"]`);
		if (slot) {
			const link = document.createElement('a');
			link.href = url;
			link.textContent = url;
			slot.replaceChildren('Onboarding PR: ', link);
		}
		show(`Onboarding PR: ${url}`);
	} finally {
		for (const button of onboardButtons()) button.disabled = false;
	}
}
submit('discover', async (data, action) => {
	if (action === 'onboard') {
		await onboard({ repository: data.repository ?? '' });
	} else {
		await api('/api/repositories/discover', data);
		location.reload();
	}
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-onboard]')) {
	button.addEventListener('click', async () => {
		const { onboard: repository, repositoryId } = button.dataset;
		if (!repository) return;
		try {
			await onboard({ repository, repositoryId: Number(repositoryId) });
		} catch (error) {
			showError(error);
		}
	});
}
setupReleases();
setupCredentials();
element('#load-activity', HTMLButtonElement).addEventListener('click', async () => {
	try {
		element('#activity-list', HTMLTableSectionElement).innerHTML = (await api<{ html: string }>('/api/activity')).html;
	} catch (error) {
		showError(error);
	}
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-approve],[data-retry],[data-reconcile]')) {
	button.addEventListener('click', async () => {
		button.disabled = true;
		try {
			const { approve, sha, retry, reconcile } = button.dataset;
			const result = approve
				? await api('/api/executions/approve', { id: approve, sourceSha: sha })
				: await api('/api/executions/recover', { id: retry || reconcile, action: retry ? 'retry' : 'reconcile' });
			displayJson('#execution-result', result);
			show(approve ? 'Promotion approved.' : retry ? 'Retry requested.' : 'Reconciliation requested.');
		} catch (error) {
			showError(error);
		} finally {
			button.disabled = false;
		}
	});
}
