import { Effect } from 'effect';
import type { Adapter, RegistryVersion } from '@/automation/managers/registry';
import { Registry } from '@/automation/managers/registry';
import { latestVersion, publicationResult, unconfirmed, unpublished } from '@/automation/managers/verification';
import { jsrDiscoverer } from '@/discovery/managers/jsr.ts';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { jsrPackageNamePattern } from '@/domain/catalog.ts';
import { fromJson, fromPromise, toDomainError } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { domainError, upstream } from '@/kernel/errors/domain-error.ts';
import { responseBytes, responseJson, responseText, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { sha256Hex } from '@/kernel/schema/ids.ts';

export function jsrLatest(name: string, request: Fetcher): Effect.Effect<RegistryVersion> {
	if (!jsrPackageNamePattern.test(name)) {
		return Effect.succeed({ kind: 'failed', url: 'https://jsr.io', reason: 'Invalid JSR package name' });
	}
	return latestVersion(request, `https://jsr.io/${name}/meta.json`, body => {
		const metadata = object(body);
		const [scope, bare] = name.slice(1).split('/');
		const latest = metadata.latest;
		if (
			metadata.scope === scope && metadata.name === bare && latest === null
			&& !Object.keys(object(metadata.versions)).length
		) return unpublished;
		return metadata.scope === scope && metadata.name === bare && typeof latest === 'string'
				&& Object.hasOwn(object(metadata.versions), latest)
				&& object(object(metadata.versions)[latest]).yanked !== true
			? latest
			: undefined;
	});
}
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
export const jsrManager: Adapter<'jsr'> = {
	...jsrDiscoverer,
	latest: (pkg, request) => jsrLatest(pkg.name, request),
	verifyPublication(publication, request) {
		if (!jsrPackageNamePattern.test(publication.name) || !/^[0-9A-Za-z.+-]+$/.test(publication.version)) {
			return Effect.succeed({ ...publication, outcome: 'failed' });
		}
		const url = `https://jsr.io/${publication.name}/${publication.version}_meta.json`;
		const options = {
			redirect: 'manual' as const,
			signal: AbortSignal.timeout(15_000),
			headers: { Accept: 'application/json' },
		};
		const result = publicationResult(publication, url);
		return Effect.gen(function*() {
			const metadata = yield* scopedResponse(
				fromPromise(signal =>
					request(`https://jsr.io/${publication.name}/meta.json`, {
						...options,
						signal: AbortSignal.any([signal, options.signal]),
					})
				),
			);
			const absent = unconfirmed(metadata);
			if (absent) return result(absent);
			const body = object(yield* responseJson(metadata));
			const [scope, name] = publication.name.slice(1).split('/');
			if (body.scope !== scope || body.name !== name) return result('failed');
			if (!Object.hasOwn(object(body.versions), publication.version)) return result('pending');
			if (object(object(body.versions)[publication.version]).yanked === true) return result('failed');
			const response = yield* scopedResponse(
				fromPromise(signal => request(url, { ...options, signal: AbortSignal.any([signal, options.signal]) })),
			);
			const missing = unconfirmed(response);
			if (missing) return result(missing);
			const bytes = yield* responseBytes(response);
			const version = object(yield* fromJson(new TextDecoder().decode(bytes)));
			const files = Object.values(object(version.manifest));
			if (
				!files.length || !Object.keys(object(version.exports)).length
				|| files.some(file => !/^sha256-[a-f0-9]{64}$/.test(String(object(file).checksum)))
			) {
				return result('failed');
			}
			const digest = `sha256-${yield* fromPromise(() => sha256Hex(bytes.buffer))}`;
			return result(publication.digest && publication.digest !== digest ? 'failed' : 'succeeded', digest);
		}).pipe(Effect.scoped, Effect.orElseSucceed(() => result('uncertain')));
	},
};
