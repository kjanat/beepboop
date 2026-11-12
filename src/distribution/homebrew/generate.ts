import { Effect } from 'effect';
import * as z from 'zod';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { assetName, checksumOf, expand, https, parseChecksums, releaseTag } from '@/distribution/assets';
import { fromSync } from '@/failure';

const text = z.string().min(1);
const stagedPath = text.refine(
	path => !path.startsWith('/') && !path.split('/').some(part => part === '..' || part === ''),
	'Expected a relative path inside the staged cask',
);
const platform = z.strictObject({ arm: text, intel: text, caveats: text.optional() });
const shells = ['bash', 'zsh', 'fish', 'pwsh'] as const;
const completionDirectories: Record<(typeof shells)[number], string> = {
	bash: 'etc/bash_completion.d',
	zsh: 'share/zsh/site-functions',
	fish: 'share/fish/vendor_completions.d',
	pwsh: 'share/pwsh/completions',
};

export const homebrewConfiguration = z.strictObject({
	token: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
	name: text,
	desc: text,
	homepage: text,
	url: text,
	verified: text.optional(),
	macos: platform.optional(),
	linux: platform.optional(),
	naked: z.strictObject({ glob: text, name: stagedPath }).optional(),
	binaries: z.array(z.strictObject({ path: stagedPath, target: stagedPath.optional() })).min(1),
	completions: z.strictObject({
		executable: stagedPath,
		arguments: z.array(text).min(1),
		shells: z.array(z.enum(shells)).min(1),
	}).optional(),
	caveats: text.optional(),
}).refine(config => config.macos !== undefined || config.linux !== undefined, 'Expected macos or linux assets')
	.refine(
		config => !(config.naked && config.macos && config.linux),
		'Expected one platform, macos or linux, with naked',
	);
export type HomebrewConfiguration = z.input<typeof homebrewConfiguration>;

export interface CaskOptions {
	configuration: HomebrewConfiguration;
	version: string;
	tag?: string;
	checksums: string;
}

const symbolicVersion = '#{version}';

function ruby(value: string): string {
	return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('#{', '\\#{')}"`;
}

function nest(lines: readonly string[]): string[] {
	return lines.map(line => line ? `  ${line}` : line);
}

function block(head: string, body: readonly string[]): string[] {
	return [`${head} do`, ...nest(body), 'end'];
}

function sections(...groups: readonly (readonly string[])[]): string[] {
	return groups.filter(group => group.length).flatMap((group, index) => index ? ['', ...group] : [...group]);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function livecheck(version: string, tag: string): string[] {
	const [prefix = '', suffix = ''] = tag.split(version);
	const plain = suffix === '' && (prefix === '' || prefix === 'v');
	return block('livecheck', [
		'url :url',
		...(plain ? [] : [`regex(/^${escapeRegex(prefix)}(\\d+(?:\\.\\d+)+)${escapeRegex(suffix)}$/i)`]),
		'strategy :github_latest',
	]);
}

function variant(
	config: z.output<typeof homebrewConfiguration>,
	asset: string,
	checksums: ReadonlyMap<string, string>,
	version: string,
	tag: string,
): Effect.Effect<string[], DomainError> {
	return Effect.gen(function*() {
		const name = yield* assetName(asset, { version });
		const sha256 = yield* checksumOf(checksums, name);
		yield* https(yield* expand(config.url, { version, tag: encodeURIComponent(tag), asset: encodeURIComponent(name) }));
		const url = yield* expand(config.url, {
			version: symbolicVersion,
			tag: encodeURIComponent(tag).replaceAll(version, symbolicVersion),
			asset: encodeURIComponent(yield* assetName(asset, { version: symbolicVersion })).replaceAll(
				encodeURIComponent(symbolicVersion),
				symbolicVersion,
			),
		});
		return [
			`version ${ruby(version)}`,
			`sha256 ${ruby(sha256)}`,
			...(config.verified
				? [
					`url ${ruby(url).replaceAll(`\\${symbolicVersion}`, symbolicVersion)},`,
					`    verified: ${ruby(config.verified)}`,
				]
				: [`url ${ruby(url).replaceAll(`\\${symbolicVersion}`, symbolicVersion)}`]),
		];
	});
}

export function generateCask(options: CaskOptions): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const config = yield* fromSync(() => homebrewConfiguration.parse(options.configuration));
		const version = options.version;
		const tag = yield* releaseTag(version, options.tag);
		if (!tag.includes(version)) return yield* precondition(`Release tag ${tag} does not contain ${version}`);
		const checksums = yield* parseChecksums(options.checksums);
		yield* https(config.homepage);
		const platforms: string[] = [];
		for (const [os, assets] of [['on_macos', config.macos], ['on_linux', config.linux]] as const) {
			if (!assets) continue;
			const arm = yield* variant(config, assets.arm, checksums, version, tag);
			const intel = yield* variant(config, assets.intel, checksums, version, tag);
			platforms.push(
				...block(os, [
					...block('on_arm', arm),
					...block('on_intel', intel),
					...(assets.caveats ? [`caveats ${ruby(assets.caveats)}`] : []),
				]),
			);
		}
		const completions = config.completions;
		const call = 'generate_completions_from_executable';
		const artifacts = [
			...(config.naked ? ['container type: :naked'] : []),
			...config.binaries.map(binary =>
				`binary ${ruby(binary.path)}${binary.target ? `, target: ${ruby(binary.target)}` : ''}`
			),
			...(completions
				? [
					`${call} ${[completions.executable, ...completions.arguments].map(ruby).join(', ')},`,
					`${' '.repeat(call.length + 1)}base_name: ${ruby(completions.executable.split('/').at(-1) ?? '')},`,
					`${' '.repeat(call.length + 1)}shells:    [${completions.shells.map(shell => `:${shell}`).join(', ')}]`,
				]
				: []),
		];
		const steps = [
			...(config.naked
				? [
					`move ${ruby(config.naked.glob)}, ${ruby(config.naked.name)}, source_glob: true`,
					`set_permissions ${ruby(config.naked.name)}, "755", recursive: false`,
				]
				: []),
			...(completions?.shells ?? []).map(shell =>
				`mkdir_p ${ruby(completionDirectories[shell])}, base: :homebrew_prefix`
			),
			...(config.macos
				? block('on_macos', ['run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{staged_path}}"]'])
				: []),
		];
		const body = sections(
			platforms,
			[`name ${ruby(config.name)}`, `desc ${ruby(config.desc)}`, `homepage ${ruby(config.homepage)}`],
			livecheck(version, tag),
			artifacts,
			steps.length ? block('preflight_steps', steps) : [],
			config.caveats ? [`caveats ${ruby(config.caveats)}`] : [],
			['zap :not_required'],
		);
		return ['# frozen_string_literal: true', '', ...block(`cask ${ruby(config.token)}`, body), ''].join('\n');
	});
}
