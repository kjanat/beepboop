import { Effect, Result } from 'effect';
import { parse as parseToml } from 'smol-toml';
import { object } from '@/automation/managers/helpers';
import { type Adapter, emptyInventory } from '@/automation/managers/registry';
import { latestVersion } from '@/automation/managers/verification';
import { excluded, registry } from '@/automation/package-publication';
import type { Outcome, Publication } from '@/automation/types';
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
			if (!/(?:^|\/)pyproject\.toml$/.test(path) || path.startsWith('.github/')) continue;
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
			const classifiers = Array.isArray(project.classifiers) ? project.classifiers : [];
			const hidden = object(object(document.success.tool).uv).package === false
				|| classifiers.includes('Private :: Do Not Upload');
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
		let section = '', count = 0;
		const after = before.split('\n').map(line => {
			const heading = /^\s*\[([^\]]+)\]/.exec(line);
			if (heading) section = heading[1]?.trim() ?? '';
			if (section === 'project' && /^\s*version\s*=\s*["']/.test(line)) {
				count++;
				return line.replace(/(version\s*=\s*)["'][^"']*["']/, `$1"${version}"`);
			}
			return line;
		}).join('\n');
		return count === 1 ? Effect.succeed(after) : Effect.fail(precondition('Cannot safely edit [project].version'));
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
		const result = (outcome: Outcome, digest?: string): Publication => ({
			...publication,
			outcome,
			url,
			...(digest === undefined ? {} : { digest }),
		});
		if (!projectName.test(publication.name) || !projectVersion.test(publication.version)) {
			return Effect.succeed(result('failed'));
		}
		return Effect.gen(function*() {
			const response = yield* fromPromise(() =>
				request(url, {
					redirect: 'manual',
					signal: AbortSignal.timeout(15_000),
					headers: { Accept: 'application/json', 'User-Agent': 'beepboop release verification' },
				})
			);
			if (response.status === 404) return result('pending');
			if (!response.ok) return result('uncertain');
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
