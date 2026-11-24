import { Effect } from 'effect';
import { object } from '@/discovery/managers/manifest-editing.ts';
import { responseJson } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { registryRequest } from '@/publication/registries/verification.ts';

export interface TrustedPublisherCheck {
	status: 'passed' | 'action-required' | 'failed';
	message: string;
}

export function trustedPublisher(
	request: Fetcher,
	crate: string,
	repository: string,
	file: string,
	environment: string | undefined,
	token: string | undefined,
): Effect.Effect<TrustedPublisherCheck> {
	return Effect.gen(function*() {
		const [owner, name] = repository.split('/');
		let url = `https://crates.io/api/v1/trusted_publishing/github_configs?crate=${
			encodeURIComponent(crate)
		}&per_page=100`;
		for (let page = 0; page < 100; page++) {
			const response = yield* registryRequest(
				request,
				url,
				token ? { headers: { Authorization: `Bearer ${token}` } } : {},
			);
			if (!response.ok) {
				return {
					status: 'failed' as const,
					message: `crates.io trusted-publisher lookup for ${crate} returned HTTP ${response.status}. ${
						response.status === 401 || response.status === 403
							? 'Provide a Beepboop crates-io credential with crate-owner access and the trusted-publishing scope.'
							: 'Retry after resolving the registry error.'
					}`,
				};
			}
			const body = object(yield* responseJson(response));
			if (!Array.isArray(body.github_configs)) {
				return {
					status: 'failed' as const,
					message: `crates.io returned an invalid trusted-publisher response for ${crate}.`,
				};
			}
			const matches = body.github_configs.map(object).some(config =>
				config.crate === crate && String(config.repository_owner).toLowerCase() === owner?.toLowerCase()
				&& String(config.repository_name).toLowerCase() === name?.toLowerCase() && config.workflow_filename === file
				&& (config.environment === null || config.environment === environment)
			);
			if (matches) {
				return {
					status: 'passed' as const,
					message: `crates.io has a trusted publisher for ${crate} matching ${repository}, ${file}${
						environment ? ` and environment ${environment}` : ''
					}.`,
				};
			}
			const next = object(body.meta).next_page;
			if (next === null || next === undefined) {
				return {
					status: 'action-required' as const,
					message: `Configure a crates.io trusted publisher for ${crate} matching ${repository}, ${file}${
						environment ? ` and environment ${environment}` : ''
					}. No matching publisher was found.`,
				};
			}
			if (typeof next !== 'string') break;
			const target = new URL(next, url);
			if (
				target.origin !== 'https://crates.io' || target.pathname !== '/api/v1/trusted_publishing/github_configs'
				|| target.searchParams.get('crate') !== crate || target.href === url
			) break;
			url = target.href;
		}
		return { status: 'failed' as const, message: `crates.io trusted-publisher pagination failed for ${crate}.` };
	}).pipe(
		Effect.scoped,
		Effect.orElseSucceed(() => ({
			status: 'failed' as const,
			message:
				`crates.io trusted-publisher request failed for ${crate}. Retry adoption after resolving the registry error.`,
		})),
	);
}
