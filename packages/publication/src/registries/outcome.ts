import { Data } from 'effect';

export interface ModuleVersion {
	readonly name: string;
	readonly version: string;
}

export type VerificationOutcome = Data.TaggedEnum<{
	Published: {
		readonly version: string;
		readonly url?: string;
		readonly digest?: string;
		readonly previousModule?: ModuleVersion;
	};
	Pending: { readonly url: string };
	Missing: { readonly url: string; readonly previousModule?: ModuleVersion };
	Rejected: { readonly url?: string };
	LookupFailed: { readonly url: string; readonly reason: string; readonly previousModule?: ModuleVersion };
	Unverifiable: Record<never, never>;
}>;
export const VerificationOutcome = Data.taggedEnum<VerificationOutcome>();

export type LookupOutcome =
	| Omit<Extract<VerificationOutcome, { readonly _tag: 'Published' }>, 'url' | 'digest'>
	| Extract<VerificationOutcome, { readonly _tag: 'Missing' | 'LookupFailed' }>;
export const LookupOutcome = Data.taggedEnum<LookupOutcome>();

export type CheckOutcome = Exclude<VerificationOutcome, { readonly _tag: 'Missing' }>;
export const CheckOutcome = Data.taggedEnum<CheckOutcome>();

export function publicationStatus(outcome: LookupOutcome): 'published' | 'missing' | 'failed' {
	return LookupOutcome.$match(outcome, {
		Published: (): 'published' => 'published',
		Missing: (): 'missing' => 'missing',
		LookupFailed: (): 'failed' => 'failed',
	});
}
