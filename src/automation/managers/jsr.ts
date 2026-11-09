import { Effect } from 'effect';
import type { ParseError } from 'jsonc-parser';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { object } from '@/automation/managers/helpers';
import type { Adapter, Fetcher, RegistryVersion } from '@/automation/managers/registry';
import { emptyInventory, Registry } from '@/automation/managers/registry';
import { latestVersion, unpublished } from '@/automation/managers/verification';
import { identityOf } from '@/automation/package-identity';
import { registry } from '@/automation/package-publication';
import type { Outcome, Publication } from '@/automation/types';
import { jsrManifest, jsrPackageNamePattern } from '@/contract/catalog';
import { fileProblem } from '@/contract/diagnostics';
import type { DomainError } from '@/contract/errors';
import { domainError, upstream } from '@/contract/errors';
import { sha256Hex } from '@/contract/ids';
import { fromPromise, fromSync } from '@/failure';
import { parentDirectory } from '@/relative-path';

const precedence = ['jsr.json', 'jsr.jsonc', 'deno.json', 'deno.jsonc'];
function rank(path: string): number {
	return precedence.indexOf(path.slice(path.lastIndexOf('/') + 1));
}
const licenseTerm = String.raw`\(?(?!UNLICENSED\b|LicenseRef-)[A-Za-z0-9][A-Za-z0-9.+-]*\)?`;
const spdxLicense = new RegExp(`^${licenseTerm}(?: (?:AND|OR|WITH) ${licenseTerm})*$`);
export function jsrLatest(name: string, request: Fetcher): Effect.Effect<RegistryVersion> {
	if (!jsrPackageNamePattern.test(name)) return Effect.die(new Error('Invalid JSR package name'));
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
			registry.fetch(`https://api.jsr.io${path}`, {
				method,
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000),
				headers: {
					'User-Agent': 'beepboop release setup',
					Authorization: `Bearer ${token}`,
					...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}).pipe(Effect.flatMap(response => {
				if (response.ok || (method === 'GET' && response.status === 404)) return Effect.succeed(response);
				const failed = `JSR ${method} ${path} failed with HTTP ${response.status}`;
				return fromPromise(() => response.text()).pipe(Effect.flatMap(detail =>
					Effect.fail(
						response.status >= 500 || response.status === 429
							? upstream('registry', `${failed}: ${detail}`)
							: setupRefused(`${failed}: ${detail}`),
					)
				));
			}));
		const existing = yield* call(`/scopes/${scope}/packages/${bare}`);
		if (existing.status === 404) yield* call(`/scopes/${scope}/packages`, 'POST', { package: bare });
		const linked = existing.ok ? object(object(yield* fromPromise(() => existing.json())).githubRepository) : {};
		if (linked.owner === undefined) {
			yield* call(`/scopes/${scope}/packages/${bare}`, 'PATCH', { githubRepository: { owner, name: repo } });
		} else if (linked.owner !== owner || linked.name !== repo) {
			return yield* setupRefused(
				`${name} is linked to ${String(linked.owner)}/${String(linked.name)}, not ${repository}`,
			);
		}
		yield* call(`/scopes/${scope}`, 'PATCH', { ghActionsVerifyActor: false });
	});
}
export function jsrTokenRefused(names: string[]): DomainError {
	return setupRefused(`Store a JSR access token as ${jsrTokenAlias} so Beepboop can set up ${names.join(', ')}`);
}
export const jsrManager: Adapter<'jsr'> = {
	name: 'jsr',
	identity: pkg => identityOf(pkg),
	discover(snapshot) {
		const inventory = emptyInventory();
		const manifests = new Map<string, string>();
		for (const path of Object.keys(snapshot.files).filter(path => jsrManifest.test(path))) {
			const dir = parentDirectory(path);
			const chosen = manifests.get(dir);
			if (!chosen || rank(path) < rank(chosen)) manifests.set(dir, path);
		}
		for (const path of manifests.values()) {
			const source = snapshot.files[path] ?? '';
			const errors: ParseError[] = [];
			const manifest = object(parse(source, errors, { allowTrailingComma: true }));
			const deno = /(?:^|\/)deno\.jsonc?$/.test(path);
			if (deno && !errors.length && manifest.name === undefined) continue;
			inventory.managers = ['jsr'];
			if (errors.length || typeof manifest.name !== 'string' || !jsrPackageNamePattern.test(manifest.name)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', `invalid JSR manifest`));
				continue;
			}
			if (
				manifest.license !== undefined
				&& (typeof manifest.license !== 'string' || !spdxLicense.test(manifest.license))
			) {
				inventory.diagnostics.push(
					fileProblem(path, 'license-missing', `JSR requires an SPDX license expression in "license"`),
				);
			}
			inventory.packages.push({
				manager: 'jsr',
				name: manifest.name,
				manifest: path,
				...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
				versionSource: `${path}#version`,
				publication: registry,
				dependencies: [],
			});
		}
		return inventory;
	},
	ownsVersionSource: source => /(?:^|\/)(?:jsr|deno)\.jsonc?#version$/.test(source),
	editVersion({ before, version }) {
		const indent = before.match(/\n([\t ]+)"/)?.[1] ?? '  ';
		return fromSync(() =>
			applyEdits(
				before,
				modify(before, ['version'], version, {
					formattingOptions: { insertSpaces: !indent.startsWith('\t'), tabSize: indent.length },
				}),
			)
		);
	},
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
		const result = (outcome: Outcome, digest?: string): Publication => ({
			...publication,
			outcome,
			url,
			...(digest === undefined ? {} : { digest }),
		});
		return Effect.gen(function*() {
			const metadata = yield* fromPromise(() => request(`https://jsr.io/${publication.name}/meta.json`, options));
			if (metadata.status === 404) return result('pending');
			if (!metadata.ok) return result('uncertain');
			const body = object(yield* fromPromise((): Promise<unknown> => metadata.json()));
			const [scope, name] = publication.name.slice(1).split('/');
			if (body.scope !== scope || body.name !== name) return result('failed');
			if (!Object.hasOwn(object(body.versions), publication.version)) return result('pending');
			if (object(object(body.versions)[publication.version]).yanked === true) return result('failed');
			const response = yield* fromPromise(() => request(url, options));
			if (response.status === 404) return result('pending');
			if (!response.ok) return result('uncertain');
			const bytes = yield* fromPromise(() => response.arrayBuffer());
			const version = object(JSON.parse(new TextDecoder().decode(bytes)));
			const files = Object.values(object(version.manifest));
			if (
				!files.length || !Object.keys(object(version.exports)).length
				|| files.some(file => !/^sha256-[a-f0-9]{64}$/.test(String(object(file).checksum)))
			) {
				return result('failed');
			}
			const digest = `sha256-${yield* fromPromise(() => sha256Hex(bytes))}`;
			return result(publication.digest && publication.digest !== digest ? 'failed' : 'succeeded', digest);
		}).pipe(Effect.catchCause(() => Effect.succeed(result('uncertain'))));
	},
};
