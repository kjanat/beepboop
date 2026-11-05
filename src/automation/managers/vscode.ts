import { Effect, Result } from 'effect';
import { z } from 'zod';
import { object } from '@/automation/managers/helpers';
import { type Adapter, emptyInventory, type RegistryVersion } from '@/automation/managers/registry';
import { latestVersion, unpublished } from '@/automation/managers/verification';
import { identityOf, parseExtension } from '@/automation/package-identity';
import { excluded, registry } from '@/automation/package-publication';
import type { Outcome, Publication } from '@/automation/types';
import { fileProblem } from '@/contract/diagnostics';
import { fromPromise } from '@/failure';

const identifier = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const marketplaceQuery = z.object({
	results: z.array(z.object({
		extensions: z.array(z.object({ versions: z.array(z.object({ version: z.string() })) })),
	})),
});
const openVsxExtension = z.object({ version: z.string() });
const gallery = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';
const galleryHeaders = { Accept: 'application/json;api-version=3.0-preview.1', 'Content-Type': 'application/json' };
function galleryQuery(id: string, latestOnly: boolean): string {
	// filterType 7 matches the publisher.name extension ID; flag 1 includes versions and flag 512 keeps only the latest.
	return JSON.stringify({
		filters: [{ criteria: [{ filterType: 7, value: id }], pageNumber: 1, pageSize: 1 }],
		flags: latestOnly ? 513 : 1,
	});
}
function marketplaceVersions(body: unknown): string[] | undefined {
	const parsed = marketplaceQuery.safeParse(body);
	if (!parsed.success) return undefined;
	return parsed.data.results[0]?.extensions[0]?.versions.map(entry => entry.version) ?? [];
}

export const vscodeManager: Adapter<'vscode'> = {
	name: 'vscode',
	identity: pkg => identityOf(pkg),
	latest(pkg, request) {
		return latestVersion(
			request,
			gallery,
			body => {
				const versions = marketplaceVersions(body);
				return versions?.length === 0 ? unpublished : versions?.[0];
			},
			{ method: 'POST', headers: galleryHeaders, body: galleryQuery(pkg.name, true) },
		);
	},
	verifyPublication(publication, request) {
		const url = `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(publication.name)}`;
		const result = (outcome: Outcome): Publication => ({ ...publication, outcome, url });
		return Effect.gen(function*() {
			const response = yield* fromPromise(() =>
				request(gallery, {
					method: 'POST',
					redirect: 'manual',
					signal: AbortSignal.timeout(15_000),
					headers: { 'User-Agent': 'beepboop release verification', ...galleryHeaders },
					body: galleryQuery(publication.name, false),
				})
			);
			if (!response.ok) return result('uncertain');
			const versions = marketplaceVersions(yield* fromPromise((): Promise<unknown> => response.json()));
			if (!versions) return result('uncertain');
			return result(versions.includes(publication.version) ? 'succeeded' : 'pending');
		}).pipe(Effect.catchCause(() => Effect.succeed(result('uncertain'))));
	},
	secondaryLatest: {
		'open-vsx'(pkg, request) {
			return Result.match(parseExtension(pkg.name), {
				onFailure: error =>
					Effect.succeed<RegistryVersion>({ kind: 'failed', url: 'https://open-vsx.org', reason: error.message }),
				onSuccess: ({ publisher, extension }) =>
					latestVersion(
						request,
						`https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(extension)}`,
						body => openVsxExtension.safeParse(body).data?.version,
					),
			});
		},
	},
	discover(snapshot) {
		const inventory = emptyInventory();
		for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
			if (path !== 'package.json' && !path.endsWith('/package.json')) continue;
			const parsed = Result.try(() => object(JSON.parse(source)));
			if (Result.isFailure(parsed)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', `cannot safely discover configuration`));
				continue;
			}
			const manifest = parsed.success;
			if (typeof object(manifest.engines).vscode !== 'string') continue;
			inventory.managers = ['vscode'];
			if (typeof manifest.publisher !== 'string' || !identifier.test(manifest.publisher)) {
				inventory.diagnostics.push(
					fileProblem(path, 'invalid-manifest', `VS Code extension publisher is missing or invalid`),
				);
				continue;
			}
			if (typeof manifest.name !== 'string' || !identifier.test(manifest.name)) {
				inventory.diagnostics.push(
					fileProblem(path, 'invalid-manifest', `VS Code extension name is missing or invalid`),
				);
				continue;
			}
			inventory.packages.push({
				manager: 'vscode',
				name: `${manifest.publisher}.${manifest.name}`,
				...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
				manifest: path,
				versionSource: `${path}#version`,
				publication: manifest.private === true ? excluded('private') : registry,
				dependencies: Array.isArray(manifest.extensionDependencies)
					? manifest.extensionDependencies.filter(dependency => typeof dependency === 'string')
					: [],
			});
		}
		return inventory;
	},
};
