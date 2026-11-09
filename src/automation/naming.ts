export function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function unusedName(first: string, next: (index: number) => string, taken: (name: string) => boolean): string {
	let name = first;
	for (let index = 2; taken(name); index++) name = next(index);
	return name;
}
