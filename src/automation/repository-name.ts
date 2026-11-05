import { Effect } from 'effect';
import type { DomainError } from '@/contract/errors';
import { fromSync } from '@/failure';

const fullName = /^[\w.-]+\/[\w.-]+$/;

export function repositoryReference(input: string): { owner?: string; name: string } {
	const value = input.trim().replace(/\/+$/, '');
	const located = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(value)
		?? /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(value);
	if (located?.[1] && located[2]) return { owner: located[1], name: located[2] };
	const parts = value.replace(/\.git$/, '').split('/');
	if (parts.length === 1 && parts[0] && /^[\w.-]+$/.test(parts[0])) return { name: parts[0] };
	if (parts.length === 2 && fullName.test(value.replace(/\.git$/, ''))) {
		const [owner, name] = parts;
		if (owner && name) return { owner, name };
	}
	throw new Error('Enter a repository as name, owner/name or a GitHub URL');
}
export function repositoryName(
	input: string,
	defaultOwner: Effect.Effect<string, DomainError>,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const reference = yield* fromSync(() => repositoryReference(input));
		return `${reference.owner ?? (yield* defaultOwner)}/${reference.name}`;
	});
}
