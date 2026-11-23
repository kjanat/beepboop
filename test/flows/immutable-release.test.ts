import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { RepositoryGateway } from '@/automation/gateway.ts';
import { requireImmutableReleases, verifyImmutableRelease } from '@/automation/immutable-release';
import { decode } from '@/kernel/schema/result.ts';

function repository(response: unknown) {
	const requests: { path: string; token: string; method: string }[] = [];
	const gateway: Pick<RepositoryGateway, 'read'> = {
		read(schema, path, token, method = 'GET') {
			requests.push({ path, token, method });
			return Effect.fromResult(decode(schema, response));
		},
	};
	return { gateway, requests };
}

for (const response of [null, { enabled: false }]) {
	test(`required immutability rejects ${response === null ? 'missing settings' : 'disabled settings'} before publication`, async () => {
		const { gateway, requests } = repository(response);
		let published = false;
		const operation = requireImmutableReleases({
			gateway,
			repository: 'octo/widget',
			token: 'repository-token',
			required: true,
		}).pipe(Effect.andThen(Effect.sync(() => {
			published = true;
		})));
		await expect(Effect.runPromise(operation)).rejects.toThrow('Enable immutable GitHub releases');
		expect(published).toBe(false);
		expect(requests).toEqual([{
			path: '/repos/octo/widget/immutable-releases',
			token: 'repository-token',
			method: 'GET',
		}]);
	});
}

test('enabled repository immutability permits publication', async () => {
	const { gateway } = repository({ enabled: true, enforced_by_owner: true });
	let published = false;
	await Effect.runPromise(
		requireImmutableReleases({
			gateway,
			repository: 'other/action',
			token: 'repository-token',
			required: true,
		}).pipe(Effect.andThen(Effect.sync(() => {
			published = true;
		}))),
	);
	expect(published).toBe(true);
});

for (const required of [false, undefined]) {
	test(`optional immutability preserves publication without reading repository settings (${String(required)})`, async () => {
		const { gateway, requests } = repository(null);
		await Effect.runPromise(requireImmutableReleases({
			gateway,
			repository: 'octo/widget',
			token: 'repository-token',
			...(required === undefined ? {} : { required }),
		}));
		expect(requests).toEqual([]);
	});
}

for (const release of [{}, { immutable: false }]) {
	test(`required immutability rejects a published release with immutable=${String(release.immutable)}`, async () => {
		await expect(Effect.runPromise(verifyImmutableRelease(release, true))).rejects.toThrow(
			'Published GitHub release is not immutable',
		);
	});
}

test('an immutable published release passes verification', async () => {
	await Effect.runPromise(verifyImmutableRelease({ immutable: true }, true));
});

test('release verification remains backward compatible without the requirement', async () => {
	for (const release of [{}, { immutable: false }, { immutable: true }]) {
		await Effect.runPromise(verifyImmutableRelease(release));
		await Effect.runPromise(verifyImmutableRelease(release, false));
	}
});
