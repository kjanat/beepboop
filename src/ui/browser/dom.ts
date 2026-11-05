import { Cause, Data, Effect } from 'effect';

export class MissingElement extends Data.TaggedError('MissingElement')<{ readonly message: string }> {}

export function element<T extends Element>(
	parent: ParentNode,
	selector: string,
	type: { new(): T },
): Effect.Effect<T, MissingElement> {
	const found = find(parent, selector, type);
	return found
		? Effect.succeed(found)
		: Effect.fail(new MissingElement({ message: `Missing dashboard element: ${selector}` }));
}

export type FormField = HTMLInputElement | HTMLSelectElement;

export function field(form: HTMLFormElement, name: string): Effect.Effect<FormField, MissingElement> {
	const found = form.elements.namedItem(name);
	return found instanceof HTMLInputElement || found instanceof HTMLSelectElement
		? Effect.succeed(found)
		: Effect.fail(new MissingElement({ message: `Missing field: ${name}` }));
}

export function selectField(form: HTMLFormElement, name: string): Effect.Effect<HTMLSelectElement, MissingElement> {
	const found = form.elements.namedItem(name);
	return found instanceof HTMLSelectElement
		? Effect.succeed(found)
		: Effect.fail(new MissingElement({ message: `Missing field: ${name}` }));
}

export function listen<E>(
	target: EventTarget,
	type: string,
	handler: (event: Event) => Effect.Effect<void, E>,
	form?: HTMLFormElement,
): void {
	target.addEventListener(type, event => Effect.runFork(report(handler(event), form)));
}

function pageFeedback(): HTMLElement {
	const existing = find(document, '#feedback', HTMLOutputElement);
	if (existing) return existing;
	const created = document.createElement('output');
	created.id = 'feedback';
	document.body.append(created);
	return created;
}

export function find<T extends Element>(parent: ParentNode, selector: string, type: { new(): T }): T | undefined {
	const found = parent.querySelector(selector);
	return found instanceof type ? found : undefined;
}

export function findAll<T extends Element>(parent: ParentNode, selector: string, type: { new(): T }): T[] {
	return [...parent.querySelectorAll(selector)].flatMap(found => found instanceof type ? [found] : []);
}

export class FieldError extends Data.TaggedError('FieldError')<{
	readonly message: string;
	readonly fields: readonly Element[];
}> {}

export class Refused extends Data.TaggedError('Refused')<{ readonly message: string }> {}

export function refuse(message: string): Effect.Effect<never, Refused> {
	return Effect.fail(new Refused({ message }));
}

export function report<E>(program: Effect.Effect<void, E>, form?: HTMLFormElement): Effect.Effect<void> {
	return program.pipe(Effect.catchCause(cause => Effect.sync(() => showError(Cause.squash(cause), form))));
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
	const feedback = form ? feedbackFor(form) : pageFeedback();
	feedback.hidden = false;
	feedback.dataset.tone = tone;
	feedback.textContent = message;
}

export function showError(error: unknown, form?: HTMLFormElement): void {
	const message = error instanceof Error ? error.message : String(error);
	const feedback = form ? feedbackFor(form) : pageFeedback();
	if (form && error instanceof FieldError) {
		for (const field of error.fields) describe(field, feedback.id, true);
	}
	show(message, form, 'error');
	if (form) feedback.focus();
}
