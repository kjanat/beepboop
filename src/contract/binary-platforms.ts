import type { AssetPlaceholder, BinaryTarget } from '@/contract/setup';
export interface Platform {
	names: Record<Exclude<AssetPlaceholder, 'name' | 'version'>, string>;
	runner: string;
	cargo: 'native' | 'cross' | false;
	image?: string;
	go: boolean;
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
		cargo: 'native',
		go: true,
	};
}
export const platforms: Record<BinaryTarget, Platform> = {
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
	'android-amd64': {
		...platform(['android', 'amd64'], 'x86_64-linux-android', ['android', 'x64'], ['Linux', 'x86_64'], 'ubuntu-latest'),
		cargo: 'cross',
		image:
			'ghcr.io/cross-rs/x86_64-linux-android@sha256:5779721607756da8c49c032edc5f82970f7295d3a42c2ab4cba49e69ba40a18d',
		go: false,
	},
	'android-arm64': {
		...platform(
			['android', 'arm64'],
			'aarch64-linux-android',
			['android', 'arm64'],
			['Linux', 'aarch64'],
			'ubuntu-latest',
		),
		cargo: 'cross',
		image:
			'ghcr.io/cross-rs/aarch64-linux-android@sha256:b081e122d075268e8f528b914ae0b2d0c6dc4dc4921ab05da86cc44726f4e2a0',
		go: false,
	},
	'android-arm': {
		...platform(['android', 'arm'], 'armv7-linux-androideabi', ['android', 'arm'], ['Linux', 'arm'], 'ubuntu-latest'),
		cargo: 'cross',
		image:
			'ghcr.io/cross-rs/armv7-linux-androideabi@sha256:a930d41f9acf6cae27c9c99b72e673cb11e973859a1c5a909769d0921bb4a83c',
		go: false,
	},
	'android-386': {
		...platform(['android', '386'], 'i686-linux-android', ['android', 'ia32'], ['Linux', '386'], 'ubuntu-latest'),
		cargo: 'cross',
		image:
			'ghcr.io/cross-rs/i686-linux-android@sha256:7d8fc923d8aa0645aff4b73815c86effceef7375a6244d31c8e69486395be78d',
		go: false,
	},
	'freebsd-amd64': {
		...platform(
			['freebsd', 'amd64'],
			'x86_64-unknown-freebsd',
			['freebsd', 'x64'],
			['FreeBSD', 'x86_64'],
			'ubuntu-latest',
		),
		cargo: 'cross',
		go: true,
	},
	'freebsd-386': {
		...platform(['freebsd', '386'], 'i686-unknown-freebsd', ['freebsd', 'ia32'], ['FreeBSD', '386'], 'ubuntu-latest'),
		cargo: 'cross',
		go: true,
	},
	'freebsd-arm64': {
		...platform(['freebsd', 'arm64'], '', ['freebsd', 'arm64'], ['FreeBSD', 'aarch64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'netbsd-amd64': {
		...platform(['netbsd', 'amd64'], 'x86_64-unknown-netbsd', ['netbsd', 'x64'], ['NetBSD', 'x86_64'], 'ubuntu-latest'),
		cargo: 'cross',
		go: true,
	},
	'netbsd-arm64': {
		...platform(['netbsd', 'arm64'], '', ['netbsd', 'arm64'], ['NetBSD', 'aarch64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'openbsd-amd64': {
		...platform(['openbsd', 'amd64'], '', ['openbsd', 'x64'], ['OpenBSD', 'x86_64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'openbsd-arm64': {
		...platform(['openbsd', 'arm64'], '', ['openbsd', 'arm64'], ['OpenBSD', 'aarch64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'dragonfly-amd64': {
		...platform(['dragonfly', 'amd64'], '', ['dragonfly', 'x64'], ['DragonFly', 'x86_64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'solaris-amd64': {
		...platform(['solaris', 'amd64'], '', ['sunos', 'x64'], ['SunOS', 'x86_64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'illumos-amd64': {
		...platform(['illumos', 'amd64'], '', ['sunos', 'x64'], ['SunOS', 'x86_64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
	'aix-ppc64': {
		...platform(['aix', 'ppc64'], '', ['aix', 'ppc64'], ['AIX', 'ppc64'], 'ubuntu-latest'),
		cargo: false,
		go: true,
	},
};

export function supportedTargets(toolchain: 'go' | 'cargo'): BinaryTarget[] {
	return (Object.keys(platforms) as BinaryTarget[]).filter(target => !!platforms[target][toolchain]);
}
