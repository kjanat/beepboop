import { sha256HexPattern } from '@/kernel/schema/ids.ts';

export function validDistributionPath(path: string): boolean {
	return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0')
		&& !path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
		&& path.toLowerCase() !== '.github' && path.toLowerCase() !== '.github/workflows'
		&& !path.toLowerCase().startsWith('.github/workflows/');
}

export function distributionPathProblem(paths: readonly string[]): string | undefined {
	if (!paths.length || new Set(paths).size !== paths.length || paths.some(path => !validDistributionPath(path))) {
		return 'Distribution paths must be unique exact file paths outside Git and workflows';
	}
	if (paths.some(path => paths.some(other => other !== path && path.startsWith(`${other}/`)))) {
		return 'Distribution paths must name files rather than overlapping directories';
	}
}

export function validDistributionArtifact(id: number, digest: string): boolean {
	return Number.isSafeInteger(id) && id > 0 && sha256HexPattern.test(digest);
}
