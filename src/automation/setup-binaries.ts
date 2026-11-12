import { object } from '@/automation/managers/helpers';
import { pinned } from '@/automation/setup-actions';
import { platforms } from '@/contract/binary-platforms';
import type { BinaryBuild, BinaryRelease, BinaryTarget } from '@/contract/setup';

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

export interface BinaryLeg {
	build: string;
	target: BinaryTarget;
	job: string;
	asset: string;
}
export function binaryLegs(release: BinaryRelease, version: string): BinaryLeg[] {
	return release.builds.flatMap(build =>
		release.targets.map(target => {
			const names = platforms[target].names;
			const label = build.toolchain === 'go' ? `${names['go.os']}/${names['go.arch']}` : names['rust.target'];
			return {
				build: build.name,
				target,
				job: `Build ${build.name} (${label})`,
				asset: assetName(build, target).replaceAll('{version}', version),
			};
		})
	);
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

const cargoAuditable = '0.7.7';

interface Toolchain {
	label: string;
	runner: string;
	include: Record<string, string>[];
	setup: Record<string, unknown>[];
	build: { env: Record<string, string>; run: string };
}
function toolchain(build: BinaryBuild, targets: readonly BinaryTarget[]): Toolchain {
	for (const target of targets) {
		if (!platforms[target][build.toolchain]) throw new Error(`${build.toolchain} has no build recipe for ${target}`);
	}
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
	const cross = targets.some(target => platforms[target].cargo === 'cross');
	return {
		label: matrix('target'),
		runner: matrix('runner'),
		include: targets.map(target => ({
			runner: platforms[target].runner,
			...(cross ? { builder: platforms[target].cargo === 'cross' ? 'cross' : 'cargo' } : {}),
			target: platforms[target].names['rust.target'],
			ext: platforms[target].names.ext,
			asset: assetName(build, target),
		})),
		setup: [
			{ uses: pinned('install'), with: { tool: `cargo-auditable@${cargoAuditable}`, fallback: 'none' } },
			...(cross
				? [{
					uses: pinned('install'),
					if: "matrix.builder == 'cross'",
					with: { tool: 'cross@0.2.5', fallback: 'none' },
				}]
				: []),
		],
		build: {
			env: {
				...Object.fromEntries(targets.flatMap(target => {
					const platform = platforms[target];
					return platform.image
						? [[
							`CROSS_TARGET_${platform.names['rust.target'].toUpperCase().replaceAll('-', '_')}_IMAGE`,
							platform.image,
						]]
						: [];
				})),
				MANIFEST: build.manifest,
				BINARY: build.name,
				TARGET: matrix('target'),
				EXT: matrix('ext'),
				...(cross ? { BUILDER: matrix('builder') } : {}),
			},
			run: `${
				cross
					? `if [[ "\${BUILDER}" == cross ]]; then
  cross build --manifest-path "\${MANIFEST}" --release --locked --bin "\${BINARY}" --target "\${TARGET}"
else
  rustup target add "\${TARGET}"
  cargo auditable build --manifest-path "\${MANIFEST}" --release --locked --bin "\${BINARY}" --target "\${TARGET}"
fi`
					: `rustup target add "\${TARGET}"
cargo auditable build --manifest-path "\${MANIFEST}" --release --locked --bin "\${BINARY}" --target "\${TARGET}"`
			}
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
	return [
		...assetSteps(id),
		...refSteps(id, action),
		{ uses: action('publish-release'), with: { 'execution-id': expression(`steps.${id}.outputs.execution-id`) } },
	];
}
export function assetSteps(id: string): Record<string, unknown>[] {
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
			env: {
				SYFT_SOURCE_NAME: expression('github.event.repository.name'),
				SYFT_SOURCE_VERSION: expression(`fromJSON(steps.${id}.outputs.context).version`),
				SYFT_FILE_METADATA_SELECTION: 'all',
				SYFT_SELECT_CATALOGERS: '-pe-package',
			},
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
	];
}
export function ownedBinaryJob(name: string, job: Record<string, unknown>): boolean {
	const steps = Array.isArray(job.steps) ? job.steps.map(object) : [];
	return (name === beginJobId || name.startsWith('build-'))
		&& steps.some(step =>
			(typeof step.uses === 'string' && /\/actions\/begin\b/.test(step.uses))
			|| (name !== beginJobId && object(step.with).ref === begunSource)
		);
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
