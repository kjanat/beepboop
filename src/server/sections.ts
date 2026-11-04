export const sections = [
	'overview',
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

export interface SectionPage {
	path: string;
	nav: string;
	title: string;
	description: string;
}

export const sectionPages = {
	overview: {
		path: '/',
		nav: 'Overview',
		title: 'What needs to ship?',
		description: 'Follow releases from preparation to every required publication.',
	},
	repositories: {
		path: '/repositories',
		nav: 'Repositories',
		title: 'Repositories',
		description: 'Connect a project and review how its packages reach their users.',
	},
	packages: {
		path: '/packages',
		nav: 'Packages',
		title: 'Packages',
		description: 'Watch the packages you publish and the ones your repositories depend on.',
	},
	notifications: {
		path: '/notifications',
		nav: 'Notifications',
		title: 'Notifications',
		description: 'Choose where package releases are announced.',
	},
	releases: {
		path: '/releases',
		nav: 'Prepare a release',
		title: 'Prepare a release',
		description: 'Choose what to release, review the changes, then open a preparation pull request.',
	},
	runs: {
		path: '/runs',
		nav: 'Release runs',
		title: 'Release runs',
		description: 'See what shipped, what is waiting, and what needs your attention.',
	},
	winget: {
		path: '/winget',
		nav: 'WinGet',
		title: 'WinGet submissions',
		description: 'Submit published releases to microsoft/winget-pkgs and follow their review.',
	},
	secrets: {
		path: '/secrets',
		nav: 'Secrets',
		title: 'Secrets',
		description: 'Store publishing credentials and choose which workflows may use them.',
	},
	activity: {
		path: '/activity',
		nav: 'Activity',
		title: 'Activity',
		description: 'The history of release operations, access changes, and workflow requests.',
	},
	security: {
		path: '/security',
		nav: 'Security keys',
		title: 'Security keys',
		description: 'Use a physical security key to approve access to publishing credentials.',
	},
} as const satisfies Record<Section, SectionPage>;

export function sectionAt(path: string): Section | undefined {
	const normalized = path.replace(/\/$/, '') || '/';
	return sections.find(entry => sectionPages[entry].path === normalized);
}

export const dashboardPaths: ReadonlySet<string> = new Set(sections.map(entry => sectionPages[entry].path));
