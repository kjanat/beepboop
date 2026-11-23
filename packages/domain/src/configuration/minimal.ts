import { Predicate } from 'effect';

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function unstated(value: Record<string, unknown>, inherited: unknown, stated: unknown): Record<string, unknown> {
	if (!Predicate.isObject(inherited)) return value;
	const kept: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(value)) {
		const written = Predicate.isObject(stated) && Object.hasOwn(stated, key);
		if (written || !Object.hasOwn(inherited, key)) {
			kept[key] = field;
			continue;
		}
		const base = inherited[key];
		if (same(field, base)) continue;
		if (Predicate.isObject(field) && !Array.isArray(field) && Predicate.isObject(base)) {
			const rest = unstated({ ...field }, base, undefined);
			if (Object.keys(rest).length) kept[key] = rest;
			continue;
		}
		kept[key] = field;
	}
	return kept;
}

export function withoutInherited(written: unknown, preset: unknown, stored: unknown): unknown {
	if (!Predicate.isObject(written) || !Predicate.isObject(written.streams) || !Predicate.isObject(preset)) {
		return written;
	}
	const inherited = preset.streams;
	const storedStreams = Predicate.isObject(stored) ? stored.streams : undefined;
	return {
		...written,
		streams: Object.fromEntries(
			Object.entries(written.streams).map(([name, stream]) => [
				name,
				Predicate.isObject(stream) && Predicate.isObject(inherited)
					? unstated(
						{ ...stream },
						inherited[name],
						Predicate.isObject(storedStreams) ? storedStreams[name] : undefined,
					)
					: stream,
			]),
		),
	};
}
