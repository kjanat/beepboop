import { Effect } from 'effect';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';

const fullName = /^[\w.-]+\/[\w.-]+$/;

export interface RepositoryReference {
	owner?: string;
	name: string;
}
export function repositoryReference(input: string): Effect.Effect<RepositoryReference, DomainError> {
	const value = input.trim().replace(/\/+$/, '');
	const located = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(value)
		?? /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(value);
	if (located?.[1] && located[2]) return Effect.succeed({ owner: located[1], name: located[2] });
	const parts = value.replace(/\.git$/, '').split('/');
	if (parts.length === 1 && parts[0] && /^[\w.-]+$/.test(parts[0])) return Effect.succeed({ name: parts[0] });
	const [owner, name] = parts;
	if (parts.length === 2 && fullName.test(value.replace(/\.git$/, '')) && owner && name) {
		return Effect.succeed({ owner, name });
	}
	return Effect.fail(precondition('Enter a repository as name, owner/name or a GitHub URL'));
}
export function repositoryName(
	input: string,
	defaultOwner: Effect.Effect<string, DomainError>,
): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const reference = yield* repositoryReference(input);
		return `${reference.owner ?? (yield* defaultOwner)}/${reference.name}`;
	});
}
