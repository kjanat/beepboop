import { Schema } from 'effect';
import type { Decoded } from '@/schema';
import { looseStruct, matchesPattern, mutableArray, mutableStruct } from '@/schema';

const token = Schema.String.check(matchesPattern(/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/));
const packageName = Schema.String.check(matchesPattern(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/));
const segment = Schema.String.check(matchesPattern(/^[a-z0-9][a-z0-9._-]*$/));
const scope = Schema.String.check(matchesPattern(/^@[a-z0-9][a-z0-9._-]*$/));
const selection = Schema.Union([token, mutableArray(token).check(Schema.isMinLength(1))]);
const versionSource = Schema.String.check(
	matchesPattern(
		/^(?:tags:[^\s]*|(?!(?:.*\/)?\.\.?\/)(?:[\w.-]+\/)*(?:Cargo\.toml#(?:workspace\.)?package\.version|package\.json#version))$/,
	),
);

/** Shared fields are validated; repository-specific build metadata is preserved. */
export const targetFields = looseStruct({
	pkg: Schema.optional(token),
	os: Schema.optional(selection),
	cpu: Schema.optional(selection),
	libc: Schema.optional(selection),
	rust: Schema.optional(token),
	rust_target: Schema.optional(token),
	target: Schema.optional(token),
	runner: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	build: Schema.optional(token),
	asset: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	zipFileName: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
	format: Schema.optional(token),
	tier: Schema.optional(Schema.Finite.check(Schema.isInt()).check(Schema.isGreaterThan(0))),
	experimental: Schema.optional(Schema.Boolean),
});
const npmTarget = looseStruct({ ...targetFields.schema.fields, ...{ pkg: segment } });
const facade = looseStruct({ name: packageName, pkg: Schema.optional(segment), shim: Schema.optional(packageName) });
const common = {
	$schema: Schema.optional(Schema.String),
	versionSource: Schema.optional(versionSource),
	binaries: Schema.optional(mutableArray(token).check(Schema.isMinLength(1))),
	bundle: Schema.optional(looseStruct({ name: packageName })),
	targets: mutableArray(npmTarget).check(Schema.isMinLength(1)),
};
export const npmTargetDescriptor = Schema.Union([
	looseStruct({
		...common,
		platformScope: Schema.optional(Schema.Never),
		scope,
		facade: packageName,
		facades: Schema.optional(Schema.Never),
	}),
	looseStruct({
		...common,
		platformScope: Schema.optional(Schema.Never),
		scope,
		facades: mutableArray(facade).check(Schema.isMinLength(1)),
		facade: Schema.optional(Schema.Never),
	}),
	looseStruct({
		...common,
		scope: Schema.optional(Schema.Never),
		facades: Schema.optional(Schema.Never),
		platformScope: scope,
		binary: segment,
		facade: packageName,
	}),
]);
const platformEntry = looseStruct({ ...targetFields.schema.fields, ...{ os: selection, cpu: selection } });
export const platformMap = Schema.StructWithRest(mutableStruct({ $schema: Schema.optional(Schema.String) }), [
	Schema.Record(Schema.String.check(matchesPattern(/^(?!\$schema$)[\s\S]*$/u)), Schema.mutableKey(platformEntry)),
]);
const buildTarget = Schema.Union([
	looseStruct({
		...targetFields.schema.fields,
		...{ target: token, runner: Schema.String.check(Schema.isMinLength(1)), build: token },
	}),
	looseStruct({
		...targetFields.schema.fields,
		...{ rust: token, runner: Schema.String.check(Schema.isMinLength(1)), build: token },
	}),
]);
/** The public schema and runtime reader share this contract. */
export const targetsSchema = Schema.Union([
	npmTargetDescriptor,
	mutableArray(buildTarget).check(Schema.isMinLength(1)),
	platformMap,
]);
export type NpmTargetDescriptor = Decoded<typeof npmTargetDescriptor>;
