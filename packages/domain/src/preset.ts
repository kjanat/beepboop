export interface PresetReference {
	repository: string;
	preset: string;
	ref?: string;
}
export const presetReferencePattern = /^github>([\w.-]+\/[\w.-]+):([\w-]+)(?:#([\w./-]+))?$/;
export function parsePresetReference(reference: string): PresetReference | undefined {
	const [, repository, preset, ref] = presetReferencePattern.exec(reference) ?? [];
	if (!repository || !preset) return undefined;
	return { repository, preset, ...(ref ? { ref } : {}) };
}
