import { Schema, Struct } from 'effect';
import { managerDestinationIds, managerNames } from '@/domain/catalog.ts';
import type { ChannelOutcome, RegistryOutcome } from '@/domain/destinations.ts';
import type { Package } from '@/domain/inventory.ts';
import { publicationSchema } from '@/domain/package-publication.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';
import { diagnostic, isDiagnosticCode } from '@/kernel/errors/diagnostics.ts';
import { stringsSchema as strings } from '@/kernel/schema/result.ts';
import { mapped, mutableArray, mutableRecord, mutableStruct } from '@/kernel/schema/structs.ts';
import { normalizePublication } from '@/persistence/codecs/stored';

export const managerName = Schema.Literals(managerNames);
export const shas = mutableRecord(Schema.String, Schema.String);
export const storedDiagnostic = mutableStruct({
	...diagnostic.fields,
	...{
		code: mapped(Schema.String, diagnostic.fields.code, code => isDiagnosticCode(code) ? code : 'legacy', code => code),
	},
});

export const identity: Schema.Codec<PackageIdentity, unknown> = mutableStruct({
	type: Schema.String,
	name: Schema.String,
	namespace: Schema.optional(Schema.String),
	version: Schema.optional(Schema.String),
	qualifiers: Schema.optional(mutableRecord(Schema.String, Schema.String)),
	subpath: Schema.optional(Schema.String),
});
const publication = publicationSchema();
const _registryState = Schema.Union([
	mutableStruct({ state: Schema.Literal('published'), version: Schema.String }),
	mutableStruct({ state: Schema.Literal('missing') }),
	mutableStruct({ state: Schema.Literal('failed'), reason: Schema.String }),
	mutableStruct({ state: Schema.Literal('unchecked') }),
]);
export const channel = Schema.Union([
	mutableStruct({
		destination: Schema.Literal('homebrew'),
		kind: Schema.Literals(['cask', 'formula']),
		repository: Schema.String,
		directory: Schema.String,
		name: Schema.String,
		manifest: Schema.String,
	}),
	mutableStruct({
		destination: Schema.Literal('scoop'),
		repository: Schema.String,
		directory: Schema.String,
		name: Schema.String,
		manifest: Schema.String,
	}),
	mutableStruct({ destination: Schema.Literal('aur'), name: Schema.String, manifest: Schema.String }),
]);
function outcomeSchema<S extends Schema.Struct.Fields>(fields: S) {
	return Schema.Union([
		mutableStruct({ ...fields, state: Schema.Literal('published'), version: Schema.String }),
		mutableStruct({ ...fields, state: Schema.Literal('missing') }),
		mutableStruct({ ...fields, state: Schema.Literal('failed'), reason: Schema.String }),
		mutableStruct({ ...fields, state: Schema.Literal('unchecked') }),
	]);
}
export const channelOutcome: Schema.Codec<ChannelOutcome, unknown> = Schema.Union([
	outcomeSchema(channel.members[0].fields),
	outcomeSchema(channel.members[1].fields),
	outcomeSchema(channel.members[2].fields),
	mutableStruct({ ...channel.members[0].fields, state: Schema.Literal('tracking') }),
	mutableStruct({ ...channel.members[1].fields, state: Schema.Literal('tracking') }),
	mutableStruct({ ...channel.members[2].fields, state: Schema.Literal('tracking') }),
]);
const registryOutcome: Schema.Codec<RegistryOutcome, unknown> = Schema.Union([
	outcomeSchema({ destination: Schema.Literals(managerDestinationIds) }),
	channelOutcome,
]);
export const storedPackage = mutableStruct({
	identity: Schema.optional(identity),
	previousModule: Schema.optional(mutableStruct({ name: Schema.String, version: Schema.String })),
	publicationStatus: Schema.optional(Schema.Literals(['published', 'missing', 'failed', 'unchecked'])),
	destinations: Schema.optional(mutableArray(registryOutcome)),
	channels: Schema.optional(mutableArray(channel)),
	generated: Schema.optional(Schema.Boolean),
	optional: Schema.optional(Schema.Boolean),
	manager: managerName,
	name: Schema.String,
	version: Schema.optional(Schema.String),
	published: Schema.optional(Schema.String),
	manifest: Schema.String,
	versionSource: Schema.String,
	publication: Schema.optional(publication),
	publish: Schema.optional(Schema.Boolean),
	dependencies: strings,
});
export const pkg: Schema.Codec<Package, unknown> = mapped(
	storedPackage,
	Schema.toType(mutableStruct({ ...Struct.omit(storedPackage.fields, ['publish']), publication })),
	normalizePublication,
	value => value,
);
