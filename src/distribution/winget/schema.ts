import { Schema } from 'effect';
import type { Decoded } from '@/schema';
import { matchesPattern, mutableArray, refined, strictStruct } from '@/schema';
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Kaj Kowalski; Copyright (c) 2021 rhysd

export const manifestTypes = ['version', 'installer', 'defaultLocale'] as const;
export type ManifestType = (typeof manifestTypes)[number];
export const schemaVersion = '1.12.0';

const versionPart = '(0|[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])';
const unique = (items: unknown[]): boolean => new Set(items.map(item => JSON.stringify(item))).size === items.length;

const packageIdentifier = Schema.String.check(
	// biome-ignore lint/suspicious/noControlCharactersInRegex: WinGet excludes ASCII control characters from identifiers.
	matchesPattern(/^[^.\s\\/:*?"<>|\x01-\x1f]{1,32}(\.[^.\s\\/:*?"<>|\x01-\x1f]{1,32}){1,7}$/),
).check(Schema.isMaxLength(128)).annotate({ description: 'The package unique identifier' });
// biome-ignore lint/suspicious/noControlCharactersInRegex: WinGet excludes ASCII control characters from package versions.
const packageVersion = Schema.String.check(matchesPattern(/^[^\\/:*?"<>|\x01-\x1f]+$/)).check(Schema.isMaxLength(128))
	.annotate({ description: 'The package version' });
const locale = Schema.String.check(
	matchesPattern(/^([a-zA-Z]{2,3}|[iI]-[a-zA-Z]+|[xX]-[a-zA-Z]{1,8})(-[a-zA-Z]{1,8})*$/),
).check(Schema.isMaxLength(20));
const manifestType = (type: ManifestType) => Schema.Literal(type).annotate({ description: 'The manifest type' });
const manifestVersion = Schema.String.check(matchesPattern(new RegExp(`^${versionPart}(\\.${versionPart}){2}$`)))
	.annotate({ description: 'The manifest syntax version' });
const minimumOSVersion = Schema.String.check(matchesPattern(new RegExp(`^${versionPart}(\\.${versionPart}){0,3}$`)));
const url = Schema.String.check(matchesPattern(/^([Hh][Tt][Tt][Pp][Ss]?):\/\/.+$/)).check(Schema.isMaxLength(2048));
const sha256 = Schema.String.check(matchesPattern(/^[A-Fa-f0-9]{64}$/));
const installerReturnCode = refined(
	Schema.Int.check(Schema.isGreaterThanOrEqualTo(-2147483648)).check(Schema.isLessThanOrEqualTo(4294967295)),
	code => code !== 0,
).annotate({ description: 'An exit code that can be returned by the installer after execution' });

export const versionManifest = strictStruct({
	PackageIdentifier: packageIdentifier,
	PackageVersion: packageVersion,
	DefaultLocale: locale.annotate({ description: 'The default package meta-data locale' }),
	ManifestType: manifestType('version'),
	ManifestVersion: manifestVersion,
});

export const installerType = Schema.Literals([
	'msix',
	'msi',
	'appx',
	'exe',
	'zip',
	'inno',
	'nullsoft',
	'wix',
	'burn',
	'pwa',
	'portable',
	'font',
]);
export const installerArchitecture = Schema.Literals(['x86', 'x64', 'arm', 'arm64', 'neutral']);

export const installerManifest = strictStruct({
	PackageIdentifier: packageIdentifier,
	PackageVersion: packageVersion,
	InstallerLocale: Schema.optional(locale).annotate({ description: 'The installer meta-data locale' }),
	Platform: Schema.optional(
		refined(
			mutableArray(Schema.Literals(['Windows.Desktop', 'Windows.Universal'])).check(Schema.isMaxLength(2)),
			unique,
		),
	).annotate({ description: 'The installer supported operating system' }),
	MinimumOSVersion: Schema.optional(minimumOSVersion).annotate({
		description: 'The installer minimum operating system version',
	}),
	InstallerType: Schema.optional(installerType).annotate({
		description:
			'Enumeration of supported installer types. InstallerType is required in either root level or individual Installer level',
	}),
	NestedInstallerType: Schema.optional(
		Schema.Literals(['msix', 'msi', 'appx', 'exe', 'inno', 'nullsoft', 'wix', 'burn', 'portable', 'font']),
	).annotate({ description: 'Enumeration of supported nested installer types contained inside an archive file' }),
	NestedInstallerFiles: Schema.optional(
		mutableArray(
			strictStruct({
				RelativeFilePath: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(512)).annotate({
					description: 'The relative path to the nested installer file',
				}),
				PortableCommandAlias: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(40)))
					.annotate({
						description:
							'The command alias to be used for calling the package. Only applies to the nested portable package',
					}),
			}).annotate({ description: 'A nested installer file contained inside an archive' }),
		).check(Schema.isMaxLength(1024)),
	).annotate({ description: 'List of nested installer files contained inside an archive' }),
	Scope: Schema.optional(Schema.Literals(['user', 'machine'])).annotate({
		description: 'Scope indicates if the installer is per user or per machine',
	}),
	InstallerSuccessCodes: Schema.optional(
		refined(mutableArray(installerReturnCode).check(Schema.isMaxLength(16)), unique),
	).annotate({
		description: 'List of additional non-zero installer success exit codes other than known default values by winget',
	}),
	UpgradeBehavior: Schema.optional(Schema.Literals(['install', 'uninstallPrevious', 'deny'])).annotate({
		description: 'The upgrade method',
	}),
	Commands: Schema.optional(
		refined(
			mutableArray(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(40))).check(
				Schema.isMaxLength(16),
			),
			unique,
		),
	).annotate({ description: 'List of commands or aliases to run the package' }),
	ReleaseDate: Schema.optional(Schema.String.check(matchesPattern(/^\d{4}-\d{2}-\d{2}$/))).annotate({
		description: 'The installer release date',
	}),
	InstallationMetadata: Schema.optional(strictStruct({
		DefaultInstallLocation: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(2048)))
			.annotate({
				description: 'Represents the default installed package location. Used for deeper installation detection.',
			}),
		Files: Schema.optional(refined(
			mutableArray(
				strictStruct({
					RelativeFilePath: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(2048)).annotate({
						description: 'The relative path to the installed file.',
					}),
					FileSha256: Schema.optional(sha256).annotate({ description: 'Optional Sha256 of the installed file.' }),
					FileType: Schema.optional(Schema.Literals(['launch', 'uninstall', 'other'])).annotate({
						description: 'The optional installed file type. If not specified, the file is treated as other.',
					}),
					InvocationParameter: Schema.optional(
						Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(2048)),
					).annotate({ description: 'Optional parameter for invocable files.' }),
					DisplayName: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))
						.annotate({ description: 'Optional display name for invocable files.' }),
				}).annotate({ description: 'Represents an installed file.' }),
			).check(Schema.isMaxLength(2048)),
			unique,
		)).annotate({ description: 'List of installed files.' }),
	})).annotate({ description: 'Details about the installation. Used for deeper installation detection.' }),
	Installers: mutableArray(strictStruct({
		Architecture: installerArchitecture.annotate({ description: 'The installer target architecture' }),
		InstallerUrl: url.annotate({ description: 'The installer Url' }),
		InstallerSha256: sha256.annotate({ description: 'Sha256 is required. Sha256 of the installer' }),
	})).check(Schema.isMinLength(1)).check(Schema.isMaxLength(1024)),
	ManifestType: manifestType('installer'),
	ManifestVersion: manifestVersion,
});

export const defaultLocaleManifest = strictStruct({
	PackageIdentifier: packageIdentifier,
	PackageVersion: packageVersion,
	PackageLocale: locale.annotate({ description: 'The package meta-data locale' }),
	Publisher: Schema.String.check(Schema.isMinLength(2)).check(Schema.isMaxLength(256)).annotate({
		description: 'The publisher name',
	}),
	PublisherUrl: Schema.optional(url).annotate({ description: 'The publisher home page' }),
	PublisherSupportUrl: Schema.optional(url).annotate({ description: 'The publisher support page' }),
	Author: Schema.optional(Schema.String.check(Schema.isMinLength(2)).check(Schema.isMaxLength(256))).annotate({
		description: 'The package author',
	}),
	PackageName: Schema.String.check(Schema.isMinLength(2)).check(Schema.isMaxLength(256)).annotate({
		description: 'The package name',
	}),
	PackageUrl: Schema.optional(url).annotate({ description: 'The package home page' }),
	License: Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(512)).annotate({
		description: 'The package license',
	}),
	LicenseUrl: Schema.optional(url).annotate({ description: 'The license page' }),
	Copyright: Schema.optional(Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(512))).annotate({
		description: 'The package copyright',
	}),
	CopyrightUrl: Schema.optional(url).annotate({ description: 'The package copyright page' }),
	ShortDescription: Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(256)).annotate({
		description: 'The short package description',
	}),
	Description: Schema.optional(Schema.String.check(Schema.isMinLength(3)).check(Schema.isMaxLength(10000))).annotate({
		description: 'The full package description',
	}),
	Tags: Schema.optional(
		refined(
			mutableArray(
				Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(40)).annotate({
					description: 'Package moniker or tag',
				}),
			).check(Schema.isMaxLength(16)),
			unique,
		),
	).annotate({ description: 'List of additional package search terms' }),
	ReleaseNotes: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(10000))).annotate({
		description: 'The package release notes',
	}),
	ReleaseNotesUrl: Schema.optional(url).annotate({ description: 'The package release notes url' }),
	InstallationNotes: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(10000)))
		.annotate({ description: 'The notes displayed to the user upon completion of a package installation.' }),
	Documentations: Schema.optional(
		mutableArray(strictStruct({
			DocumentLabel: Schema.optional(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(100)))
				.annotate({
					description:
						'The label of the documentation for providing software guides such as manuals and troubleshooting URLs.',
				}),
			DocumentUrl: Schema.optional(url).annotate({ description: 'The documentation URL.' }),
		})).check(Schema.isMaxLength(256)),
	),
	ManifestType: manifestType('defaultLocale'),
	ManifestVersion: manifestVersion,
});

export type VersionManifest = Decoded<typeof versionManifest>;
export type InstallerManifest = Decoded<typeof installerManifest>;
export type DefaultLocaleManifest = Decoded<typeof defaultLocaleManifest>;
