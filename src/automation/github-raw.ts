import { Effect, Option } from 'effect';
import { responseBytes, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';

const contentsLimit = 1_048_576;

function rawFileUrl(repository: string, commit: string, path: string): string {
	const segments = [...repository.split('/'), commit, ...path.split('/')];
	return `https://raw.githubusercontent.com/${segments.map(encodeURIComponent).join('/')}`;
}

export const rawFile = Effect.fnUntraced(
	function*(transport: Fetcher, repository: string, commit: string, path: string) {
		if (!shaPattern.test(commit)) return Option.none<string>();
		const response = yield* scopedResponse(Effect.tryPromise(signal =>
			transport(rawFileUrl(repository, commit, path), {
				redirect: 'manual',
				signal,
				headers: { 'User-Agent': 'beepboop' },
			})
		));
		if (response.status !== 200 || Number(response.headers.get('content-length')) > contentsLimit) {
			return Option.none<string>();
		}
		const bytes = yield* responseBytes(response);
		if (bytes.byteLength > contentsLimit) return Option.none<string>();
		return Option.some(yield* Effect.try(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
	},
	Effect.scoped,
	Effect.timeout('10 seconds'),
	Effect.orElseSucceed(() => Option.none<string>()),
);
