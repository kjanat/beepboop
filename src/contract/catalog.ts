export const managerNames = [
	'pre-commit',
	'cargo',
	'npm',
	'jsr',
	'github-release',
	'oci',
	'goreleaser',
	'go',
	'vscode',
	'manifest',
	'workflow',
] as const;
export type ManagerName = (typeof managerNames)[number];

export const managerDestinationIds = [
	'npm',
	'crates-io',
	'jsr',
	'go-proxy',
	'github-release',
	'oci',
	'vscode-marketplace',
	'open-vsx',
] as const;
export const channelDestinationIds = ['homebrew', 'scoop', 'aur'] as const;
export const registryDestinationIds = [...managerDestinationIds, ...channelDestinationIds] as const;
export const destinationIds = [...registryDestinationIds, 'winget'] as const;
export type ManagerDestinationId = (typeof managerDestinationIds)[number];
export type RegistryDestinationId = (typeof registryDestinationIds)[number];
export type DestinationId = (typeof destinationIds)[number];

export const destinationLabels = {
	npm: 'npm',
	'crates-io': 'crates.io',
	jsr: 'JSR',
	'go-proxy': 'Go module proxy',
	'github-release': 'GitHub release',
	oci: 'Container registry',
	'vscode-marketplace': 'Visual Studio Marketplace',
	'open-vsx': 'Open VSX',
	homebrew: 'Homebrew',
	scoop: 'Scoop',
	aur: 'AUR',
	winget: 'WinGet',
} as const satisfies Record<DestinationId, string>;

export interface ManagerDestinations {
	primary: ManagerDestinationId;
	secondary: readonly ManagerDestinationId[];
}
export interface ManagerSpec {
	purlType: string | undefined;
	lockfiles: readonly string[];
	destinations: ManagerDestinations | undefined;
	versionPolicy: 'equals-execution' | 'free';
}
export const managerCatalog = {
	'pre-commit': { lockfiles: [], purlType: undefined, destinations: undefined, versionPolicy: 'free' },
	cargo: {
		lockfiles: ['Cargo.lock'],
		purlType: 'cargo',
		destinations: { primary: 'crates-io', secondary: [] },
		versionPolicy: 'equals-execution',
	},
	npm: {
		lockfiles: ['package-lock.json', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock'],
		purlType: 'npm',
		destinations: { primary: 'npm', secondary: [] },
		versionPolicy: 'equals-execution',
	},
	jsr: {
		lockfiles: [],
		purlType: 'jsr',
		destinations: { primary: 'jsr', secondary: [] },
		versionPolicy: 'equals-execution',
	},
	'github-release': {
		lockfiles: [],
		purlType: 'github',
		destinations: { primary: 'github-release', secondary: [] },
		versionPolicy: 'free',
	},
	oci: { lockfiles: [], purlType: undefined, destinations: { primary: 'oci', secondary: [] }, versionPolicy: 'free' },
	goreleaser: {
		lockfiles: [],
		purlType: 'github',
		destinations: { primary: 'github-release', secondary: [] },
		versionPolicy: 'free',
	},
	go: {
		lockfiles: [],
		purlType: 'golang',
		destinations: { primary: 'go-proxy', secondary: [] },
		versionPolicy: 'free',
	},
	vscode: {
		lockfiles: [],
		purlType: 'vscode-extension',
		destinations: { primary: 'vscode-marketplace', secondary: ['open-vsx'] },
		versionPolicy: 'equals-execution',
	},
	manifest: { lockfiles: [], purlType: undefined, destinations: undefined, versionPolicy: 'free' },
	workflow: { lockfiles: [], purlType: undefined, destinations: undefined, versionPolicy: 'free' },
} as const satisfies Record<ManagerName, ManagerSpec>;

const lockfileNames = new Set<string>(managerNames.flatMap(name => managerSpec(name).lockfiles));
export function isLockfile(path: string): boolean {
	return lockfileNames.has(path.slice(path.lastIndexOf('/') + 1));
}
export function managerSpec(name: ManagerName): ManagerSpec {
	return managerCatalog[name];
}
export function destinationsOf(manager: ManagerName): ManagerDestinationId[] {
	const mapped = managerSpec(manager).destinations;
	return mapped ? [mapped.primary, ...mapped.secondary] : [];
}
export const identifiedManagers = managerNames.filter(name => managerSpec(name).purlType !== undefined);
