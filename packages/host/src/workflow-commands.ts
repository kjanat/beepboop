import { Effect } from 'effect';

export function mask(value: string): Effect.Effect<void> {
	return Effect.sync(() =>
		console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`)
	);
}
