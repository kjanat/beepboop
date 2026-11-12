import { Effect, Schema, SchemaRepresentation } from 'effect';
import { targetsSchema } from '@/contract/targets';
import { configurationSchema } from '@/domain/configuration';
import type { ToolFailure } from '@/tooling/runtime';
import { attempt, format, readText, refuse } from '@/tooling/runtime';

export const schemaPath = new URL('../../../schemas/v1.json', import.meta.url).pathname;

export const renderedConfigurationSchema: Effect.Effect<string, ToolFailure> = Effect.gen(function*() {
	const { $schema, ...rest } = yield* attempt(() => jsonSchema(configurationSchema));
	const source = `${
		JSON.stringify({ $schema, $id: 'https://beepboop.kjanat.dev/schema/v1.json', ...rest }, null, '\t')
	}\n`;
	return yield* format(schemaPath, source).pipe(
		Effect.catch(() => refuse('Cannot format the generated configuration schema')),
	);
});

export function assertCurrent(path: string): Effect.Effect<void, ToolFailure> {
	return Effect.gen(function*() {
		const current = yield* readText(path);
		if (current === undefined || current !== (yield* renderedConfigurationSchema)) {
			return yield* refuse(`The configuration schema is stale; run schema:generate: ${path}`);
		}
	});
}

export const targetsSchemaPath = new URL('../../../schemas/targets.v1.json', import.meta.url).pathname;
export const renderedTargetsSchema: Effect.Effect<string, ToolFailure> = Effect.gen(function*() {
	const { $schema, ...rest } = yield* attempt(() => jsonSchema(targetsSchema));
	return yield* format(
		targetsSchemaPath,
		`${JSON.stringify({ $schema, $id: 'https://beepboop.kjanat.dev/schema/targets.v1.json', ...rest }, null, '\t')}\n`,
	);
});
export const assertTargetsCurrent: Effect.Effect<void, ToolFailure> = Effect.gen(function*() {
	if ((yield* readText(targetsSchemaPath)) !== (yield* renderedTargetsSchema)) {
		return yield* refuse('The targets schema is stale; run schema:generate');
	}
});

function jsonSchema(schema: Schema.Constraint) {
	const representation = SchemaRepresentation.toRepresentation(Schema.toEncoded(schema).ast);
	const document = SchemaRepresentation.toJsonSchemaDocument({
		...representation,
		representation: jsonValues(representation.representation),
		references: Object.fromEntries(
			Object.entries(representation.references).map(([key, value]) => [key, jsonValues(value)]),
		),
	});
	return {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		...document.schema,
		...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}),
	};
}

function jsonValues(original: SchemaRepresentation.Representation): SchemaRepresentation.Representation {
	const node = original;
	switch (node._tag) {
		case 'Undefined':
			return { ...node, _tag: 'Never' };
		case 'Union': {
			const types = node.types.filter(type => type._tag !== 'Undefined').map(jsonValues);
			const only = types[0];
			return types.length === 1 && only && !node.checks.length
				? only._tag === 'Reference'
					? only
					: { ...only, annotations: { ...('annotations' in only ? only.annotations : {}), ...node.annotations } }
				: { ...node, types };
		}
		case 'Objects':
			return {
				...node,
				propertySignatures: node.propertySignatures.map(property => ({ ...property, type: jsonValues(property.type) })),
				indexSignatures: node.indexSignatures.map(index => ({
					parameter: jsonValues(index.parameter),
					type: jsonValues(index.type),
				})),
			};
		case 'Arrays':
			return {
				...node,
				elements: node.elements.map(element => ({ ...element, type: jsonValues(element.type) })),
				rest: node.rest.map(jsonValues),
			};
		case 'Suspend':
			return { ...original, _tag: 'Suspend', checks: [], thunk: jsonValues(node.thunk) };
		default:
			return node;
	}
}
