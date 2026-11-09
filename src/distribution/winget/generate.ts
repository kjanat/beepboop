// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Kaj Kowalski; Copyright (c) 2021 rhysd
import { Effect } from 'effect';
import { stringify } from 'yaml';
import * as z from 'zod';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { plainText } from '@/distribution/winget/notes';
import type {
	DefaultLocaleManifest,
	InstallerManifest,
	ManifestType,
	VersionManifest,
} from '@/distribution/winget/schema';
import {
	defaultLocaleManifest,
	installerManifest,
	manifestTypes,
	schemaVersion,
	versionManifest,
} from '@/distribution/winget/schema';
import { fromSync } from '@/failure';
import { unsafeRelativePath } from '@/relative-path';

const metadata = defaultLocaleManifest.omit({
	PackageIdentifier: true,
	PackageVersion: true,
	PackageLocale: true,
	ReleaseNotes: true,
	ReleaseNotesUrl: true,
	ManifestType: true,
	ManifestVersion: true,
});
const installer = installerManifest.omit({
	PackageIdentifier: true,
	PackageVersion: true,
	InstallerLocale: true,
	ReleaseDate: true,
	Installers: true,
	ManifestType: true,
	ManifestVersion: true,
}).extend({ InstallerType: installerManifest.shape.InstallerType.unwrap() });
export const wingetConfiguration = z.strictObject({
	packageIdentifier: versionManifest.shape.PackageIdentifier,
	defaultLocale: versionManifest.shape.DefaultLocale.default('en-US'),
	releaseNotesUrl: z.string().min(1),
	metadata,
	installer,
	installers: z.array(z.strictObject({
		architecture: installerManifest.shape.Installers.element.shape.Architecture,
		asset: z.string().min(1),
		url: z.string().min(1),
	})).min(1).max(1024),
});
export type WingetConfiguration = z.input<typeof wingetConfiguration>;
export interface GenerateOptions {
	configuration: WingetConfiguration;
	version: string;
	tag?: string;
	releaseDate: string;
	checksums: string;
	releaseNotes: string;
}
export interface Manifests {
	version: VersionManifest;
	installer: InstallerManifest;
	defaultLocale: DefaultLocaleManifest;
}
export const releaseNotesLimit = 10000;
export function parseChecksums(source: string): Effect.Effect<Map<string, string>, DomainError> {
	return Effect.gen(function*() {
		const result = new Map<string, string>();
		for (const [index, line] of source.split(/\r?\n/).entries()) {
			if (!line) continue;
			const match = /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(line);
			if (!match?.[1] || !match[2]) return yield* precondition(`Malformed checksum line ${index + 1}`);
			if (result.has(match[2])) return yield* precondition(`Duplicate checksum for ${match[2]}`);
			result.set(match[2], match[1].toUpperCase());
		}
		return result;
	});
}
function expand(value: string, variables: Record<string, string>): Effect.Effect<string, DomainError> {
	const unknown = [...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1] ?? '').find(key =>
		!Object.hasOwn(variables, key)
	);
	return unknown === undefined
		? Effect.succeed(value.replace(/\{([^{}]+)\}/g, (_match, key: string) => variables[key] ?? ''))
		: Effect.fail(precondition(`Unknown template variable ${unknown}`));
}
function https(value: string): Effect.Effect<string, DomainError> {
	return fromSync(() => new URL(value)).pipe(
		Effect.filterOrFail(
			url => url.protocol === 'https:' && !url.username && !url.password && !url.hash,
			() => precondition('Expected an HTTPS release URL'),
		),
		Effect.as(value),
	);
}
export function capReleaseNotes(
	notes: string,
	url: string,
	limit = releaseNotesLimit,
): Effect.Effect<string, DomainError> {
	const trimmed = notes.replaceAll('\r\n', '\n').trim();
	if (trimmed.length <= limit) return Effect.succeed(trimmed);
	const tail = `\n\nFull release notes: ${url}`;
	if (tail.length >= limit) return Effect.fail(precondition('Release notes URL exceeds the length limit'));
	let cut = trimmed.lastIndexOf('\n\n', limit - tail.length);
	if (cut <= 0) cut = limit - tail.length;
	if (/[\uD800-\uDBFF]/.test(trimmed[cut - 1] ?? '')) cut--;
	return Effect.succeed(trimmed.slice(0, cut).trimEnd() + tail);
}
export function generateManifests(options: GenerateOptions): Effect.Effect<Manifests, DomainError> {
	return Effect.gen(function*() {
		const config = yield* fromSync(() => wingetConfiguration.parse(options.configuration));
		const version = options.version;
		if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
			return yield* precondition('Expected stable MAJOR.MINOR.PATCH version');
		}
		const tag = options.tag ?? `v${version}`;
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in release tags.
		if (!tag || /[\x00-\x20?#]/.test(tag)) return yield* precondition('Invalid release tag');
		const variables = { version, tag: encodeURIComponent(tag) };
		const checksums = yield* parseChecksums(options.checksums);
		const releaseNotesUrl = yield* https(yield* expand(config.releaseNotesUrl, variables));
		const entries: { Architecture: string; InstallerUrl: string; InstallerSha256: string }[] = [];
		for (const item of config.installers) {
			const asset = yield* expand(item.asset, variables);
			if (!asset || /[\\/]/.test(asset) || asset === '.' || asset === '..') {
				return yield* precondition('Expected an asset filename');
			}
			const digest = checksums.get(asset);
			if (!digest) return yield* precondition(`Checksum missing for ${asset}`);
			entries.push({
				Architecture: item.architecture,
				InstallerUrl: yield* https(yield* expand(item.url, { ...variables, asset: encodeURIComponent(asset) })),
				InstallerSha256: digest,
			});
		}
		if (new Set(entries.map(e => e.Architecture)).size !== entries.length) {
			return yield* precondition('Duplicate installer architecture');
		}
		for (
			const file of [
				...(config.installer.NestedInstallerFiles ?? []),
				...(config.installer.InstallationMetadata?.Files ?? []),
			]
		) {
			if (unsafeRelativePath(file.RelativeFilePath, ['..'])) {
				return yield* precondition('Unsafe installer relative path');
			}
		}
		if (
			config.installer.InstallerType === 'zip'
			&& (!config.installer.NestedInstallerType || !config.installer.NestedInstallerFiles?.length)
		) return yield* precondition('ZIP installers require nested installer metadata');
		const common = {
			PackageIdentifier: config.packageIdentifier,
			PackageVersion: version,
			ManifestVersion: schemaVersion,
		};
		const notes = yield* capReleaseNotes(plainText(options.releaseNotes), releaseNotesUrl);
		return yield* fromSync(() => ({
			version: versionManifest.parse({ ...common, DefaultLocale: config.defaultLocale, ManifestType: 'version' }),
			installer: installerManifest.parse({
				...config.installer,
				...common,
				InstallerLocale: config.defaultLocale,
				ReleaseDate: options.releaseDate,
				Installers: entries,
				ManifestType: 'installer',
			}),
			defaultLocale: defaultLocaleManifest.parse({
				...config.metadata,
				...common,
				PackageLocale: config.defaultLocale,
				...(notes ? { ReleaseNotes: notes } : {}),
				ReleaseNotesUrl: releaseNotesUrl,
				ManifestType: 'defaultLocale',
			}),
		}));
	});
}
export function renderManifests(manifests: Manifests): Record<string, string> {
	const id = manifests.version.PackageIdentifier, locale = manifests.version.DefaultLocale;
	const names: Record<ManifestType, string> = {
		version: `${id}.yaml`,
		installer: `${id}.installer.yaml`,
		defaultLocale: `${id}.locale.${locale}.yaml`,
	};
	return Object.fromEntries(
		manifestTypes.map(
			type => [
				names[type],
				`# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${schemaVersion}.schema.json\n\n`
				+ stringify(manifests[type], { indentSeq: false, lineWidth: 0, blockQuote: 'literal' }),
			],
		),
	);
}
