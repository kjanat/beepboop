import { Schema } from 'effect';
import { distinct } from '@/distinct';
import type { Decoded } from '@/schema';
import { mutableStruct } from '@/schema';

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
	'package-metadata',
	'legacy',
	'invalid-configuration',
	'configuration-drift',
	'lookup-failed',
	'unconfigured',
	'version-tagged',
	'companion-module',
] as const;
export type DiagnosticCode = (typeof diagnosticCodes)[number];

export function isDiagnosticCode(value: string): value is DiagnosticCode {
	return diagnosticCodes.some(code => code === value);
}

export const diagnosticSubject = Schema.Union([
	mutableStruct({ kind: Schema.Literal('file'), path: Schema.String }),
	mutableStruct({ kind: Schema.Literal('package'), key: Schema.String }),
	mutableStruct({ kind: Schema.Literal('stream'), name: Schema.String }),
	mutableStruct({ kind: Schema.Literal('binding'), stream: Schema.String, operation: Schema.String }),
	mutableStruct({ kind: Schema.Literal('credential'), alias: Schema.String }),
]);
export type DiagnosticSubject = Decoded<typeof diagnosticSubject>;

export const diagnostic = mutableStruct({
	code: Schema.Literals(diagnosticCodes),
	severity: Schema.Literals(['blocking', 'warning']),
	subject: Schema.optional(diagnosticSubject),
	message: Schema.String,
});
export type Diagnostic = Decoded<typeof diagnostic>;

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
	return distinct(diagnostics.map(entry => entry.message));
}

export function blocking(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	return diagnostics.filter(entry => entry.severity === 'blocking');
}
