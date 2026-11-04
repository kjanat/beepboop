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

interface PackageName {
	name: string;
	registry?: string;
}

function parts(value: string): PackageName {
	if (!value.startsWith('pkg:')) {
		const colon = value.indexOf(':');
		return colon > 0 ? { name: value.slice(colon + 1), registry: registries[value.slice(0, colon)] } : { name: value };
	}
	try {
		const identity = packageIdentity(value);
		const jsr = identity.type === 'generic' && identity.qualifiers?.repository_url?.startsWith('https://jsr.io');
		return {
			name: identity.namespace ? `${identity.namespace}/${identity.name}` : identity.name,
			registry: registries[jsr ? 'jsr' : identity.type],
		};
	} catch {
		return { name: value };
	}
}

export function packageLabel(value: string): string {
	const { name, registry } = parts(value);
	return registry ? `${name} on ${registry}` : name;
}

export function packageMarkdown(value: string): string {
	const { name, registry } = parts(value);
	return registry ? `\`${name}\` on ${registry}` : `\`${name}\``;
}
