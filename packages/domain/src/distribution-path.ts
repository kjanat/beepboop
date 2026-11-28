export function isDistributionPath(path: string): boolean {
	const lower = path.toLowerCase();
	return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0')
		&& !path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
		&& lower !== '.github' && lower !== '.github/workflows' && !lower.startsWith('.github/workflows/');
}
