import { hostedRunners } from '@/contract/runners';
import type { AssetPlaceholder, BinaryTarget } from '@/contract/setup';
export interface Platform {
	names: Record<Exclude<AssetPlaceholder, 'name' | 'version'>, string>;
	runner: string;
	cargo: 'native' | 'cross' | false;
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
		hostedRunners.linux,
	),
	'linux-arm64': platform(
		['linux', 'arm64'],
		'aarch64-unknown-linux-gnu',
		['linux', 'arm64'],
		['Linux', 'aarch64'],
		hostedRunners.linuxArm64,
	),
	'darwin-amd64': platform(
		['darwin', 'amd64'],
		'x86_64-apple-darwin',
		['darwin', 'x64'],
		['Darwin', 'x86_64'],
		hostedRunners.macosIntel,
	),
	'darwin-arm64': platform(
		['darwin', 'arm64'],
		'aarch64-apple-darwin',
		['darwin', 'arm64'],
		['Darwin', 'arm64'],
		hostedRunners.macos,
	),
	'windows-amd64': platform(
		['windows', 'amd64'],
		'x86_64-pc-windows-msvc',
		['win32', 'x64'],
		['Windows', 'x86_64'],
		hostedRunners.windows,
	),
	'windows-arm64': platform(
		['windows', 'arm64'],
		'aarch64-pc-windows-msvc',
		['win32', 'arm64'],
		['Windows', 'aarch64'],
		hostedRunners.windowsArm64,
	),
	'android-amd64': {
		...platform(
			['android', 'amd64'],
			'x86_64-linux-android',
			['android', 'x64'],
			['Linux', 'x86_64'],
			hostedRunners.linux,
		),
		cargo: 'cross',
		go: false,
	},
	'android-arm64': {
		...platform(
			['android', 'arm64'],
			'aarch64-linux-android',
			['android', 'arm64'],
			['Linux', 'aarch64'],
			hostedRunners.linux,
		),
		cargo: 'cross',
		go: false,
	},
	'android-arm': {
		...platform(
			['android', 'arm'],
			'armv7-linux-androideabi',
			['android', 'arm'],
			['Linux', 'arm'],
			hostedRunners.linux,
		),
		cargo: 'cross',
		go: false,
	},
	'android-386': {
		...platform(['android', '386'], 'i686-linux-android', ['android', 'ia32'], ['Linux', '386'], hostedRunners.linux),
		cargo: 'cross',
		go: false,
	},
	'freebsd-amd64': {
		...platform(
			['freebsd', 'amd64'],
			'x86_64-unknown-freebsd',
			['freebsd', 'x64'],
			['FreeBSD', 'x86_64'],
			hostedRunners.linux,
		),
		cargo: 'cross',
		go: true,
	},
	'freebsd-386': {
		...platform(
			['freebsd', '386'],
			'i686-unknown-freebsd',
			['freebsd', 'ia32'],
			['FreeBSD', '386'],
			hostedRunners.linux,
		),
		cargo: 'cross',
		go: true,
	},
	'freebsd-arm64': {
		...platform(['freebsd', 'arm64'], '', ['freebsd', 'arm64'], ['FreeBSD', 'aarch64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'netbsd-amd64': {
		...platform(
			['netbsd', 'amd64'],
			'x86_64-unknown-netbsd',
			['netbsd', 'x64'],
			['NetBSD', 'x86_64'],
			hostedRunners.linux,
		),
		cargo: 'cross',
		go: true,
	},
	'netbsd-arm64': {
		...platform(['netbsd', 'arm64'], '', ['netbsd', 'arm64'], ['NetBSD', 'aarch64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'openbsd-amd64': {
		...platform(['openbsd', 'amd64'], '', ['openbsd', 'x64'], ['OpenBSD', 'x86_64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'openbsd-arm64': {
		...platform(['openbsd', 'arm64'], '', ['openbsd', 'arm64'], ['OpenBSD', 'aarch64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'dragonfly-amd64': {
		...platform(['dragonfly', 'amd64'], '', ['dragonfly', 'x64'], ['DragonFly', 'x86_64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'solaris-amd64': {
		...platform(['solaris', 'amd64'], '', ['sunos', 'x64'], ['SunOS', 'x86_64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'illumos-amd64': {
		...platform(['illumos', 'amd64'], '', ['sunos', 'x64'], ['SunOS', 'x86_64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
	'aix-ppc64': {
		...platform(['aix', 'ppc64'], '', ['aix', 'ppc64'], ['AIX', 'ppc64'], hostedRunners.linux),
		cargo: false,
		go: true,
	},
};

export function supportedTargets(toolchain: 'go' | 'cargo'): BinaryTarget[] {
	return (Object.keys(platforms) as BinaryTarget[]).filter(target => !!platforms[target][toolchain]);
}
