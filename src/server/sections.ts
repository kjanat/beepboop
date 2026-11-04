export const sections = [
	'repositories',
	'packages',
	'notifications',
	'releases',
	'runs',
	'winget',
	'secrets',
	'activity',
	'security',
] as const;
export type Section = (typeof sections)[number];

export function section(value: string): Section | undefined {
	return sections.find(entry => entry === value);
}

export const dashboardPaths: ReadonlySet<string> = new Set(['/', ...sections.map(entry => `/${entry}`)]);
