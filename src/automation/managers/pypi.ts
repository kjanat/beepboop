import { Effect, Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { editTomlVersion, object } from '@/automation/managers/helpers';
import { isPyproject, privateProject } from '@/automation/managers/pyproject';
import type { Adapter } from '@/automation/managers/registry';
import { emptyInventory } from '@/automation/managers/registry';
import { latestVersion, publicationResult, registryRequest, unconfirmed } from '@/automation/managers/verification';
import { excluded, registry } from '@/automation/package-publication';
import { fileProblem } from '@/contract/diagnostics';
import { precondition } from '@/contract/errors';
import { fromPromise } from '@/failure';
import { packageIdentity } from '@/package-url';

const projectName = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const projectVersion = /^[0-9A-Za-z.+!-]+$/;

export function normalizedProject(name: string): string {
	return name.toLowerCase().replace(/[-_.]+/g, '-');
}

export const pypiManager: Adapter<'pypi'> = {
	name: 'pypi',
	identity: pkg => packageIdentity({ type: 'pypi', name: pkg.name, version: pkg.version }),
	discover(snapshot) {
		const inventory = emptyInventory();
		for (const [path, source] of Object.entries(snapshot.files)) {
			if (!isPyproject(path)) continue;
			const document = Result.try(() => object(parseToml(source)));
			if (Result.isFailure(document)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', 'invalid TOML'));
				continue;
			}
			const project = object(document.success.project);
			if (typeof project.name !== 'string') continue;
			inventory.managers = ['pypi'];
			if (!projectName.test(project.name)) {
				inventory.diagnostics.push(fileProblem(path, 'invalid-manifest', 'invalid Python project name'));
				continue;
			}
			const hidden = privateProject(document.success);
			inventory.packages.push({
				manager: 'pypi',
				name: normalizedProject(project.name),
				manifest: path,
				...(typeof project.version === 'string' ? { version: project.version } : {}),
				versionSource: `${path}#project.version`,
				publication: hidden ? excluded('private') : registry,
				dependencies: [],
			});
		}
		return inventory;
	},
	ownsVersionSource: source => /(?:^|\/)pyproject\.toml#project\.version$/.test(source),
	editVersion({ before, version }) {
		const after = editTomlVersion(before, heading => heading.trim() === 'project', version);
		return after === undefined
			? Effect.fail(precondition('Cannot safely edit [project].version'))
			: Effect.succeed(after);
	},
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
			const body = object(yield* fromPromise((): Promise<unknown> => response.json()));
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
		}).pipe(Effect.catchCause(() => Effect.succeed(result('uncertain'))));
	},
};
