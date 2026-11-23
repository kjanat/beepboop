export const builtinPresetNames = ['default', 'github-action', 'maintenance', 'npm', 'rust-workspace'] as const;
export type BuiltinPresetName = (typeof builtinPresetNames)[number];
export type PresetReference =
	| { kind: 'github'; repository: string; preset: string; ref?: string }
	| { kind: 'builtin'; preset: BuiltinPresetName };
export const builtinPresetPrefix = 'beepboop:';
export const defaultPreset = `${builtinPresetPrefix}default`;
export const presetReferencePattern = new RegExp(
	`^(?:github>([\\w.-]+\\/[\\w.-]+):([\\w-]+)(?:#([\\w./-]+))?|${builtinPresetPrefix}(${
		builtinPresetNames.join('|')
	}))$`,
);
export function parsePresetReference(reference: string): PresetReference | undefined {
	const [, repository, preset, ref, builtin] = presetReferencePattern.exec(reference) ?? [];
	const named = builtinPresetNames.find(name => name === builtin);
	if (named) return { kind: 'builtin', preset: named };
	if (!repository || !preset) return undefined;
	return { kind: 'github', repository, preset, ...(ref ? { ref } : {}) };
}
