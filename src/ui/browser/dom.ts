import { z } from 'zod';

function required<T extends Element>(selector: string, type: { new(): T }): T {
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

export class FieldError extends Error {
	constructor(message: string, readonly fields: readonly Element[]) {
		super(message);
	}
}

const feedbacks = new WeakMap<HTMLFormElement, HTMLElement>();
let feedbackCount = 0;

export function feedbackFor(form: HTMLFormElement): HTMLElement {
	const feedback = feedbacks.get(form) ?? document.createElement('p');
	if (!feedbacks.has(form)) {
		feedback.className = 'form-feedback';
		feedback.id = `form-feedback-${++feedbackCount}`;
		feedback.setAttribute('role', 'status');
		feedback.tabIndex = -1;
		feedback.hidden = true;
		feedbacks.set(form, feedback);
	}
	if (feedback.parentElement !== form) form.append(feedback);
	return feedback;
}

function describe(field: Element, id: string, invalid: boolean): void {
	const ids = new Set((field.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
	if (invalid) ids.add(id);
	else ids.delete(id);
	if (ids.size) field.setAttribute('aria-describedby', [...ids].join(' '));
	else field.removeAttribute('aria-describedby');
	if (invalid) field.setAttribute('aria-invalid', 'true');
	else field.removeAttribute('aria-invalid');
}

export function watchValidity(form: HTMLFormElement): void {
	feedbackFor(form);
	form.addEventListener('invalid', event => {
		const field = event.target;
		if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
		describe(field, feedbackFor(form).id, true);
		show(field.validationMessage, form, 'error');
	}, true);
	const clear = (event: Event) => {
		if (event.target instanceof Element && event.target.getAttribute('aria-invalid') === 'true') {
			describe(event.target, feedbackFor(form).id, false);
		}
	};
	form.addEventListener('input', clear);
	form.addEventListener('change', clear);
}

export function show(message: string, form?: HTMLFormElement, tone: 'info' | 'error' = 'info'): void {
	const feedback = form ? feedbackFor(form) : required('#feedback', HTMLOutputElement);
	feedback.hidden = false;
	feedback.dataset.tone = tone;
	feedback.textContent = message;
}

export function showError(error: unknown, form?: HTMLFormElement): void {
	const message = error instanceof Error ? error.message : String(error);
	const feedback = form ? feedbackFor(form) : required('#feedback', HTMLOutputElement);
	if (form && error instanceof FieldError) {
		for (const field of error.fields) describe(field, feedback.id, true);
	}
	show(message, form, 'error');
	if (form) feedback.focus();
}

const failure = z.object({ error: z.string().optional() }).catch({});

export async function api<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
	const send = () =>
		fetch(
			path,
			body === undefined ? {} : {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			},
		);
	let response = await send();
	if (response.status === 401 && (await fetch('/auth/renew', { method: 'POST' })).ok) response = await send();
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
