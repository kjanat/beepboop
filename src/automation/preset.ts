export interface PresetReference {
	repository: string;
	preset: string;
	ref?: string;
}
export function parsePresetReference(reference: string): PresetReference | undefined {
	const [, repository, preset, ref] = /^github>([\w.-]+\/[\w.-]+):([\w-]+)(?:#([\w./-]+))?$/.exec(reference) ?? [];
	if (!repository || !preset) return undefined;
	return { repository, preset, ...(ref ? { ref } : {}) };
}
