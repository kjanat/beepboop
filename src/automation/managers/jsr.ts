import { Effect } from 'effect';
import { applyEdits, modify, type ParseError, parse } from 'jsonc-parser';
import { directory, object } from '@/automation/managers/helpers';
import { type Adapter, emptyInventory, type Fetcher, type RegistryVersion } from '@/automation/managers/registry';
import { latestVersion, unpublished } from '@/automation/managers/verification';
import { identityOf } from '@/automation/package-identity';
import { registry } from '@/automation/package-publication';
import { jsrManifest } from '@/contract/catalog';
import { fileProblem } from '@/contract/diagnostics';
import { attempt, type Failure, Refused, Upstream } from '@/effect/errors';
import { Registry } from '@/effect/services';

const packageName = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const precedence = ['jsr.json', 'jsr.jsonc', 'deno.json', 'deno.jsonc'];
function rank(path: string): number {
	return precedence.indexOf(path.slice(path.lastIndexOf('/') + 1));
}
const licenseTerm = String.raw`\(?(?!UNLICENSED\b|LicenseRef-)[A-Za-z0-9][A-Za-z0-9.+-]*\)?`;
const spdxLicense = new RegExp(`^${licenseTerm}(?: (?:AND|OR|WITH) ${licenseTerm})*$`);
export function jsrLatest(name: string, request: Fetcher): Promise<RegistryVersion> {
	if (!packageName.test(name)) throw new Error('Invalid JSR package name');
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
function setupRefused(message: string): Refused {
	return new Refused({
		problem: { code: 'precondition', diagnostics: [{ code: 'registry-setup', severity: 'blocking', message }] },
		message,
	});
}
export function setUpJsrPackage(
	name: string,
	repository: string,
	token: string,
): Effect.Effect<void, Failure, Registry> {
	return Effect.gen(function*() {
		if (!packageName.test(name)) return yield* setupRefused(`Invalid JSR package name ${name}`);
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
				return attempt(() => response.text()).pipe(Effect.flatMap(detail =>
					Effect.fail(
						response.status >= 500 || response.status === 429
							? new Upstream({ service: 'registry', message: `${failed}: ${detail}` })
							: setupRefused(`${failed}: ${detail}`),
					)
				));
			}));
		const existing = yield* call(`/scopes/${scope}/packages/${bare}`);
		if (existing.status === 404) yield* call(`/scopes/${scope}/packages`, 'POST', { package: bare });
		const linked = existing.ok ? object(object(yield* attempt(() => existing.json())).githubRepository) : {};
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
export function jsrTokenRefused(names: string[]): Refused {
	return setupRefused(`Store a JSR access token as ${jsrTokenAlias} so Beepboop can set up ${names.join(', ')}`);
}
export const jsrManager: Adapter<'jsr'> = {
	name: 'jsr',
	identity: pkg => identityOf(pkg),
	discover(snapshot) {
		const inventory = emptyInventory();
		const manifests = new Map<string, string>();
		for (const path of Object.keys(snapshot.files).filter(path => jsrManifest.test(path))) {
			const dir = directory(path);
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
			if (errors.length || typeof manifest.name !== 'string' || !packageName.test(manifest.name)) {
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
		return applyEdits(
			before,
			modify(before, ['version'], version, {
				formattingOptions: { insertSpaces: !indent.startsWith('\t'), tabSize: indent.length },
			}),
		);
	},
	latest: (pkg, request) => jsrLatest(pkg.name, request),
	async verifyPublication(publication, request) {
		if (!packageName.test(publication.name) || !/^[0-9A-Za-z.+-]+$/.test(publication.version)) {
			return { ...publication, outcome: 'failed' };
		}
		const url = `https://jsr.io/${publication.name}/${publication.version}_meta.json`;
		const options = {
			redirect: 'manual' as const,
			signal: AbortSignal.timeout(15_000),
			headers: { Accept: 'application/json' },
		};
		try {
			const metadata = await request(`https://jsr.io/${publication.name}/meta.json`, options);
			if (metadata.status === 404) return { ...publication, outcome: 'pending', url };
			if (!metadata.ok) return { ...publication, outcome: 'uncertain', url };
			const body = object(await metadata.json());
			const [scope, name] = publication.name.slice(1).split('/');
			if (body.scope !== scope || body.name !== name) return { ...publication, outcome: 'failed', url };
			if (!Object.hasOwn(object(body.versions), publication.version)) {
				return { ...publication, outcome: 'pending', url };
			}
			if (object(object(body.versions)[publication.version]).yanked === true) {
				return { ...publication, outcome: 'failed', url };
			}
			const response = await request(url, options);
			if (response.status === 404) return { ...publication, outcome: 'pending', url };
			if (!response.ok) return { ...publication, outcome: 'uncertain', url };
			const bytes = await response.arrayBuffer();
			const version = object(JSON.parse(new TextDecoder().decode(bytes)));
			const files = Object.values(object(version.manifest));
			if (
				!files.length || !Object.keys(object(version.exports)).length
				|| files.some(file => !/^sha256-[a-f0-9]{64}$/.test(String(object(file).checksum)))
			) {
				return { ...publication, outcome: 'failed', url };
			}
			const digest = `sha256-${
				Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte =>
					byte.toString(16).padStart(2, '0')).join('')
			}`;
			return {
				...publication,
				digest,
				url,
				outcome: publication.digest && publication.digest !== digest ? 'failed' : 'succeeded',
			};
		} catch {
			return { ...publication, outcome: 'uncertain', url };
		}
	},
};
