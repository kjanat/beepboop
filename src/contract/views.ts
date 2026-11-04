export const tones = ['ok', 'active', 'waiting', 'warn', 'error', 'neutral'] as const;
export type Tone = (typeof tones)[number];

export interface Status {
	tone: Tone;
	label: string;
}
