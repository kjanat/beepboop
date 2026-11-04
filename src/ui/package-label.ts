import { packageIdentity } from '@/package-url';

const registries: Record<string, string> = {
	cargo: 'crates.io',
	composer: 'Packagist',
	docker: 'Docker Hub',
	gem: 'RubyGems',
	github: 'GitHub Releases',
	'github-release': 'GitHub Releases',
	go: 'Go',
	golang: 'Go',
	goreleaser: 'GitHub Releases',
	jsr: 'JSR',
	maven: 'Maven Central',
	npm: 'npm',
	nuget: 'NuGet',
	oci: 'OCI registry',
	pypi: 'PyPI',
	vscode: 'VS Code Marketplace',
};

function label(name: string, kind: string): string {
	const registry = registries[kind];
	return registry ? `${name} on ${registry}` : name;
}

export function packageLabel(value: string): string {
	if (!value.startsWith('pkg:')) {
		const colon = value.indexOf(':');
		return colon > 0 ? label(value.slice(colon + 1), value.slice(0, colon)) : value;
	}
	try {
		const identity = packageIdentity(value);
		const jsr = identity.type === 'generic' && identity.qualifiers?.repository_url?.startsWith('https://jsr.io');
		return label(
			identity.namespace ? `${identity.namespace}/${identity.name}` : identity.name,
			jsr ? 'jsr' : identity.type,
		);
	} catch {
		return value;
	}
}
