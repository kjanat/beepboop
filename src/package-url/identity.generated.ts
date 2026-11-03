/* Generated from pinned upstream PURL data and local extensions by bun run purl:generate. Do not edit. */
export type RegisteredPackageType =
	| 'alpm'
	| 'apk'
	| 'bazel'
	| 'bitbucket'
	| 'bitnami'
	| 'brew'
	| 'cargo'
	| 'chrome-extension'
	| 'cocoapods'
	| 'composer'
	| 'conan'
	| 'conda'
	| 'cpan'
	| 'cran'
	| 'deb'
	| 'docker'
	| 'gem'
	| 'generic'
	| 'git'
	| 'github'
	| 'golang'
	| 'hackage'
	| 'hex'
	| 'huggingface'
	| 'julia'
	| 'luarocks'
	| 'maven'
	| 'mlflow'
	| 'npm'
	| 'nuget'
	| 'oci'
	| 'opam'
	| 'otp'
	| 'pub'
	| 'pypi'
	| 'qpkg'
	| 'rpm'
	| 'swid'
	| 'swift'
	| 'vcpkg'
	| 'vscode-extension'
	| 'yocto';
export type RegisteredPackageIdentity =
	| {
		type: 'alpm';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'arch'?: string };
		subpath?: string;
	}
	| {
		type: 'apk';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'arch'?: string };
		subpath?: string;
	}
	| {
		type: 'bazel';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'repository_url'?: string };
		subpath?: string;
	}
	| {
		type: 'bitbucket';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'bitnami';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'arch'?: string; 'distro'?: string };
		subpath?: string;
	}
	| {
		type: 'brew';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'repository_url'?: string };
		subpath?: string;
	}
	| {
		type: 'cargo';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'chrome-extension';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'cocoapods';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'composer';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'conan';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'user'?: string; 'channel'?: string; 'rrev'?: string; 'prev'?: string };
		subpath?: string;
	}
	| {
		type: 'conda';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'build'?: string; 'channel'?: string; 'subdir'?: string; 'type'?: string };
		subpath?: string;
	}
	| {
		type: 'cpan';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {
			'author'?: string;
			'distpath'?: string;
			'repository_url'?: string;
			'download_url'?: string;
			'vcs_url'?: string;
			'ext'?: string;
		};
		subpath?: string;
	}
	| {
		type: 'cran';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'deb';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'arch'?: string };
		subpath?: string;
	}
	| {
		type: 'docker';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'gem';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'platform'?: string };
		subpath?: string;
	}
	| {
		type: 'generic';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'download_url'?: string; 'checksum'?: string };
		subpath?: string;
	}
	| {
		type: 'git';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'github';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'golang';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'hackage';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'hex';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'huggingface';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'julia';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers: Record<string, string> & { 'uuid': string };
		subpath?: string;
	}
	| {
		type: 'luarocks';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'repository_url'?: string };
		subpath?: string;
	}
	| {
		type: 'maven';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'classifier'?: string; 'type'?: string };
		subpath?: string;
	}
	| {
		type: 'mlflow';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'model_uuid'?: string; 'run_id'?: string };
		subpath?: string;
	}
	| {
		type: 'npm';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'nuget';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'oci';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'arch'?: string; 'repository_url'?: string; 'tag'?: string };
		subpath?: string;
	}
	| {
		type: 'opam';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'otp';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'repository_url'?: string; 'platform'?: string; 'arch'?: string };
		subpath?: string;
	}
	| {
		type: 'pub';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'pypi';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'file_name'?: string };
		subpath?: string;
	}
	| {
		type: 'qpkg';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'rpm';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'epoch'?: string; 'arch'?: string };
		subpath?: string;
	}
	| {
		type: 'swid';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers: Record<string, string> & {
			'tag_id': string;
			'tag_version'?: string;
			'patch'?: string;
			'tag_creator_name'?: string;
			'tag_creator_regid'?: string;
		};
		subpath?: string;
	}
	| {
		type: 'swift';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {};
		subpath?: string;
	}
	| {
		type: 'vcpkg';
		namespace?: never;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & {
			'port_version'?: string;
			'repository_revision'?: string;
			'triplet'?: string;
			'vcs_url'?: string;
		};
		subpath?: string;
	}
	| {
		type: 'vscode-extension';
		namespace: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'platform'?: string };
		subpath?: string;
	}
	| {
		type: 'yocto';
		namespace?: string;
		name: string;
		version?: string;
		qualifiers?: Record<string, string> & { 'repository_url'?: string; 'layer_version'?: string };
		subpath?: string;
	};
export type ProposedPackageType = 'jsr';
export type ProposedPackageIdentity = {
	type: 'jsr';
	namespace: string;
	name: string;
	version?: string;
	qualifiers?: Record<string, string> & {};
	subpath?: string;
};
export type KnownPackageType = RegisteredPackageType | ProposedPackageType;
export type KnownPackageIdentity = RegisteredPackageIdentity | ProposedPackageIdentity;
