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
	'invalid-configuration',
	'configuration-drift',
	'lookup-failed',
	'unconfigured',
] as const;
export type DiagnosticCode = (typeof diagnosticCodes)[number];

export function isDiagnosticCode(value: string): value is DiagnosticCode {
	return diagnosticCodes.some(code => code === value);
}

export const diagnosticSubject = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('file'), path: z.string() }),
	z.object({ kind: z.literal('package'), key: z.string() }),
	z.object({ kind: z.literal('stream'), name: z.string() }),
	z.object({ kind: z.literal('binding'), stream: z.string(), operation: z.string() }),
	z.object({ kind: z.literal('credential'), alias: z.string() }),
]);
export type DiagnosticSubject = z.output<typeof diagnosticSubject>;

export const diagnostic = z.object({
	code: z.enum(diagnosticCodes),
	severity: z.enum(['blocking', 'warning']),
	subject: diagnosticSubject.optional(),
	message: z.string(),
});
export type Diagnostic = z.output<typeof diagnostic>;

export function legacyDiagnostic(message: string): Diagnostic {
	return { code: 'legacy', severity: 'blocking', message };
}

export function fileProblem(
	path: string,
	code: DiagnosticCode,
	detail: string,
	severity: Diagnostic['severity'] = 'blocking',
): Diagnostic {
	return { code, severity, subject: { kind: 'file', path }, message: `${path}: ${detail}` };
}

export function messages(diagnostics: readonly Diagnostic[]): string[] {
	return [...new Set(diagnostics.map(entry => entry.message))];
}

export function blocking(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	return diagnostics.filter(entry => entry.severity === 'blocking');
}
