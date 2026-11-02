import { api, displayJson, element, refresh, show, submit } from './dom.ts';

interface AuthenticationChallenge {
	id: string;
	options: PublicKeyCredentialRequestOptionsJSON;
}

interface RegistrationChallenge {
	id: string;
	options: PublicKeyCredentialCreationOptionsJSON;
}

async function elevated(): Promise<string> {
	const challenge = await api<AuthenticationChallenge>('/api/authenticators/options', { register: false });
	const credential = await navigator.credentials.get({
		publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(challenge.options),
	});
	if (!(credential instanceof PublicKeyCredential)) throw new Error('Security key authentication cancelled');
	const result = await api<{ proof: string }>('/api/authenticators/verify', {
		id: challenge.id,
		response: credential.toJSON(),
	});
	return result.proof;
}

export function setupCredentials(): void {
	submit('enroll', async data => {
		const proof = data.bootstrap ? undefined : await elevated();
		const challenge = await api<RegistrationChallenge>('/api/authenticators/options', {
			register: true,
			bootstrap: data.bootstrap,
			label: data.label,
			proof,
		});
		const credential = await navigator.credentials.create({
			publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(challenge.options),
		});
		if (!(credential instanceof PublicKeyCredential)) throw new Error('Security key enrollment cancelled');
		await api('/api/authenticators/verify', { id: challenge.id, response: credential.toJSON() });
		element('#enroll', HTMLFormElement).reset();
		show('Security key enrolled.');
	});

	submit('secret', async (data, action) => {
		const result = await api<{ value: string }>(`/api/credentials/${action}`, {
			...data,
			proof: await elevated(),
		});
		element('#secret input[name=value]', HTMLInputElement).value = '';
		if (action === 'reveal') {
			const output = element('#revealed', HTMLOutputElement);
			output.textContent = result.value;
			setTimeout(() => {
				output.textContent = '';
			}, 30_000);
			show('Credential revealed for 30 seconds.');
		} else {
			displayJson('#credential-result', result);
			show(action === 'sync' ? 'Credential synchronized.' : 'Credential replaced.');
		}
	});

	submit('grant', async data => {
		const grant = { ...data, repositoryId: Number(data.repositoryId) };
		displayJson('#credential-result', await api('/api/credentials/grant', { grant, proof: await elevated() }));
		show('Grant saved.');
	});
	submit('revoke', async data => {
		displayJson('#credential-result', await api('/api/credentials/revoke', { ...data, proof: await elevated() }));
		show('Grant revoked.');
	});
	refresh('#load-credentials', '#credential-list', '/api/credentials');
}
