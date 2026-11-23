import { Effect, Result, Schema } from 'effect';
import { vscodeDiscoverer } from '@/discovery/managers/vscode.ts';
import { parseExtension } from '@/domain/package-identity.ts';
import { responseJson } from '@/kernel/http/body.ts';
import { mutableArray, mutableStruct, safeDecode } from '@/kernel/schema/structs.ts';
import type { Publication } from '@/publication/publication.ts';
import { VerificationOutcome } from '@/publication/registries/outcome.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import {
	latestVersion,
	publicationResult,
	registryRequest,
	unconfirmed,
	unpublished,
} from '@/publication/registries/verification.ts';

const marketplaceQuery = mutableStruct({
	results: mutableArray(mutableStruct({
		extensions: mutableArray(mutableStruct({ versions: mutableArray(mutableStruct({ version: Schema.String })) })),
	})),
});
const openVsxExtension = mutableStruct({ version: Schema.String });
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
	const parsed = safeDecode(marketplaceQuery, body);
	if (!parsed.success) return undefined;
	return parsed.data.results[0]?.extensions[0]?.versions.map(entry => entry.version) ?? [];
}

export const vscodeManager: Adapter<'vscode'> = {
	...vscodeDiscoverer,
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
		const result = publicationResult(publication, url);
		return Effect.gen(function*() {
			const response = yield* registryRequest(request, gallery, {
				method: 'POST',
				headers: galleryHeaders,
				body: galleryQuery(publication.name, false),
			});
			if (!response.ok) return result('uncertain');
			const versions = marketplaceVersions(yield* responseJson(response));
			if (!versions) return result('uncertain');
			return result(versions.includes(publication.version) ? 'succeeded' : 'pending');
		}).pipe(Effect.scoped, Effect.orElseSucceed(() => result('uncertain')));
	},
	secondaryLatest: {
		'open-vsx'(pkg, request) {
			return Result.match(parseExtension(pkg.name), {
				onFailure: error =>
					Effect.succeed(VerificationOutcome.LookupFailed({ url: 'https://open-vsx.org', reason: error.message })),
				onSuccess: ({ publisher, extension }) =>
					latestVersion(
						request,
						`https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(extension)}`,
						body => safeDecode(openVsxExtension, body).data?.version,
					),
			});
		},
	},
	secondaryPublication: {
		'open-vsx'(publication, request) {
			return Result.match(parseExtension(publication.name), {
				onFailure: () => Effect.succeed<Publication>({ ...publication, outcome: 'uncertain' }),
				onSuccess: ({ publisher, extension }) => {
					const url = `https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(extension)}/${
						encodeURIComponent(publication.version)
					}`;
					const result = publicationResult(publication, url);
					return Effect.gen(function*() {
						const response = yield* registryRequest(request, url);
						const missing = unconfirmed(response);
						if (missing) return result(missing);
						const found = safeDecode(openVsxExtension, yield* responseJson(response));
						return result(found.success && found.data.version === publication.version ? 'succeeded' : 'uncertain');
					}).pipe(Effect.scoped, Effect.orElseSucceed(() => result('uncertain')));
				},
			});
		},
	},
};
