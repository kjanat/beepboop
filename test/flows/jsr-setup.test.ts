import { expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { Secrets } from '@/credentials/vault.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition, upstream } from '@/kernel/errors/domain-error.ts';
import { registryLayer } from '@/publication/registries/registry.ts';
import { setUpJsrPackages } from '@/publication/setup/jsr.ts';

function setUp(
	ids: string[],
	reveal: (alias: string, actor: string) => Effect.Effect<string, DomainError>,
	calls: string[],
) {
	return Effect.runPromise(
		setUpJsrPackages(ids, 'octo/widget', 'setup:run').pipe(
			Effect.provide(Layer.mergeAll(
				Layer.succeed(Secrets, { reveal }),
				registryLayer(async (input, init) => {
					calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
					return init?.method === undefined || init.method === 'GET'
						? Response.json({ githubRepository: { owner: 'octo', name: 'widget' } })
						: new Response(null, { status: 204 });
				}),
			)),
			Effect.flip,
			Effect.option,
		),
	);
}

test('JSR setup reads the token once and sets up each JSR package once', async () => {
	const calls: string[] = [];
	const revealed: string[] = [];
	const failure = await setUp(
		['pkg:npm/widget', 'pkg:jsr/%40octo/widget', 'pkg:jsr/%40octo/widget', 'pkg:jsr/%40octo/tool'],
		(alias, actor) => Effect.sync(() => void revealed.push(`${alias} ${actor}`)).pipe(Effect.as('token')),
		calls,
	);
	expect(failure._tag).toBe('None');
	expect(revealed).toEqual(['jsr-token setup:run']);
	expect(calls).toEqual([
		'GET https://api.jsr.io/scopes/octo/packages/widget',
		'PATCH https://api.jsr.io/scopes/octo',
		'GET https://api.jsr.io/scopes/octo/packages/tool',
		'PATCH https://api.jsr.io/scopes/octo',
	]);
});

test('JSR setup skips the vault when no JSR package is published', async () => {
	const calls: string[] = [];
	const failure = await setUp(['pkg:npm/widget'], () => Effect.die('the vault was read'), calls);
	expect(failure._tag).toBe('None');
	expect(calls).toEqual([]);
});

test('a missing JSR token names the packages it blocks, and a vault outage passes through', async () => {
	const calls: string[] = [];
	const missing = await setUp(
		['pkg:jsr/%40octo/widget', 'pkg:jsr/%40octo/tool'],
		() => Effect.fail(precondition('No credential')),
		calls,
	);
	expect(missing._tag === 'Some' && missing.value.message).toBe(
		'Store a JSR access token as jsr-token so Beepboop can set up @octo/widget, @octo/tool',
	);
	const outage = await setUp(['pkg:jsr/%40octo/widget'], () => Effect.fail(upstream('d1', 'D1 unavailable')), calls);
	expect(outage._tag === 'Some' && outage.value.problem.code).toBe('upstream');
	expect(calls).toEqual([]);
});
