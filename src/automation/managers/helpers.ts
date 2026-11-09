import { Result } from 'effect';
import type { Document } from 'yaml';
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
export function jsonIndent(source: string): string {
	return source.match(/\n([\t ]+)"/)?.[1] ?? '  ';
}
export function editTomlVersion(
	before: string,
	inSection: (heading: string) => boolean,
	version: string,
): string | undefined {
	let current = '', count = 0;
	const after = before.split('\n').map(line => {
		const heading = /^\s*\[([^\]]+)\]/.exec(line);
		if (heading) current = heading[1] ?? '';
		if (inSection(current) && /^\s*version\s*=\s*["']/.test(line)) {
			count++;
			return line.replace(/(version\s*=\s*)["'][^"']*["']/, `$1"${version}"`);
		}
		return line;
	}).join('\n');
	return count === 1 ? after : undefined;
}
export function yamlDocument(source: string): Document.Parsed {
	return parseDocument(source, { uniqueKeys: true });
}
export function validYaml(source: string, message: string): Result.Result<Document.Parsed, DomainError> {
	const document = yamlDocument(source);
	return document.errors.length ? Result.fail(precondition(message)) : Result.succeed(document);
}
export function yamlData(document: Document): unknown {
	return document.toJS({ maxAliasCount: 100 });
}
export function yaml(source: string): Result.Result<Record<string, unknown>, DomainError> {
	return validYaml(source, 'Invalid YAML').pipe(
		Result.flatMap(document => Result.try({ try: () => object(yamlData(document)), catch: toDomainError })),
	);
}
