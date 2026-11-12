import { Effect, Schema } from 'effect';
import type { Channel, ChannelOutcome } from '@/automation/destinations';
import { tracksBranch } from '@/automation/destinations';
import type { Fetcher, RegistryVersion } from '@/automation/managers/registry';
import { LookupFailure, latestText, latestVersion, unpublished } from '@/automation/managers/verification';
import type { Snapshot } from '@/automation/types';
import type { Diagnostic } from '@/contract/diagnostics';
import { fileProblem } from '@/contract/diagnostics';
import { mutableArray, mutableStruct, safeDecode } from '@/schema';

const aurInfo = mutableStruct({
	type: Schema.String,
	error: Schema.optional(Schema.String),
	results: mutableArray(mutableStruct({ Name: Schema.String, Version: Schema.String })),
});
const scoopManifest = mutableStruct({ version: Schema.String });
const aurName = /^[a-z0-9@_+][a-z0-9@._+-]*$/;
export const pkgbuildFile = /(?:^|\/)PKGBUILD$/;

function raw(repository: string, directory: string, file: string): string {
	const path = [...repository.split('/'), 'HEAD', ...directory.split('/').filter(Boolean), file];
	return `https://raw.githubusercontent.com/${path.map(encodeURIComponent).join('/')}`;
}
function aurVersion(body: unknown, name: string): unknown {
	const parsed = safeDecode(aurInfo, body);
	if (!parsed.success) return undefined;
	if (parsed.data.type === 'error') return new LookupFailure(parsed.data.error ?? 'AUR error');
	const found = parsed.data.results.find(result => result.Name === name);
	return found ? pkgver(found.Version.replace(/^\d+:/, '').replace(/-[^-]*$/, '')) : unpublished;
}
export function pkgver(value: string): string {
	return value.replace(
		/^(\d+\.\d+\.\d+)[._]?((?:alpha|beta|rc|pre)(?:[._]?\d+)?)$/i,
		(_, core: string, pre: string) => `${core}-${pre.replace(/^([a-z]+)[._]?(\d+)$/i, '$1.$2')}`,
	).replaceAll('_', '-');
}
function formulaVersion(source: string): unknown {
	const literal = /^\s*version\s+"([^"#]+)"/m.exec(source)?.[1];
	if (literal) return literal;
	const url = /^\s*url\s+"([^"#]+)"/m.exec(source)?.[1];
	return (url && /\/v?(\d+\.\d+\.\d+)(?:\/|\.tar|\.tgz|\.zip)/.exec(url)?.[1])
		?? new LookupFailure('no literal version or versioned url');
}
function latest(channel: Channel, request: Fetcher): Effect.Effect<RegistryVersion> {
	if (channel.destination === 'aur') {
		return latestVersion(
			request,
			`https://aur.archlinux.org/rpc/v5/info?arg[]=${encodeURIComponent(channel.name)}`,
			body => aurVersion(body, channel.name),
		);
	}
	if (channel.destination === 'scoop') {
		return latestVersion(
			request,
			raw(channel.repository, channel.directory, `${channel.name}.json`),
			body => safeDecode(scoopManifest, body).data?.version,
		);
	}
	return latestText(request, raw(channel.repository, channel.directory, `${channel.name}.rb`), formulaVersion);
}
export function checkChannel(
	channel: Channel,
	request: Fetcher,
): Effect.Effect<{ outcome: ChannelOutcome; failure?: string }> {
	if (tracksBranch(channel)) return Effect.succeed({ outcome: { ...channel, state: 'tracking' } });
	return latest(channel, request).pipe(Effect.map((result): { outcome: ChannelOutcome; failure?: string } => {
		if (result.kind === 'published') return { outcome: { ...channel, state: 'published', version: result.version } };
		if (result.kind === 'missing') return { outcome: { ...channel, state: 'missing' } };
		return {
			outcome: { ...channel, state: 'failed', reason: result.reason },
			failure: `${result.reason} from ${result.url}`,
		};
	}));
}

export function pkgbuildChannels(snapshot: Snapshot): { channels: Channel[]; diagnostics: Diagnostic[] } {
	const channels: Channel[] = [];
	const diagnostics: Diagnostic[] = [];
	for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
		if (!pkgbuildFile.test(path)) continue;
		const values = [...source.matchAll(/^pkgname=(.*)$/gm)].map(match => match[1]?.trim() ?? '');
		const [value] = values;
		if (values.length !== 1 || value === undefined) {
			diagnostics.push(fileProblem(path, 'invalid-manifest', `expected exactly one pkgname assignment`));
			continue;
		}
		if (value.startsWith('(')) {
			diagnostics.push(fileProblem(path, 'invalid-manifest', `split packages are not supported`));
			continue;
		}
		const name = /^(['"]?)([^'"]*)\1$/.exec(value)?.[2];
		if (!name || !aurName.test(name)) {
			diagnostics.push(fileProblem(path, 'invalid-manifest', `pkgname must be a literal package name`));
			continue;
		}
		channels.push({ destination: 'aur', name, manifest: path });
	}
	return { channels, diagnostics };
}
