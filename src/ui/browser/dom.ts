import { z } from 'zod';

export function element<T extends Element>(selector: string, type: { new(): T }): T {
	const found = document.querySelector(selector);
	if (!(found instanceof type)) throw new Error(`Missing dashboard element: ${selector}`);
	return found;
}

export function find<T extends Element>(parent: ParentNode, selector: string, type: { new(): T }): T | undefined {
	const found = parent.querySelector(selector);
	return found instanceof type ? found : undefined;
}

export function findAll<T extends Element>(parent: ParentNode, selector: string, type: { new(): T }): T[] {
	return [...parent.querySelectorAll(selector)].flatMap(found => found instanceof type ? [found] : []);
}

export function show(message: string): void {
	const feedback = element('#feedback', HTMLOutputElement);
	feedback.hidden = false;
	feedback.textContent = message;
}

export function showError(error: unknown): void {
	show(error instanceof Error ? error.message : String(error));
}

const failure = z.object({ error: z.string().optional() }).catch({});

export async function api<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
	const response = await fetch(
		path,
		body === undefined ? {} : {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		},
	);
	if (response.status === 401) {
		location.assign(`/auth/login?return=${encodeURIComponent(`${location.pathname}${location.search}`)}`);
		throw new Error('Session expired. Signing in again.');
	}
	if (!response.ok) {
		const data = failure.parse(await response.json());
		throw new Error(data.error || 'Request failed');
	}
	return schema.parse(await response.json());
}
