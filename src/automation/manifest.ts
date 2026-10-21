import { record, text } from '#model';
import type { RepositoryGateway } from './github.ts';
import type { Publication } from './types.ts';

/** Verify the current default-branch manifest without evaluating package code. */
export async function verifyManifest(
	publication: Publication,
	gateway: RepositoryGateway,
): Promise<Publication> {
	const match = publication.name.match(/^([\w.-]+\/[\w.-]+)\/(.+\.(?:json|rb))$/);
	if (!match || match[2]?.split('/').some((part) => part === '..' || part === '')) {
		return { ...publication, outcome: 'failed' };
	}
	const repository = match[1] as string,
		path = match[2] as string;
	try {
		const metadata = record(await gateway.call(`/repos/${repository}`, ''));
		const content = await gateway.file(repository, path, text(metadata.default_branch), '');
		if (content === null) return { ...publication, outcome: 'pending' };
		const hash = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))),
			(b) => b.toString(16).padStart(2, '0'),
		).join('');
		const version = path.endsWith('.json')
			? record(JSON.parse(content)).version
			: content.match(/^\s*version\s+["']([^"']+)["']/m)?.[1];
		const valid = version === publication.version && publication.digest === `sha256:${hash}`;
		return {
			...publication,
			outcome: valid ? 'succeeded' : 'failed',
			url: `https://github.com/${repository}/blob/${text(metadata.default_branch)}/${path}`,
		};
	} catch {
		return { ...publication, outcome: 'uncertain' };
	}
}
