import { api, displayJson, element, type Fields, show, submit } from './dom.ts';

interface Preview {
	identity: string;
	sourceSha: string;
	planId: string;
}

interface Preparation {
	id: string;
}

function repository(data: Fields) {
	return { repositoryId: Number(data.repositoryId), stream: data.stream };
}

function reviewed(preview: Preview | undefined, identity: string, message: string) {
	if (!preview || preview.identity !== identity) throw new Error(message);
	return { sourceSha: preview.sourceSha, planId: preview.planId };
}

export function setupReleases(): void {
	let singlePreview: Preview | undefined;
	submit('prepare', async (data, action) => {
		const version = data.versionMode === 'explicit'
			? data.version
			: data.versionMode === 'prerelease'
			? { bump: 'prerelease', base: data.base, identifier: data.identifier }
			: { bump: data.versionMode };
		const request = { ...repository(data), version };
		const identity = JSON.stringify(request);
		if (action === 'plan') {
			singlePreview = undefined;
			const result = await api<Preview>('/api/releases/plan', request);
			singlePreview = { identity, sourceSha: result.sourceSha, planId: result.planId };
			displayJson('#plan', result);
			show('Release plan ready.');
		} else {
			const proof = reviewed(singlePreview, identity, 'Preview this version before preparing.');
			const result = await api('/api/releases/prepare', { ...request, ...proof });
			singlePreview = undefined;
			displayJson('#plan', result);
			show('Release preparation started.');
		}
	});

	let setPreview: Preview | undefined;
	submit('release-set', async (data, action) => {
		const plan: unknown = JSON.parse(data.plan ?? '');
		const request = { ...repository(data), plan };
		const identity = JSON.stringify(request);
		if (action === 'plan-set') {
			setPreview = undefined;
			const result = await api<Preview>('/api/releases/plan-set', request);
			setPreview = { identity, sourceSha: result.sourceSha, planId: result.planId };
			displayJson('#set-plan', result);
			show('Release set ready for review.');
		} else {
			const proof = reviewed(setPreview, identity, 'Preview these groups and operations before preparing.');
			const result = await api<Preparation>('/api/releases/prepare-set', { ...request, ...proof });
			element('#start-set input[name=preparationId]', HTMLInputElement).value = result.id;
			setPreview = undefined;
			displayJson('#set-plan', result);
			show('Preparation queued. Start the set after its PR has been merged.');
		}
	});

	submit('start-set', async data => {
		const result = await api('/api/releases/start-set', data);
		displayJson('#set-executions', result);
		show('Release set started. Promotion gates still require approval.');
	});
	submit('start', async data => {
		show(
			await api('/api/executions/start', {
				...data,
				...repository(data),
				requestId: crypto.randomUUID(),
			}),
		);
	});
}
