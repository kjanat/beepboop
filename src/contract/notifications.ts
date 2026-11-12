import { Schema } from 'effect';
import type { WatchedRegistry } from '@/contract/catalog';
import { jsrPackageNamePattern, notificationKinds, watchedRegistries } from '@/contract/catalog';
import { credentialAliasPattern } from '@/contract/ids';
import type { Decoded } from '@/schema';
import { mapped, matchesPattern, mutableStruct, refined } from '@/schema';

const packageNames: Record<WatchedRegistry, RegExp> = {
	npm: /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
	jsr: jsrPackageNamePattern,
};
export const watchInput = refined(
	mutableStruct({
		registry: Schema.Literals(watchedRegistries),
		name: mapped(Schema.String, value => value.trim()).check(Schema.isMinLength(1)).check(Schema.isMaxLength(214)),
	}),
	input => packageNames[input.registry].test(input.name),
	{ message: 'Invalid package name', path: ['name'] },
);

export const destinationInput = mutableStruct({
	id: Schema.optional(Schema.String.check(matchesPattern(credentialAliasPattern))),
	name: mapped(Schema.String, value => value.trim()).check(Schema.isMinLength(1)).check(Schema.isMaxLength(80)),
	kind: Schema.Literals(notificationKinds),
	credential: Schema.String.check(matchesPattern(credentialAliasPattern)),
	subscribeNew: Schema.Boolean,
	enabled: Schema.Boolean,
});
export type DestinationInput = Decoded<typeof destinationInput>;
export const subscriptionInput = mutableStruct({
	destinationId: Schema.String.check(Schema.isMinLength(1)),
	registry: Schema.Literals(watchedRegistries),
	name: Schema.String.check(Schema.isMinLength(1)),
	subscribed: Schema.Boolean,
});
