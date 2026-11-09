import { Result } from 'effect';
import { parseDocument } from 'yaml';
import { escapeRegExp } from '@/automation/release-graph/shell';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { toDomainError } from '@/failure';
import { record } from '@/model';
export function object(value: unknown): Record<string, unknown> {
	return Result.getOrElse(record(value), () => ({}));
}
export function glob(pattern: string, path: string): boolean {
	const expression = pattern.split('**').map(part => part.split('*').map(escapeRegExp).join('[^/]*')).join('.*');
	return new RegExp(`^${expression}$`).test(path);
}
export function inWorkspace(path: string, members: string[], exclusions: string[]): boolean {
	return (
		members.some((pattern) => glob(pattern.replace(/\/$/, ''), path))
		&& !exclusions.some((pattern) => glob(pattern, path))
	);
}
export function yaml(source: string): Result.Result<Record<string, unknown>, DomainError> {
	const doc = parseDocument(source, { uniqueKeys: true });
	if (doc.errors.length) return Result.fail(precondition('Invalid YAML'));
	return Result.try({ try: () => object(doc.toJS({ maxAliasCount: 100 })), catch: toDomainError });
}
