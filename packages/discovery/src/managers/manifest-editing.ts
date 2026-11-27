import { Result } from 'effect';
import { record } from '@/kernel/schema/result.ts';
import { escapeRegExp } from '@/kernel/text/patterns.ts';
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
	key = 'version',
): string | undefined {
	const keyPattern = key.split('.').map(escapeRegExp).join(String.raw`[ \t]*\.[ \t]*`);
	const assignment = new RegExp(String.raw`^([ \t]*${keyPattern}[ \t]*=[ \t]*)(["'])([^"'\r\n]*)\2([ \t]*(?:#[^\r\n]*)?\r?)$`);
	let current = '', count = 0;
	const after = before.split('\n').map(line => {
		const heading = /^\s*\[([^\]]+)\]/.exec(line);
		if (heading) current = heading[1] ?? '';
		if (!inSection(current)) return line;
		return line.replace(assignment, (_, prefix: string, quote: string, _prior: string, suffix: string) => {
			count++;
			return `${prefix}${quote}${version}${quote}${suffix}`;
		});
	}).join('\n');
	return count === 1 ? after : undefined;
}
