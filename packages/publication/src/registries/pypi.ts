import { Effect } from 'effect';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { normalizedProject, projectName, pypiDiscoverer } from '@/discovery/managers/pypi.ts';
import { responseJson } from '@/kernel/http/body.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import {
	latestVersion,
	publicationResult,
	registryRequest,
	unconfirmed,
} from '@/publication/registries/verification.ts';

const projectVersion = /^[0-9A-Za-z.+!-]+$/;

export const pypiManager: Adapter<'pypi'> = {
	...pypiDiscoverer,
	latest: (pkg, request) =>
		latestVersion(
			request,
			`https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`,
			body => object(object(body).info).version,
		),
	verifyPublication(publication, request) {
		const url = `https://pypi.org/pypi/${encodeURIComponent(publication.name)}/${
			encodeURIComponent(publication.version)
		}/json`;
		const result = publicationResult(publication, url);
		if (!projectName.test(publication.name) || !projectVersion.test(publication.version)) {
			return Effect.succeed(result('failed'));
		}
		return Effect.gen(function*() {
			const response = yield* registryRequest(request, url, { headers: { Accept: 'application/json' } });
			const missing = unconfirmed(response);
			if (missing) return result(missing);
			const body = object(yield* responseJson(response));
			const info = object(body.info);
			const files = Array.isArray(body.urls) ? body.urls.map(object) : [];
			if (normalizedProject(String(info.name)) !== publication.name || info.version !== publication.version) {
				return result('failed');
			}
			if (!files.length) return result('pending');
			if (info.yanked === true || files.every(file => file.yanked === true)) return result('failed');
			if (publication.digest && !files.some(file => object(file.digests).sha256 === publication.digest)) {
				return result('failed');
			}
			const digest = object(files.find(file => file.packagetype === 'sdist')?.digests ?? files[0]?.digests).sha256;
			return result('succeeded', typeof digest === 'string' ? digest : undefined);
		}).pipe(Effect.scoped, Effect.orElseSucceed(() => result('uncertain')));
	},
};
