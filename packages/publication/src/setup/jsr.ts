import { Effect } from 'effect';
import { Secrets } from '@/credentials/vault.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { jsrPackageNamePattern } from '@/domain/catalog.ts';
import { toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { domainError, upstream } from '@/kernel/errors/domain-error.ts';
import { responseJson, responseText, scopedResponse } from '@/kernel/http/body.ts';
import { Registry } from '@/publication/registries/registry.ts';

export const jsrTokenAlias = 'jsr-token';
function setupRefused(message: string): DomainError {
	return domainError(
		{ code: 'precondition', diagnostics: [{ code: 'registry-setup', severity: 'blocking', message }] },
		message,
	);
}
export function setUpJsrPackage(
	name: string,
	repository: string,
	token: string,
): Effect.Effect<void, DomainError, Registry> {
	return Effect.gen(function*() {
		if (!jsrPackageNamePattern.test(name)) return yield* setupRefused(`Invalid JSR package name ${name}`);
		const registry = yield* Registry;
		const [scope, bare] = name.slice(1).split('/');
		const [owner, repo] = repository.split('/');
		const call = (path: string, method = 'GET', body?: unknown) =>
			scopedResponse(registry.fetch(`https://api.jsr.io${path}`, {
				method,
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000),
				headers: {
					'User-Agent': 'beepboop release setup',
					Authorization: `Bearer ${token}`,
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			})).pipe(Effect.flatMap(response => {
				if (response.ok || (method === 'GET' && response.status === 404)) return Effect.succeed(response);
				const failed = `JSR ${method} ${path} failed with HTTP ${response.status}`;
				return responseText(response).pipe(
					Effect.mapError(({ cause }) => toDomainError(cause)),
					Effect.flatMap(detail =>
						Effect.fail(
							response.status >= 500 || response.status === 429
								? upstream('registry', `${failed}: ${detail}`)
								: setupRefused(`${failed}: ${detail}`),
						)
					),
				);
			}));
		const existing = yield* call(`/scopes/${scope}/packages/${bare}`);
		if (existing.status === 404) yield* call(`/scopes/${scope}/packages`, 'POST', { package: bare });
		const linked = existing.ok
			? object(
				object(yield* responseJson(existing).pipe(Effect.mapError(({ cause }) => toDomainError(cause))))
					.githubRepository,
			)
			: {};
		if (linked.owner === undefined) {
			yield* call(`/scopes/${scope}/packages/${bare}`, 'PATCH', { githubRepository: { owner, name: repo } });
		} else if (linked.owner !== owner || linked.name !== repo) {
			return yield* setupRefused(
				`${name} is linked to ${String(linked.owner)}/${String(linked.name)}, not ${repository}`,
			);
		}
		yield* call(`/scopes/${scope}`, 'PATCH', { ghActionsVerifyActor: false });
	}).pipe(Effect.scoped);
}
export function jsrTokenRefused(names: string[]): DomainError {
	return setupRefused(`Store a JSR access token as ${jsrTokenAlias} so Beepboop can set up ${names.join(', ')}`);
}
export function setUpJsrPackages(
	ids: Iterable<string>,
	repository: string,
	actor: string,
): Effect.Effect<void, DomainError, Registry | Secrets> {
	const names = [...new Set(ids)].flatMap(id => id.startsWith('pkg:jsr/') ? [decodeURIComponent(id.slice(8))] : []);
	if (!names.length) return Effect.void;
	return Effect.gen(function*() {
		const secrets = yield* Secrets;
		const token = yield* secrets.reveal(jsrTokenAlias, actor).pipe(
			Effect.catchIf(error => error.problem.code !== 'upstream', () => Effect.fail(jsrTokenRefused(names))),
		);
		for (const name of names) yield* setUpJsrPackage(name, repository, token);
	});
}
