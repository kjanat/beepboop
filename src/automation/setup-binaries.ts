import { pinned } from '@/automation/setup-actions';
import type { AssetPlaceholder, BinaryBuild, BinaryRelease, BinaryTarget } from '@/contract/setup';

interface Platform {
	names: Record<Exclude<AssetPlaceholder, 'name' | 'version'>, string>;
	runner: string;
}
function platform(
	go: [string, string],
	rust: string,
	node: [string, string],
	uname: [string, string],
	runner: string,
): Platform {
	return {
		names: {
			ext: go[0] === 'windows' ? '.exe' : '',
			'go.os': go[0],
			'go.arch': go[1],
			'rust.target': rust,
			'node.platform': node[0],
			'node.arch': node[1],
			'uname.os': uname[0],
			'uname.arch': uname[1],
		},
		runner,
	};
}
const platforms: Record<BinaryTarget, Platform> = {
	'linux-amd64': platform(
		['linux', 'amd64'],
		'x86_64-unknown-linux-gnu',
		['linux', 'x64'],
		['Linux', 'x86_64'],
		'ubuntu-latest',
	),
	'linux-arm64': platform(
		['linux', 'arm64'],
		'aarch64-unknown-linux-gnu',
		['linux', 'arm64'],
		['Linux', 'aarch64'],
		'ubuntu-24.04-arm',
	),
	'darwin-amd64': platform(
		['darwin', 'amd64'],
		'x86_64-apple-darwin',
		['darwin', 'x64'],
		['Darwin', 'x86_64'],
		'macos-15-intel',
	),
	'darwin-arm64': platform(
		['darwin', 'arm64'],
		'aarch64-apple-darwin',
		['darwin', 'arm64'],
		['Darwin', 'arm64'],
		'macos-latest',
	),
	'windows-amd64': platform(
		['windows', 'amd64'],
		'x86_64-pc-windows-msvc',
		['win32', 'x64'],
		['Windows', 'x86_64'],
		'windows-latest',
	),
	'windows-arm64': platform(
		['windows', 'arm64'],
		'aarch64-pc-windows-msvc',
		['win32', 'arm64'],
		['Windows', 'aarch64'],
		'windows-11-arm',
	),
};

// GitHub expressions, evaluated by Actions rather than JavaScript.
export const expression = (value: string) => `\${{ ${value} }}`;
const matrix = (key: string) => expression(`matrix.${key}`);

export const beginJobId = 'begin';
const begun = (output: 'sourceSha' | 'version') => expression(`needs.${beginJobId}.outputs.${output}`);
export const begunSource = begun('sourceSha');

export function assetName(build: BinaryBuild, target: BinaryTarget): string {
	const names: Record<string, string> = { ...platforms[target].names, name: build.name, version: '{version}' };
	return build.asset.replace(/\{([\w.]+)\}/g, (_, key: string) => names[key] ?? '');
}

export function assetConflicts(release: BinaryRelease): string[] {
	const seen = new Map<string, string>(), conflicts: string[] = [];
	for (const build of release.builds) {
		for (const target of release.targets) {
			const asset = assetName(build, target), owner = `${build.name} ${target}`;
			const previous = seen.get(asset);
			if (previous) conflicts.push(`${previous} and ${owner} both produce ${asset}`);
			else seen.set(asset, owner);
		}
	}
	return conflicts;
}

export function buildJobId(build: BinaryBuild): string {
	return `build-${build.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`;
}

interface Toolchain {
	label: string;
	runner: string;
	include: Record<string, string>[];
	setup: Record<string, unknown>[];
	build: { env: Record<string, string>; run: string };
}
function toolchain(build: BinaryBuild, targets: readonly BinaryTarget[]): Toolchain {
	if (build.toolchain === 'go') {
		return {
			label: `${matrix('goos')}/${matrix('goarch')}`,
			runner: 'ubuntu-latest',
			include: targets.map(target => ({
				goos: platforms[target].names['go.os'],
				goarch: platforms[target].names['go.arch'],
				asset: assetName(build, target),
			})),
			setup: [{
				uses: pinned('setupGo'),
				with: { 'go-version-file': `${build.module}/go.mod`, 'cache-dependency-path': `${build.module}/go.sum` },
			}],
			build: {
				env: {
					CGO_ENABLED: '0',
					GOOS: matrix('goos'),
					GOARCH: matrix('goarch'),
					MODULE: build.module,
					PACKAGE: build.package,
				},
				run: `go build -C "\${MODULE}" -trimpath -ldflags "-s -w -X main.version=\${VERSION}" \\
  -o "\${GITHUB_WORKSPACE}/dist/\${ASSET}" "\${PACKAGE}"
`,
			},
		};
	}
	return {
		label: matrix('target'),
		runner: matrix('runner'),
		include: targets.map(target => ({
			runner: platforms[target].runner,
			target: platforms[target].names['rust.target'],
			ext: platforms[target].names.ext,
			asset: assetName(build, target),
		})),
		setup: [],
		build: {
			env: { MANIFEST: build.manifest, BINARY: build.name, TARGET: matrix('target'), EXT: matrix('ext') },
			run: `rustup target add "\${TARGET}"
cargo build --manifest-path "\${MANIFEST}" --release --locked --bin "\${BINARY}" --target "\${TARGET}"
target="$(cargo metadata --manifest-path "\${MANIFEST}" --format-version 1 --no-deps | jq -r .target_directory)"
cp "\${target}/\${TARGET}/release/\${BINARY}\${EXT}" "dist/\${ASSET}"
`,
		},
	};
}

export function binaryJobs(
	release: BinaryRelease,
	begin: Record<string, unknown>,
	id: string,
): Record<string, Record<string, unknown>> {
	const context = `fromJSON(steps.${id}.outputs.context)`;
	const builds = release.builds.map(build => {
		const { label, runner, include, setup, build: step } = toolchain(build, release.targets);
		return [buildJobId(build), {
			name: `Build ${build.name} (${label})`,
			needs: [beginJobId],
			'runs-on': runner,
			'timeout-minutes': 240,
			permissions: { contents: 'read' },
			strategy: { 'fail-fast': true, matrix: { include } },
			steps: [
				{ uses: pinned('checkout'), with: { ref: begunSource, 'persist-credentials': false } },
				...setup,
				{
					id: 'asset',
					name: 'Name the release asset',
					shell: 'bash',
					env: { VERSION: begun('version'), TEMPLATE: matrix('asset') },
					run: `mkdir -p dist
echo "name=\${TEMPLATE//\\{version\\}/\${VERSION}}" >> "\${GITHUB_OUTPUT}"
`,
				},
				{
					name: `Build ${build.name}`,
					shell: 'bash',
					env: {
						...step.env,
						VERSION: begun('version'),
						ASSET: expression('steps.asset.outputs.name'),
					},
					run: step.run,
				},
				{
					uses: pinned('upload'),
					with: {
						name: expression('steps.asset.outputs.name'),
						path: `dist/${expression('steps.asset.outputs.name')}`,
						'if-no-files-found': 'error',
					},
				},
			],
		}];
	});
	return Object.fromEntries([
		[beginJobId, {
			name: 'Begin release',
			'runs-on': 'ubuntu-latest',
			'timeout-minutes': 10,
			permissions: { contents: 'read', 'id-token': 'write' },
			outputs: { sourceSha: expression(`${context}.sourceSha`), version: expression(`${context}.version`) },
			steps: [{ uses: pinned('checkout'), with: { 'persist-credentials': false } }, begin],
		}],
		...builds,
	]);
}

export function releaseSteps(id: string, action: (name: string) => string): Record<string, unknown>[] {
	const sbom = `dist/${expression('github.event.repository.name')}.spdx.json`;
	return [
		{ uses: pinned('download'), with: { path: 'dist', 'merge-multiple': true } },
		{
			name: 'Write checksums',
			shell: 'bash',
			'working-directory': 'dist',
			run: 'sha256sum -- * > checksums.txt\n',
		},
		{
			uses: pinned('sbom'),
			with: {
				path: 'dist',
				format: 'spdx-json',
				'output-file': sbom,
				'upload-artifact': false,
				'upload-release-assets': false,
			},
		},
		{ uses: pinned('attest'), with: { 'subject-checksums': 'dist/checksums.txt' } },
		{ uses: pinned('attest'), with: { 'subject-checksums': 'dist/checksums.txt', 'sbom-path': sbom } },
		{
			id: 'beepboop_binaries',
			name: 'Upload binaries to the draft release',
			shell: 'bash',
			'working-directory': 'dist',
			env: {
				GH_TOKEN: expression('github.token'),
				GH_REPO: expression('github.repository'),
				TAG: expression(`fromJSON(steps.${id}.outputs.context).draftRelease.tag`),
			},
			run: `gh release upload "\${TAG}" -- *\n`,
		},
		...refSteps(id, action),
		{ uses: action('publish-release'), with: { 'execution-id': expression(`steps.${id}.outputs.execution-id`) } },
	];
}

/** Tags pushed with `github.token` start no workflows, so the push uses the App installation token. */
export function refSteps(id: string, action: (name: string) => string): Record<string, unknown>[] {
	return [
		{
			id: 'beepboop_token',
			uses: action('token'),
			with: { 'execution-id': expression(`steps.${id}.outputs.execution-id`), 'permission-contents': 'write' },
		},
		{
			id: 'beepboop_refs',
			uses: action('publish-refs'),
			env: gitIdentity('beepboop_token'),
			with: { token: expression('steps.beepboop_token.outputs.token') },
		},
	];
}
export function gitIdentity(tokenStep: string): Record<string, string> {
	return { [expression('insert')]: expression(`fromJSON(steps.${tokenStep}.outputs.gitId || '{}')`) };
}
