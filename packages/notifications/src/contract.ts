import { Schema } from 'effect';
import type { WatchedRegistry } from '@/domain/catalog.ts';
import { jsrPackageNamePattern, notificationKinds, watchedRegistries } from '@/domain/catalog.ts';
import { credentialAliasPattern } from '@/kernel/schema/ids.ts';
import type { Decoded } from '@/kernel/schema/structs.ts';
import { looseStruct, mapped, matchesPattern, mutableArray, mutableStruct, refined } from '@/kernel/schema/structs.ts';

const packageNames: Record<WatchedRegistry, RegExp> = {
	npm: /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
	jsr: jsrPackageNamePattern,
};
export const watchInput = refined(
	mutableStruct({
		registry: Schema.Literals(watchedRegistries),
		name: mapped(Schema.String, Schema.String, value => value.trim(), value => value).check(Schema.isMinLength(1))
			.check(Schema.isMaxLength(214)),
	}),
	input => packageNames[input.registry].test(input.name),
	{ message: 'Invalid package name', path: ['name'] },
);

export const destinationInput = mutableStruct({
	id: Schema.optional(Schema.String.check(matchesPattern(credentialAliasPattern))),
	name: mapped(Schema.String, Schema.String, value => value.trim(), value => value).check(Schema.isMinLength(1)).check(
		Schema.isMaxLength(80),
	),
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

export const destinationView = looseStruct({
	id: Schema.String,
	name: Schema.String,
	kind: Schema.String,
	credential: Schema.String,
	subscribeNew: Schema.Boolean,
	enabled: Schema.Boolean,
});
export const notificationsView = looseStruct({
	destinations: mutableArray(destinationView),
	subscriptions: mutableArray(
		looseStruct({ destinationId: Schema.String, registry: Schema.String, name: Schema.String }),
	),
	deliveries: mutableArray(Schema.Unknown),
});
export type NotificationsView = Decoded<typeof notificationsView>;
