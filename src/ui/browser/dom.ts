export function element<T extends Element>(selector: string, type: { new(): T }): T {
	const found = document.querySelector(selector);
	if (!(found instanceof type)) throw new Error(`Missing dashboard element: ${selector}`);
	return found;
}

export function show(message: string): void {
	const feedback = element('#feedback', HTMLOutputElement);
	feedback.hidden = false;
	feedback.textContent = message;
}

export function showError(error: unknown): void {
	show(error instanceof Error ? error.message : String(error));
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
	const response = await fetch(
		path,
		body === undefined ? {} : {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		},
	);
	if (response.status === 401) {
		location.assign('/auth/login');
		throw new Error('Session expired. Signing in again.');
	}
	if (!response.ok) {
		const data: { error?: string } = await response.json();
		throw new Error(data.error || 'Request failed');
	}
	return response.json();
}
