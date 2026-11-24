import type { Channel } from '@/domain/destinations.ts';
import type { Snapshot } from '@/domain/inventory.ts';
import type { Diagnostic } from '@/kernel/errors/diagnostics.ts';
import { fileProblem } from '@/kernel/errors/diagnostics.ts';

const aurName = /^[a-z0-9@_+][a-z0-9@._+-]*$/;
export const pkgbuildFile = /(?:^|\/)PKGBUILD$/;

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
