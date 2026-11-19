export function listed(items: readonly string[]): string {
	const head = items.slice(0, -1), last = items.at(-1) ?? '';
	return head.length ? `${head.join(', ')} and ${last}` : last;
}
