import defaultPreset from '@root/presets/default.json' with { type: 'json' };
import githubActionPreset from '@root/presets/github-action.json' with { type: 'json' };
import maintenancePreset from '@root/presets/maintenance.json' with { type: 'json' };
import npmPreset from '@root/presets/npm.json' with { type: 'json' };
import rustWorkspacePreset from '@root/presets/rust-workspace.json' with { type: 'json' };
import { Effect } from 'effect';
import type { BuiltinPresetName } from '@/domain/preset.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export const builtinPresets: Readonly<Record<BuiltinPresetName, unknown>> = {
	default: defaultPreset,
	'github-action': githubActionPreset,
	maintenance: maintenancePreset,
	npm: npmPreset,
	'rust-workspace': rustWorkspacePreset,
};

export function builtinPreset(name: BuiltinPresetName): Effect.Effect<{ value: unknown; sha: string }, DomainError> {
	const value = builtinPresets[name];
	return fromPromise(() => crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(value)))).pipe(
		Effect.map(digest => ({
			value: structuredClone(value),
			sha: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
		})),
	);
}
