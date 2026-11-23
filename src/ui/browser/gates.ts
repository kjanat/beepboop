import { Effect } from 'effect';
import { routes } from '@/contract/routes';
import type { GateView, StreamGates, Tone } from '@/contract/views';
import { gateLabel } from '@/domain/release-gates.ts';
import { api } from '@/ui/browser/api';
import { element, listen, node, report } from '@/ui/browser/dom.ts';

const tones = { passed: 'ok', waiting: 'waiting', failed: 'error', absent: 'neutral' } as const satisfies Record<
	GateView['state'],
	Tone
>;

function badge(view: GateView): HTMLSpanElement {
	const shown = node('span', view.skipped ? 'off' : view.fact);
	shown.className = 'badge';
	shown.dataset.tone = view.skipped ? 'neutral' : tones[view.state];
	const facts = [
		...(view.skipped ? [`Switched off by ${view.skipped.actor} on ${new Date(view.skipped.at).toISOString()}`] : []),
		...(view.skipped ? [`Gate: ${view.fact}`] : []),
		...(view.detail ? [view.detail] : []),
	];
	if (facts.length) shown.title = facts.join('. ');
	return shown;
}

export function gates(details: HTMLDetailsElement): Effect.Effect<void, unknown> {
	return Effect.gen(function*() {
		const form = yield* element(details, 'form', HTMLFormElement);
		const body = yield* element(form, 'tbody', HTMLTableSectionElement);
		const table = yield* element(form, 'table', HTMLTableElement);
		const commit = yield* element(form, '.gate-commit', HTMLElement);
		const repositoryId = Number(details.dataset.repositoryId);
		const stream = details.dataset.stream ?? '';
		const render = (view: StreamGates) => {
			commit.textContent = `Commit ${view.commit.slice(0, 7)}${view.version ? ` · ${view.version}` : ''}`;
			body.replaceChildren(...view.gates.map(entry => {
				const row = node('tr');
				const toggle = node('button', entry.skipped ? 'Switch on' : 'Switch off');
				toggle.type = 'button';
				toggle.setAttribute('aria-label', `${toggle.textContent} ${gateLabel(entry.gate)}`);
				listen(toggle, 'click', () =>
					Effect.sync(() => {
						toggle.disabled = true;
					}).pipe(
						Effect.andThen(api(routes.repositoriesGateSkip, {
							repositoryId,
							stream,
							gate: entry.gate,
							skip: entry.skipped === undefined,
						})),
						Effect.map(render),
						Effect.ensuring(Effect.sync(() => {
							toggle.disabled = false;
						})),
					), form);
				const state = node('td');
				state.append(badge(entry));
				const action = node('td');
				action.append(toggle);
				row.append(node('td', gateLabel(entry.gate)), state, action);
				return row;
			}));
			table.hidden = false;
		};
		let loaded = false;
		const load = Effect.suspend(() => {
			if (!details.open || loaded) return Effect.void;
			loaded = true;
			return api(routes.repositoriesGates, { repositoryId, stream }).pipe(
				Effect.map(render),
				Effect.tapError(() =>
					Effect.sync(() => {
						loaded = false;
					})
				),
			);
		});
		listen(details, 'toggle', () => load, form);
		yield* report(load, form);
	});
}
