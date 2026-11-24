import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import type { Channel } from '@/domain/destinations.ts';
import type { Package } from '@/domain/inventory.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { resolvePublished } from '@/publication/registries/verify.ts';

function pkg(manager: Package['manager'], name: string): Package {
	return {
		manager,
		name,
		manifest: 'manifest',
		versionSource: 'manifest',
		publication: { kind: 'registry' },
		dependencies: [],
	};
}

const registries: Fetcher = async input => {
	const url = new URL(input instanceof Request ? input.url : input);
	if (url.host === 'registry.npmjs.org') {
		return Response.json({ 'dist-tags': { latest: '1.2.0' }, versions: { '1.2.0': {} } });
	}
	if (url.host === 'pypi.org') return new Response(null, { status: 500 });
	if (url.host === 'aur.archlinux.org') {
		return Response.json({ type: 'multi', results: [{ Name: 'widget-bin', Version: '1:1.4.0-2' }] });
	}
	if (url.host === 'raw.githubusercontent.com' && url.pathname.endsWith('.rb')) {
		return new Response(null, { status: 500 });
	}
	if (url.host === 'proxy.golang.org') {
		return url.pathname === '/example.com/tool/v2/@latest'
			? Response.json({ Version: 'v2.1.0' })
			: Response.json({ Version: 'v1.9.0' });
	}
	return new Response(null, { status: 404 });
};

test('published lookups set the status, the version, every destination and the previous module', async () => {
	const inventory = await Effect.runPromise(resolvePublished({
		packages: [
			pkg('npm', 'widget'),
			pkg('cargo', 'widget-core'),
			pkg('pypi', 'widget-py'),
			pkg('go', 'example.com/tool/v2'),
		],
		workflows: [],
		managers: [],
		diagnostics: [],
		publicationOrder: [],
	}, registries));
	const [npm, cargo, pypi, go] = inventory.packages;
	expect([npm?.publicationStatus, npm?.published, npm?.destinations]).toEqual([
		'published',
		'1.2.0',
		[{ destination: 'npm', state: 'published', version: '1.2.0' }],
	]);
	expect([cargo?.publicationStatus, cargo?.published, cargo?.destinations]).toEqual([
		'missing',
		undefined,
		[{ destination: 'crates-io', state: 'missing' }],
	]);
	expect([pypi?.publicationStatus, pypi?.destinations]).toEqual([
		'failed',
		[{ destination: 'pypi', state: 'failed', reason: 'HTTP 500' }],
	]);
	expect([go?.publicationStatus, go?.published, go?.previousModule]).toEqual([
		'published',
		'2.1.0',
		{ name: 'example.com/tool', version: '1.9.0' },
	]);
	expect(inventory.diagnostics).toEqual([{
		code: 'lookup-failed',
		severity: 'warning',
		subject: { kind: 'package', key: 'pkg:generic/pypi/widget-py' },
		message: 'pypi:widget-py: HTTP 500 from https://pypi.org/pypi/widget-py/json',
	}]);
});

test('repository channels report a published AUR package, a missing Scoop manifest and a failed tap lookup', async () => {
	const aur: Channel = { destination: 'aur', name: 'widget-bin', manifest: 'PKGBUILD' };
	const scoop: Channel = {
		destination: 'scoop',
		repository: 'octo/bucket',
		directory: 'bucket',
		name: 'widget',
		manifest: '.goreleaser.yaml',
	};
	const tap: Channel = {
		destination: 'homebrew',
		kind: 'cask',
		repository: 'octo/homebrew-tap',
		directory: 'Casks',
		name: 'widget',
		manifest: '.goreleaser.yaml',
	};
	const inventory = await Effect.runPromise(resolvePublished({
		packages: [],
		workflows: [],
		managers: [],
		diagnostics: [],
		publicationOrder: [],
		channels: [aur, scoop, tap],
	}, registries));
	expect(inventory.destinations).toEqual([
		{ ...aur, state: 'published', version: '1.4.0' },
		{ ...scoop, state: 'missing' },
		{ ...tap, state: 'failed', reason: 'HTTP 500' },
	]);
	expect(inventory.diagnostics).toEqual([{
		code: 'lookup-failed',
		severity: 'warning',
		message: '.goreleaser.yaml: HTTP 500 from https://raw.githubusercontent.com/octo/homebrew-tap/HEAD/Casks/widget.rb',
	}]);
});
