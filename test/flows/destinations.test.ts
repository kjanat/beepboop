import { expect, test } from 'bun:test';
import type { Channel } from '@/domain/destinations.ts';
import type { Package } from '@/domain/inventory.ts';
import {
	channelHref,
	destinationHref,
	destinationOutcomes,
	primaryState,
	repositoryChannelOutcomes,
	wingetOutcome,
} from '@/publication/destinations.ts';

const widget: Package = {
	manager: 'npm',
	name: 'widget',
	manifest: 'package.json',
	versionSource: 'package.json',
	publication: { kind: 'registry' },
	dependencies: [],
};
const tap: Channel = {
	destination: 'homebrew',
	kind: 'cask',
	repository: 'octo/homebrew-tap',
	directory: 'Casks',
	name: 'widget',
	manifest: '.goreleaser.yaml',
};

test('a package without stored destinations reports its primary registry from the publication status', () => {
	expect(destinationOutcomes({ ...widget, published: '1.2.0' })).toEqual([
		{ destination: 'npm', state: 'published', version: '1.2.0' },
	]);
	expect(destinationOutcomes({ ...widget, publicationStatus: 'missing' })).toEqual([
		{ destination: 'npm', state: 'missing' },
	]);
	expect(destinationOutcomes({ ...widget, publicationStatus: 'failed' })).toEqual([
		{ destination: 'npm', state: 'failed', reason: 'inspect diagnostics' },
	]);
	expect(destinationOutcomes(widget)).toEqual([{ destination: 'npm', state: 'unchecked' }]);
	expect(destinationOutcomes({ ...widget, manager: 'manifest' })).toEqual([]);
	const stored = [{ ...tap, state: 'tracking' as const }, { destination: 'npm' as const, state: 'missing' as const }];
	expect(destinationOutcomes({ ...widget, published: '1.2.0', destinations: stored })).toBe(stored);
});

test('the primary state comes from the primary registry and never from a channel', () => {
	expect(
		primaryState({
			...widget,
			destinations: [{ ...tap, state: 'published', version: '9.9.9' }, { destination: 'npm', state: 'missing' }],
		}).state,
	).toBe('missing');
	expect(primaryState({ ...widget, destinations: [{ ...tap, state: 'published', version: '9.9.9' }] }).state).toBe(
		'unchecked',
	);
	expect(primaryState({ ...widget, published: '1.2.0' })).toMatchObject({ state: 'published', version: '1.2.0' });
});

test('repository channels keep their checked outcome and default to unchecked', () => {
	const scoop: Channel = {
		destination: 'scoop',
		repository: 'octo/bucket',
		directory: 'bucket',
		name: 'widget',
		manifest: '.goreleaser.yaml',
	};
	expect(repositoryChannelOutcomes({
		packages: [],
		workflows: [],
		managers: [],
		diagnostics: [],
		publicationOrder: [],
		channels: [tap, scoop],
		destinations: [{ ...scoop, state: 'published', version: '1.0.0' }],
	})).toEqual([{ ...tap, state: 'unchecked' }, { ...scoop, state: 'published', version: '1.0.0' }]);
});

test('channel links point at the AUR package page or the manifest file in the tap or bucket', () => {
	expect(channelHref({ destination: 'aur', name: 'widget-bin', manifest: 'PKGBUILD' })).toBe(
		'https://aur.archlinux.org/packages/widget-bin',
	);
	expect(channelHref(tap)).toBe('https://github.com/octo/homebrew-tap/blob/HEAD/Casks/widget.rb');
	expect(channelHref({ ...tap, destination: 'scoop', directory: '' })).toBe(
		'https://github.com/octo/homebrew-tap/blob/HEAD/widget.json',
	);
});

test('the WinGet outcome reports an unsubmitted repository or the latest submission', () => {
	expect(wingetOutcome(undefined)).toEqual({ destination: 'winget', state: 'unsubmitted' });
	const plan = {
		id: '42:10',
		repositoryId: 42,
		repository: 'octo/widget',
		releaseId: 10,
		tag: 'v1.1.0',
		version: '1.1.0',
		packageIdentifier: 'Octo.Widget',
		sourceSha: 'a'.repeat(40),
		configurationSha: 'b'.repeat(64),
		files: {},
		digest: 'c'.repeat(64),
		releaseUrl: 'https://github.com/octo/widget/releases/tag/v1.1.0',
	};
	expect(wingetOutcome({ plan, state: 'pending', updatedAt: 1 })).toEqual({
		destination: 'winget',
		state: 'pending',
		version: '1.1.0',
	});
	expect(wingetOutcome({ plan, state: 'open', url: 'https://github.com/microsoft/winget-pkgs/pull/1', updatedAt: 1 }))
		.toEqual({
			destination: 'winget',
			state: 'open',
			version: '1.1.0',
			url: 'https://github.com/microsoft/winget-pkgs/pull/1',
		});
});

test('registry links carry the published version, and GoReleaser tags gain a single v', () => {
	const tool: Package = { ...widget, manager: 'goreleaser', name: 'octo/tool' };
	for (const version of ['1.2.0', 'v1.2.0']) {
		expect(destinationHref({ destination: 'github-release', state: 'published', version }, tool, 'octo/tool')).toBe(
			'https://github.com/octo/tool/releases/tag/v1.2.0',
		);
	}
	expect(destinationHref({ destination: 'github-release', state: 'missing' }, tool, 'octo/tool')).toBe(
		'https://github.com/octo/tool/releases',
	);
	expect(destinationHref({ destination: 'npm', state: 'published', version: '1.2.0' }, widget, 'octo/widget')).toBe(
		'https://www.npmjs.com/package/widget/v/1.2.0',
	);
	expect(destinationHref({ destination: 'npm', state: 'unchecked' }, widget, 'octo/widget')).toBe(
		'https://www.npmjs.com/package/widget',
	);
});
