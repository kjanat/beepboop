import type { Effect } from 'effect';
import { Schema, SchemaTransformation } from 'effect';
import { workflowFilePattern } from '@/domain/catalog.ts';
import { matchesRef } from '@/domain/ref-policy.ts';
import { repositoryNamePattern } from '@/domain/repository-name.ts';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeRequest } from '@/kernel/errors/domain-error.ts';
import { credentialAliasPattern, githubSecretNamePattern } from '@/kernel/schema/ids.ts';
import { textSchema } from '@/kernel/schema/result.ts';
import { decodeSync, encodeSync, matchesPattern, mutableStruct } from '@/kernel/schema/structs.ts';

const grantFields = {
	id: textSchema,
	alias: Schema.String.check(matchesPattern(credentialAliasPattern)),
	repositoryId: Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0)),
	repository: Schema.String.check(matchesPattern(repositoryNamePattern)),
	operation: textSchema,
	workflow: Schema.String.check(matchesPattern(workflowFilePattern)),
	ref: Schema.String.check(Schema.isStartingWith('refs/')),
};
const secretName = Schema.String.check(matchesPattern(githubSecretNamePattern, { message: 'Secret name required' }))
	.annotateKey({ messageMissingKey: 'Secret name required' });
const environment = Schema.String.check(Schema.isMinLength(1, { message: 'Environment required' }));

export const GrantRow = Schema.Union([
	mutableStruct({
		...grantFields,
		delivery: Schema.Literal('runtime'),
		environment: Schema.optional(textSchema),
		secretName: Schema.optional(textSchema),
	}),
	mutableStruct({
		...grantFields,
		delivery: Schema.Literal('repository'),
		environment: Schema.optional(textSchema),
		secretName,
	}),
	mutableStruct({
		...grantFields,
		delivery: Schema.Literal('environment'),
		environment,
		secretName,
	}),
]);
export type GrantRow = typeof GrantRow.Type;

const GrantCases = Schema.TaggedUnion({
	Runtime: { ...grantFields, environment: Schema.optionalKey(textSchema) },
	RepositorySecret: { ...grantFields, environment: Schema.optionalKey(textSchema), secretName },
	EnvironmentSecret: { ...grantFields, environment, secretName },
});
type GrantCase = typeof GrantCases.Type;

function fromRow(row: GrantRow): GrantCase {
	const { id, alias, repositoryId, repository, operation, workflow, ref } = row;
	const fields = { id, alias, repositoryId, repository, operation, workflow, ref };
	switch (row.delivery) {
		case 'runtime':
			return {
				_tag: 'Runtime',
				...fields,
				...(row.environment === undefined ? {} : { environment: row.environment }),
			};
		case 'repository':
			return {
				_tag: 'RepositorySecret',
				...fields,
				...(row.environment === undefined ? {} : { environment: row.environment }),
				secretName: row.secretName,
			};
		case 'environment':
			return { _tag: 'EnvironmentSecret', ...fields, environment: row.environment, secretName: row.secretName };
	}
}

function toRow(grant: GrantCase): GrantRow {
	const { id, alias, repositoryId, repository, operation, workflow, ref } = grant;
	const fields = { id, alias, repositoryId, repository, operation, workflow, ref };
	switch (grant._tag) {
		case 'Runtime':
			return {
				...fields,
				delivery: 'runtime',
				...(grant.environment === undefined ? {} : { environment: grant.environment }),
			};
		case 'RepositorySecret':
			return {
				...fields,
				delivery: 'repository',
				...(grant.environment === undefined ? {} : { environment: grant.environment }),
				secretName: grant.secretName,
			};
		case 'EnvironmentSecret':
			return { ...fields, delivery: 'environment', environment: grant.environment, secretName: grant.secretName };
	}
}

export const Grant = GrantRow.pipe(
	Schema.decodeTo(GrantCases, SchemaTransformation.transform({ decode: fromRow, encode: toRow })),
);
export type Grant = typeof Grant.Type;
export type RuntimeGrant = Extract<Grant, { readonly _tag: 'Runtime' }>;
export type SecretGrant = Exclude<Grant, RuntimeGrant>;

export function parseGrant(value: unknown): Effect.Effect<Grant, DomainError> {
	return fromSync(() => decodeSync(Grant, value));
}
export function requestGrant(value: unknown): Effect.Effect<Grant, DomainError> {
	return decodeRequest(Grant, value);
}
export function grantRow(grant: Grant): GrantRow {
	return encodeSync(Grant, grant);
}
export function isRuntimeGrant(grant: Grant): grant is RuntimeGrant {
	return grant._tag === 'Runtime';
}
export function runtimeGrant(grant: Grant, operation: string, repository: string, ref: string): boolean {
	return isRuntimeGrant(grant) && grant.operation === operation && grant.repository === repository
		&& matchesRef(grant.ref, ref);
}

export interface WorkflowRun {
	readonly repository: string;
	readonly ref: string;
	readonly workflowRef: string;
	readonly environment?: string;
}
export function allowsRun(grant: Grant, operation: string, run: WorkflowRun): boolean {
	return runtimeGrant(grant, operation, run.repository, run.ref) && grant.environment === run.environment
		&& run.workflowRef === `${run.repository}/.github/workflows/${grant.workflow}@${run.ref}`;
}
export interface WorkflowBinding {
	readonly operation: string;
	readonly file: string;
	readonly ref: string;
}
export function coversBinding(
	grants: readonly Grant[],
	bindings: readonly WorkflowBinding[],
	repository: string,
): boolean {
	return bindings.some(binding =>
		grants.some(grant =>
			grant.workflow === binding.file && runtimeGrant(grant, binding.operation, repository, binding.ref)
		)
	);
}
export function secretAliases(grants: readonly Grant[], workflow: string, secretNames: readonly string[]): string[] {
	return grants.filter(grant =>
		!isRuntimeGrant(grant) && grant.workflow === workflow && secretNames.includes(grant.secretName)
	).map(grant => grant.alias);
}
