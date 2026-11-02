import type { Fetcher } from '@/automation/managers/registry';

export interface EdgeFetch {
	fetch: Fetcher;
	urls: string[];
}

export function edgeFetch(respond: (url: string) => Response): EdgeFetch {
	const urls: string[] = [];
	return {
		urls,
		fetch: async (input, init) => {
			const redirect = init?.redirect ?? 'follow';
			if (redirect !== 'follow' && redirect !== 'manual') {
				throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
			}
			const url = input instanceof Request ? input.url : String(input);
			urls.push(url);
			return respond(url);
		},
	};
}
