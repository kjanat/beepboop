import { Effect } from 'effect';
import * as z from 'zod';
import type { DomainError } from '@/contract/errors';
import { assetName, checksumOf, expand, https, parseChecksums, releaseTag } from '@/distribution/assets';
import { fromSync } from '@/failure';

const text = z.string().min(1);
const executable = text.refine(
	path => !/^(?:[\\/]|[A-Za-z]:)/.test(path) && !path.split(/[\\/]/).includes('..'),
	'Expected a relative path inside the archive',
);
const alias = text.refine(
	name => !/[\\/:]/.test(name) && name !== '.' && name !== '..',
	'Expected a shim name without a path',
);
const architectures = ['64bit', '32bit', 'arm64'] as const;

export const scoopConfiguration = z.strictObject({
	name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
	description: text,
	homepage: text,
	license: text,
	url: text,
	architecture: z.partialRecord(z.enum(architectures), text).refine(
		assets => Object.keys(assets).length > 0,
		'Expected at least one architecture',
	),
	bin: z.array(z.union([executable, z.tuple([executable, alias])])).min(1),
});
export type ScoopConfiguration = z.input<typeof scoopConfiguration>;

export interface ScoopOptions {
	configuration: ScoopConfiguration;
	version: string;
	tag?: string;
	checksums: string;
}

export function generateManifest(options: ScoopOptions): Effect.Effect<string, DomainError> {
	return Effect.gen(function*() {
		const config = yield* fromSync(() => scoopConfiguration.parse(options.configuration));
		const version = options.version;
		const tag = yield* releaseTag(version, options.tag);
		const checksums = yield* parseChecksums(options.checksums);
		const architecture: Record<string, { url: string; bin: (string | [string, string])[]; hash: string }> = {};
		for (const key of architectures) {
			const asset = config.architecture[key];
			if (asset === undefined) continue;
			const name = yield* assetName(asset, { version });
			architecture[key] = {
				url: yield* https(
					yield* expand(config.url, {
						version,
						tag: encodeURIComponent(tag),
						asset: encodeURIComponent(name),
					}),
				),
				bin: config.bin,
				hash: yield* checksumOf(checksums, name),
			};
		}
		return `${
			JSON.stringify(
				{
					version,
					architecture,
					homepage: yield* https(config.homepage),
					license: config.license,
					description: config.description,
				},
				null,
				4,
			)
		}\n`;
	});
}
