import { object } from '@/automation/managers/helpers';
import { emptyInventory, type Fetcher, type Manager, type RegistryVersion } from '@/automation/managers/registry';
import { latestVersion, unpublished } from '@/automation/managers/verification';
import { identityOf } from '@/automation/package-identity';
import { registry } from '@/automation/package-publication';

const packageName = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
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
export async function prepareJsrPackage(
	name: string,
	repository: string,
	token: string | undefined,
	request: Fetcher,
): Promise<void> {
	if (!packageName.test(name)) throw new Error('Invalid JSR package name');
	const [scope, bare] = name.slice(1).split('/');
	const [owner, repo] = repository.split('/');
	const call = async (path: string, method = 'GET', body?: unknown): Promise<Response> => {
		if (method !== 'GET' && !token) {
			throw new Error(`Store a JSR access token as ${jsrTokenAlias} so Beepboop can set up ${name}`);
		}
		const response = await request(`https://api.jsr.io${path}`, {
			method,
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000),
			headers: {
				'User-Agent': 'beepboop release setup',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok && !(method === 'GET' && response.status === 404)) {
			throw new Error(`JSR ${method} ${path} failed: HTTP ${response.status} ${await response.text()}`);
		}
		return response;
	};
	const existing = await call(`/scopes/${scope}/packages/${bare}`);
	if (existing.status === 404) await call(`/scopes/${scope}/packages`, 'POST', { package: bare });
	const linked = existing.ok ? object(object(await existing.json()).githubRepository) : {};
	if (linked.owner !== owner || linked.name !== repo) {
		await call(`/scopes/${scope}/packages/${bare}`, 'PATCH', { githubRepository: { owner, name: repo } });
	}
	if (token) await call(`/scopes/${scope}`, 'PATCH', { ghActionsVerifyActor: false });
}
export const jsrManager: Manager = {
	name: 'jsr',
	identity: pkg => identityOf(pkg),
	discover(snapshot) {
		const inventory = emptyInventory();
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!/(?:^|\/)jsr\.json$/.test(path)) continue;
			inventory.managers = ['jsr'];
			try {
				const manifest = object(JSON.parse(source));
				if (typeof manifest.name !== 'string' || !packageName.test(manifest.name)) {
					throw new Error('Invalid package name');
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
			} catch {
				inventory.diagnostics.push(`${path}: invalid JSR manifest`);
			}
		}
		return inventory;
	},
	ownsVersionSource: source => /(?:^|\/)jsr\.json#version$/.test(source),
	editVersion({ before, version }) {
		return `${JSON.stringify({ ...JSON.parse(before), version }, null, before.match(/\n([\t ]+)"/)?.[1] ?? '  ')}\n`;
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
