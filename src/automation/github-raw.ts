import { Effect, Option, Result } from 'effect';
import { responseBytes, scopedResponse } from '@/kernel/http/body.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { shaPattern } from '@/kernel/schema/ids.ts';
import { record } from '@/kernel/schema/result.ts';

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
		const bytes = yield* responseBytes(response, { maxBytes: contentsLimit + 1 });
		if (bytes.byteLength > contentsLimit) return Option.none<string>();
		return Option.some(yield* Effect.try(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
	},
	Effect.scoped,
	Effect.timeout('10 seconds'),
	Effect.orElseSucceed(() => Option.none<string>()),
);

const refsLimit = 65_536;
const advertisedRef = /^([0-9a-f]{40}) (\S+)(.*)$/;

function packetLine(line: string): string {
	return `${(line.length + 5).toString(16).padStart(4, '0')}${line}\n`;
}

function packetLines(bytes: Uint8Array): string[] {
	const decoder = new TextDecoder();
	const lines: string[] = [];
	for (let at = 0; at + 4 <= bytes.byteLength;) {
		const header = decoder.decode(bytes.subarray(at, at + 4));
		if (!/^[0-9a-f]{4}$/.test(header)) break;
		const size = Math.max(Number.parseInt(header, 16), 4);
		if (at + size > bytes.byteLength) break;
		if (size > 4) lines.push(decoder.decode(bytes.subarray(at + 4, at + size)).replace(/\n$/, ''));
		at += size;
	}
	return lines;
}

const refCommit = Effect.fnUntraced(
	function*(transport: Fetcher, repository: string, ref: string | undefined) {
		if (ref !== undefined && shaPattern.test(ref)) return Option.some(ref);
		const names = ref === undefined ? ['HEAD'] : [`refs/heads/${ref}`, `refs/tags/${ref}`];
		const listed = ref === undefined ? names : [...names, ref, `refs/${ref}`];
		const response = yield* scopedResponse(
			Effect.tryPromise(signal =>
				transport(`https://github.com/${repository.split('/').map(encodeURIComponent).join('/')}.git/git-upload-pack`, {
					method: 'POST',
					redirect: 'manual',
					signal,
					headers: {
						'User-Agent': 'beepboop',
						'Git-Protocol': 'version=2',
						'Content-Type': 'application/x-git-upload-pack-request',
						Accept: 'application/x-git-upload-pack-result',
					},
					body: [
						packetLine('command=ls-refs'),
						packetLine('object-format=sha1'),
						'0001',
						packetLine('peel'),
						...listed.map(name => packetLine(`ref-prefix ${name}`)),
						'0000',
					].join(''),
				})
			),
		);
		if (response.status !== 200) return Option.none<string>();
		const bytes = yield* responseBytes(response, { maxBytes: refsLimit + 1 });
		if (bytes.byteLength > refsLimit) return Option.none<string>();
		const matches = packetLines(bytes).flatMap(line => {
			const [, oid, name = '', attributes = ''] = advertisedRef.exec(line) ?? [];
			if (oid === undefined || !listed.includes(name)) return [];
			return [{ name, commit: / peeled:([0-9a-f]{40})(?: |$)/.exec(attributes)?.[1] ?? oid }];
		});
		const [match] = matches;
		return matches.length === 1 && match !== undefined && names.includes(match.name)
			? Option.some(match.commit)
			: Option.none<string>();
	},
	Effect.scoped,
	Effect.timeout('10 seconds'),
	Effect.orElseSucceed(() => Option.none<string>()),
);

export const rawPreset = Effect.fnUntraced(
	function*(transport: Fetcher, repository: string, preset: string, ref: string | undefined) {
		const commit = yield* refCommit(transport, repository, ref);
		if (Option.isNone(commit)) return Option.none<{ value: unknown; sha: string }>();
		const text = yield* rawFile(transport, repository, commit.value, `${preset}.json`);
		if (Option.isNone(text)) return Option.none<{ value: unknown; sha: string }>();
		const value = yield* Effect.try((): unknown => JSON.parse(text.value));
		return Result.isSuccess(record(value))
			? Option.some({ value, sha: commit.value })
			: Option.none<{ value: unknown; sha: string }>();
	},
	Effect.orElseSucceed(() => Option.none<{ value: unknown; sha: string }>()),
);
