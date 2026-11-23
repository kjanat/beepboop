import { Data } from 'effect';

export interface ModuleVersion {
	readonly name: string;
	readonly version: string;
}

export type VerificationOutcome = Data.TaggedEnum<{
	Published: { readonly version: string; readonly previousModule?: ModuleVersion };
	Missing: { readonly url: string; readonly previousModule?: ModuleVersion };
	LookupFailed: { readonly url: string; readonly reason: string; readonly previousModule?: ModuleVersion };
}>;
export const VerificationOutcome = Data.taggedEnum<VerificationOutcome>();

export function publicationStatus(outcome: VerificationOutcome): 'published' | 'missing' | 'failed' {
	return VerificationOutcome.$match(outcome, {
		Published: (): 'published' => 'published',
		Missing: (): 'missing' => 'missing',
		LookupFailed: (): 'failed' => 'failed',
	});
}
