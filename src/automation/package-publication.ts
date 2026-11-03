export type ExclusionReason =
	| 'private'
	| 'vscode-extension'
	| 'publish-disabled'
	| 'other-registry'
	| 'unlocated-module'
	| 'unrecorded';
export type PackagePublication = { kind: 'registry' } | { kind: 'excluded'; reason: ExclusionReason };
export const registry: PackagePublication = { kind: 'registry' };
export function excluded(reason: ExclusionReason): PackagePublication {
	return { kind: 'excluded', reason };
}
export function publishable(pkg: { publication: PackagePublication }): boolean {
	return pkg.publication.kind === 'registry';
}
const reasons: Record<ExclusionReason, string> = {
	private: 'private',
	'vscode-extension': 'VS Code extension',
	'publish-disabled': 'publishing disabled',
	'other-registry': 'other registry',
	'unlocated-module': 'module path outside this repository',
	unrecorded: 'reason unknown until the next inspection',
};
export function exclusionLabel(publication: PackagePublication): string | undefined {
	return publication.kind === 'excluded' ? reasons[publication.reason] : undefined;
}
