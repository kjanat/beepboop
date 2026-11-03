import { object } from '@/automation/managers/helpers';
import { emptyInventory, type Manager } from '@/automation/managers/registry';
import { latestVersion } from '@/automation/managers/verification';
import { identityOf } from '@/automation/package-identity';

const packageName = /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
/** JSR has no registered PURL type; use generic with an explicit registry qualifier. */
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
					publish: true,
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
	latest(pkg, request) {
		if (!packageName.test(pkg.name)) throw new Error('Invalid JSR package name');
		return latestVersion(request, `https://jsr.io/${pkg.name}/meta.json`, body => {
			const metadata = object(body);
			const [scope, name] = pkg.name.slice(1).split('/');
			const latest = metadata.latest;
			return metadata.scope === scope && metadata.name === name && typeof latest === 'string'
					&& Object.hasOwn(object(metadata.versions), latest)
					&& object(object(metadata.versions)[latest]).yanked !== true
				? latest
				: undefined;
		});
	},
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
