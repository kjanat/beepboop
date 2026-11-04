import { z } from 'zod';

export const diagnosticCodes = [
	'invalid-manifest',
	'unsupported',
	'cycle',
	'duplicate-identity',
	'unknown-reference',
	'versioned-reference',
	'binding-missing',
	'binding-not-dispatchable',
	'wildcard-ref',
	'each-package-input',
	'required-uncovered',
	'version-file-missing',
	'reserved-operation',
	'credential-undeclared',
	'grant-missing',
	'registry-setup',
	'license-missing',
	'legacy',
] as const;
export type DiagnosticCode = (typeof diagnosticCodes)[number];

export const diagnostic = z.object({
	code: z.enum(diagnosticCodes),
	severity: z.enum(['blocking', 'warning']),
	message: z.string(),
});
export type Diagnostic = z.output<typeof diagnostic>;

export function legacyDiagnostic(message: string): Diagnostic {
	return { code: 'legacy', severity: 'blocking', message };
}
