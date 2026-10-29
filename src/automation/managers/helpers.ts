import { parseDocument } from 'yaml';
import { record } from '#model';
export function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? record(value) : {};
}
function glob(pattern: string, path: string): boolean {
	const expression = pattern
		.split('**')
		.map((part) =>
			part
				.split('*')
				.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
				.join('[^/]*')
		)
		.join('.*');
	return new RegExp(`^${expression}$`).test(path);
}
export function directory(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
export function inWorkspace(path: string, members: string[], exclusions: string[]): boolean {
	return (
		members.some((pattern) => glob(pattern.replace(/\/$/, ''), path))
		&& !exclusions.some((pattern) => glob(pattern, path))
	);
}
export function yaml(source: string): Record<string, unknown> {
	const doc = parseDocument(source, { uniqueKeys: true });
	if (doc.errors.length) throw new Error('Invalid YAML');
	return object(doc.toJS({ maxAliasCount: 100 }));
}
