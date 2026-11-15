import type { Colors, Out } from '@kjanat/dreamcli';
import { osc8 } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { destinationLabels, destinationsOf, isManagerName } from '@/contract/catalog';

export type State = 'published' | 'waiting' | 'failed' | 'skipped';

export interface Look {
	state(state: State, text: string): string;
	mark(state: State): string;
	pkg(name: string): string;
	version(version: string): string;
	sha(sha: string): string;
	id(id: string): string;
	link(url: string, label?: string): string;
	heading(text: string): string;
	note(text: string): string;
}

const marks: Record<State, string> = { published: '✔', waiting: '◷', failed: '✖', skipped: '○' };

export function look(colors: Colors, hyperlinks: boolean): Look {
	const tint: Record<State, (text: string) => string> = {
		published: colors.green,
		waiting: colors.yellow,
		failed: colors.red,
		skipped: colors.gray,
	};
	const linked = hyperlinks && colors.isColorSupported;
	return {
		state: (state, text) => tint[state](text),
		mark: state => tint[state](marks[state]),
		pkg: name => colors.bold(colors.cyan(name)),
		version: version => colors.magenta(version),
		sha: sha => colors.blue(short(sha)),
		id: id => colors.blue(short(id)),
		link: (url, label = url) =>
			colors.underline(colors.blue(linked ? osc8(url, label) : label === url ? url : `${label} (${url})`)),
		heading: text => colors.bold(text),
		note: text => colors.dim(text),
	};
}

export function short(value: string): string {
	return /^[0-9a-f]{13,}$/.test(value) ? value.slice(0, 12) : value;
}

export function lookOf(out: Out): Look {
	return look(out.color, out.isHyperlinkSupported);
}

export function step<A, E>(
	out: Out,
	text: string,
	work: Effect.Effect<A, E>,
	succeed: (value: A) => string,
): Effect.Effect<A, E> {
	return Effect.suspend(() => {
		const spinner = out.spinner(text);
		return work.pipe(
			Effect.tap(value => Effect.sync(() => spinner.succeed(succeed(value)))),
			Effect.tapError(() => Effect.sync(() => spinner.fail(text))),
		);
	});
}

export function registryOf(manager: string): string {
	if (!isManagerName(manager)) return manager;
	const [primary] = destinationsOf(manager);
	return primary ? destinationLabels[primary] : manager;
}

export function table(out: Out, rows: readonly Record<string, string>[]): void {
	if (rows.length) out.table(rows);
}
