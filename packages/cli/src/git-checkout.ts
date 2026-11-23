import type { CLIError } from '@kjanat/dreamcli';
import { Effect } from 'effect';
import { failure } from '@/cli/render/output';
import { repositoryReference } from '@/domain/repository-name.ts';
import { git } from '@/host/git.ts';

function checkoutGit(cwd: string, args: string[]): Effect.Effect<string, CLIError> {
	return Effect.sync(() => git(['-C', cwd, ...args], { timeout: 10_000, maxBuffer: 1024 * 1024 })).pipe(
		Effect.flatMap(result =>
			result.ok
				? Effect.succeed(result.stdout)
				: Effect.fail(failure(
					'Could not read the current Git checkout',
					'GIT_RESOLUTION_FAILED',
					'Run this in a Git checkout or pass --repository owner/repository',
				))
		),
	);
}

function remoteRepository(remote: string): Effect.Effect<string | undefined> {
	return Effect.gen(function*() {
		let address = remote;
		if (/^(?:https?|ssh):\/\//i.test(remote)) {
			const parsed = URL.parse(remote);
			if (!parsed || !['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) return undefined;
			address = `https://github.com${parsed.pathname}`;
		} else if (!/^git@github\.com:/i.test(remote)) return undefined;
		return yield* repositoryReference(address).pipe(
			Effect.map(reference => reference.owner ? `${reference.owner}/${reference.name}` : undefined),
			Effect.orElseSucceed(() => undefined),
		);
	});
}

export function checkoutRepository(cwd: string): Effect.Effect<string, CLIError> {
	return Effect.gen(function*() {
		const remotes = (yield* checkoutGit(cwd, ['remote'])).split('\n').filter(Boolean);
		if (!remotes.length) {
			return yield* Effect.fail(failure(
				'This checkout has no Git remotes',
				'REPOSITORY_REQUIRED',
				'Pass --repository owner/repository',
			));
		}
		const preferred = remotes.includes('origin') ? ['origin'] : remotes;
		const repositories = new Map<string, string>();
		for (const remote of preferred) {
			const urls = (yield* checkoutGit(cwd, ['remote', 'get-url', '--all', remote])).split('\n').filter(Boolean);
			for (const url of urls) {
				const repository = yield* remoteRepository(url);
				if (repository) repositories.set(repository.toLowerCase(), repository);
				else if (remote === 'origin') {
					return yield* Effect.fail(failure(
						'The origin remote is not a supported GitHub repository',
						'INVALID_REMOTE',
						'Pass --repository owner/repository',
					));
				}
			}
		}
		const [repository, ...more] = repositories.values();
		if (!repository || more.length) {
			return yield* Effect.fail(failure(
				more.length
					? 'Git remotes point to multiple GitHub repositories'
					: 'No GitHub repository could be resolved from the remotes',
				'REPOSITORY_REQUIRED',
				'Pass --repository owner/repository',
			));
		}
		return repository;
	});
}
