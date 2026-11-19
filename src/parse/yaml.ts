import { Result } from 'effect';
import type { Document } from 'yaml';
import { parseDocument } from 'yaml';
import { DomainError, precondition } from '@/contract/errors';
import { record } from '@/model';

export function yamlDocument(source: string): Document.Parsed {
	return parseDocument(source, { uniqueKeys: true });
}
export function validYaml(source: string, message: string): Result.Result<Document.Parsed, DomainError> {
	const document = yamlDocument(source);
	return document.errors.length ? Result.fail(precondition(message)) : Result.succeed(document);
}
export function yamlData(document: Document): unknown {
	if (document.errors.length) throw precondition('Invalid YAML');
	try {
		return document.toJS({ maxAliasCount: 100 });
	} catch (error) {
		if (
			error instanceof ReferenceError && (
				error.message.startsWith('Unresolved alias (the anchor must be set before the alias): ')
				|| error.message === 'Excessive alias count indicates a resource exhaustion attack'
			)
		) throw precondition(`Invalid YAML: ${error.message}`);
		throw error;
	}
}
export function yaml(source: string): Result.Result<Record<string, unknown>, DomainError> {
	return validYaml(source, 'Invalid YAML').pipe(
		Result.flatMap(document => Result.try({
			try: () => Result.getOrElse(record(yamlData(document)), () => ({})),
			catch: error => {
				if (error instanceof DomainError) return error;
				throw error;
			},
		})),
	);
}
