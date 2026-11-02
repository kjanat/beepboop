import { setupCredentials } from './credentials.ts';
import { api, displayJson, refresh, show, showError, submit } from './dom.ts';
import { setupReleases } from './releases.ts';

const tabs = document.querySelectorAll<HTMLButtonElement>('[data-tab]');
for (const button of tabs) {
	button.addEventListener('click', () => {
		for (const section of document.querySelectorAll<HTMLElement>('body > section')) {
			section.hidden = section.id !== button.dataset.tab;
		}
		for (const tab of tabs) tab.setAttribute('aria-selected', String(tab === button));
	});
}

submit('discover', async (data, action) => {
	if (action === 'onboard') {
		const { url } = await api<{ url: string }>('/api/repositories/onboard', data);
		show(`Onboarding PR: ${url}`);
	} else {
		await api('/api/repositories/discover', data);
		location.reload();
	}
});
setupReleases();
setupCredentials();
refresh('#load-activity', '#activity-list', '/api/activity');

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
