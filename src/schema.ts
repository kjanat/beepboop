import { Effect, Result, Schema, SchemaGetter, SchemaIssue, Struct } from 'effect';

export type Contract = Schema.Codec<unknown, unknown>;
export type Decoded<S extends Schema.Constraint> = S['Type'];
export type Encoded<S extends Schema.Constraint> = S['Encoded'];
export function mutableStruct<const F extends Schema.Struct.Fields>(fields: F) {
	return Schema.Struct(fields).mapFields(Struct.map(Schema.mutableKey));
}
export function strictStruct<const F extends Schema.Struct.Fields>(fields: F) {
	const structure = mutableStruct(fields);
	const kept = Schema.StructWithRest(structure.mapFields(Struct.map(Schema.toEncoded)), [
		Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
	]);
	const schema = kept.check(Schema.makeFilter(value => {
		const extra = Object.keys(value).filter(key => !Object.hasOwn(fields, key));
		return extra.length
			? extra.map(key => ({ path: [key], issue: new SchemaIssue.UnexpectedKey(structure.ast) }))
			: true;
	}, { toJsonSchema: () => ({ propertyNames: { enum: Object.keys(fields) } }) })).pipe(Schema.decodeTo(structure));
	return Object.assign(schema, { fields: structure.fields });
}
export function looseStruct<const F extends Schema.Struct.Fields>(fields: F) {
	return Schema.StructWithRest(mutableStruct(fields), [
		Schema.Record(otherKeys(fields), Schema.mutableKey(Schema.Unknown)),
	]);
}
function otherKeys(fields: Schema.Struct.Fields) {
	const excluded = Object.keys(fields).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
	return Schema.String.check(matchesPattern(new RegExp(`^(?!(?:${excluded})$)[\\s\\S]*$`, 'u')));
}
export function mutableArray<S extends Schema.Constraint>(item: S) {
	return Schema.mutable(Schema.Array(item));
}
export function decodeSync<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S['Type'] {
	return Schema.decodeUnknownSync(schema, { errors: 'all' })(value);
}
export function safeDecode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) {
	return Result.match(Schema.decodeUnknownResult(schema, { errors: 'all' })(value), {
		onSuccess: data => ({ success: true as const, data, error: undefined }),
		onFailure: error => ({
			success: false as const,
			data: undefined,
			error: Object.assign(error, { issues: schemaIssues(error) }),
		}),
	});
}
export interface ValidationIssue {
	readonly code?: string;
	readonly message: string;
	readonly path?: readonly PropertyKey[];
	readonly params?: { diagnostic: string };
}
export interface ValidationContext {
	addIssue(issue: ValidationIssue): void;
}
const issueDetails = new WeakMap<SchemaIssue.Issue, ValidationIssue>();
function issueOf(issue: ValidationIssue): SchemaIssue.Issue {
	const value = new SchemaIssue.InvalidValue({ message: issue.message });
	issueDetails.set(value, issue);
	return issue.path?.length ? new SchemaIssue.Pointer(issue.path, value) : value;
}
export function withValidation<S extends Schema.Top>(
	schema: S,
	check: (value: S['Type'], ctx: ValidationContext) => void,
) {
	return schema.check(Schema.makeFilter<S['Type']>(value => {
		const issues: SchemaIssue.Issue[] = [];
		check(value, { addIssue: issue => issues.push(issueOf(issue)) });
		return issues.length ? issues : true;
	}));
}
export function refined<S extends Schema.Top>(
	schema: S,
	check: (value: S['Type']) => unknown,
	message: string | ValidationIssue = 'Invalid value',
) {
	return schema.check(
		Schema.makeFilter<S['Type']>(value =>
			Boolean(check(value)) || (typeof message === 'string' ? message : issueOf(message))
		),
	);
}
export function mapped<S extends Schema.Top, A>(schema: S, map: (value: S['Type'], ctx: ValidationContext) => A) {
	return schema.pipe(Schema.decodeTo(Schema.declare<A>((_value): _value is A => true), {
		decode: SchemaGetter.transformEffect(value => Effect.suspend(() => {
			const issues: SchemaIssue.Issue[] = [];
			const result = map(value, { addIssue: issue => issues.push(issueOf(issue)) });
			const [first, ...rest] = issues;
			return first
				? Effect.fail(new SchemaIssue.Composite(schema.ast, [first, ...rest]))
				: Effect.succeed(result);
		})),
		encode: SchemaGetter.forbidden(() => 'This normalization has no inverse'),
	}));
}
export interface DecodingIssue {
	code: string;
	keys?: string[];
	params?: { diagnostic: string };
	path: PropertyKey[];
	message: string;
}
export function schemaIssues(error: Schema.SchemaError): DecodingIssue[] {
	const output: DecodingIssue[] = [];
	function visit(issue: SchemaIssue.Issue, path: PropertyKey[]) {
		if (issue._tag === 'Pointer') {
			visit(issue.issue, [...path, ...issue.path]);
			return;
		}
		if ('issues' in issue && issue.issues.length) {
			for (const child of issue.issues) visit(child, path);
			return;
		}
		if ('issue' in issue) {
			visit(issue.issue, path);
			return;
		}
		const detail = issueDetails.get(issue);
		if (issue._tag === 'UnexpectedKey') {
			const key = String(path.at(-1));
			output.push({
				code: 'unrecognized_keys',
				keys: [key],
				path: path.slice(0, -1),
				message: `Unrecognized key: "${key}"`,
			});
		} else {
			output.push({
				code: detail?.code ?? 'invalid',
				path,
				message: SchemaIssue.makeFormatterDefault()(issue),
				...(detail?.params ? { params: detail.params } : {}),
			});
		}
	}
	visit(error.issue, []);
	return output;
}

export function mutableRecord<K extends Schema.Record.Key, V extends Schema.Constraint>(key: K, value: V) {
	const record = Schema.Record(key, Schema.mutableKey(value));
	const kept = Schema.StructWithRest(Schema.Record(key, Schema.mutableKey(Schema.toEncoded(value))), [
		Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
	]);
	const validKey = Schema.is(Schema.toType(key));
	return kept.check(Schema.makeFilter(values => {
		const issues = Object.keys(values).filter(name => !validKey(name)).map(name =>
			new SchemaIssue.Pointer([name], new SchemaIssue.InvalidValue({ message: 'Invalid record key' }))
		);
		return issues.length ? issues : true;
	}, { toJsonSchema: () => ({ propertyNames: Schema.toJsonSchemaDocument(key).schema }) })).pipe(
		Schema.decodeTo(record),
	);
}
export const numberFromInput = mapped(Schema.Unknown, value => Number(value)).pipe(Schema.decodeTo(Schema.Finite));

export function matchesPattern(pattern: RegExp, annotations?: Schema.Annotations.Filter) {
	return Schema.isPattern(pattern, { ...annotations, toJsonSchema: () => ({ pattern: pattern.source }) });
}

export function preserveUnknown<S extends Schema.Struct<Schema.Struct.Fields>>(schema: S) {
	return Schema.StructWithRest(schema, [Schema.Record(otherKeys(schema.fields), Schema.mutableKey(Schema.Unknown))]);
}
