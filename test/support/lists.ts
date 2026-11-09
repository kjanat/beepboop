export function one<T>(items: T[], label: string): T {
	const [item] = items;
	if (items.length !== 1 || item === undefined) throw new Error(`Expected one ${label}, found ${items.length}`);
	return item;
}
