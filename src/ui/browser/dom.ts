export function element<T extends Element>(selector: string, type: { new(): T }): T {
	const found = document.querySelector(selector);
	if (!(found instanceof type)) throw new Error(`Missing dashboard element: ${selector}`);
	return found;
}

export function show(message: unknown): void {
	const feedback = element('#feedback', HTMLOutputElement);
	feedback.hidden = false;
	feedback.textContent = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
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
	if (!response.ok) {
		const data: { error?: string } = await response.json();
		throw new Error(data.error || 'Request failed');
	}
	return response.json();
}

export type Fields = Record<string, string>;

export function submit(id: string, handler: (data: Fields, action: string) => Promise<void>): void {
	const form = element(`#${id}`, HTMLFormElement);
	form.addEventListener('submit', async event => {
		event.preventDefault();
		const button = event.submitter;
		if (!(button instanceof HTMLButtonElement)) return;
		button.disabled = true;
		try {
			const fields: Fields = {};
			for (const [key, value] of new FormData(form)) {
				if (typeof value === 'string' && value !== '') fields[key] = value;
			}
			await handler(fields, button.value);
		} catch (error) {
			showError(error);
		} finally {
			button.disabled = false;
		}
	});
}

export function displayJson(selector: string, value: unknown): void {
	element(selector, HTMLElement).textContent = JSON.stringify(value, null, 2);
}

export function refresh(button: string, output: string, path: string): void {
	element(button, HTMLButtonElement).addEventListener('click', async () => {
		try {
			displayJson(output, await api(path));
		} catch (error) {
			showError(error);
		}
	});
}
