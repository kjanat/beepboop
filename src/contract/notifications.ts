import { z } from 'zod';
import { notificationKinds, type WatchedRegistry, watchedRegistries } from '@/contract/catalog';
import { credentialAliasPattern } from '@/contract/ids';

const packageNames: Record<WatchedRegistry, RegExp> = {
	npm: /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
	jsr: /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/,
};
export const watchInput = z.object({ registry: z.enum(watchedRegistries), name: z.string().trim().min(1).max(214) })
	.refine(input => packageNames[input.registry].test(input.name), { message: 'Invalid package name', path: ['name'] });

export const destinationInput = z.object({
	id: z.string().regex(credentialAliasPattern).optional(),
	name: z.string().trim().min(1).max(80),
	kind: z.enum(notificationKinds),
	credential: z.string().regex(credentialAliasPattern),
	subscribeNew: z.boolean(),
	enabled: z.boolean(),
});
export type DestinationInput = z.infer<typeof destinationInput>;
export const subscriptionInput = z.object({
	destinationId: z.string().min(1),
	registry: z.enum(watchedRegistries),
	name: z.string().min(1),
	subscribed: z.boolean(),
});
