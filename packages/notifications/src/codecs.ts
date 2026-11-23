import { Schema } from 'effect';
import { decodeSync, mutableStruct } from '@/kernel/schema/structs.ts';
import { currentState, executionSchema, identifyExecution } from '@/release/domain/execution/codec-v1.ts';
import type { SubscriptionDelivery } from '@/release/domain/execution/types.ts';

const deliveryFields = {
	id: Schema.String,
	eventId: Schema.String,
	repositoryId: Schema.Finite,
};
const deliverySchema: Schema.Codec<SubscriptionDelivery, unknown> = Schema.Union([
	mutableStruct({ ...deliveryFields, execution: executionSchema }),
	mutableStruct({ ...deliveryFields, issue: mutableStruct({ title: Schema.String, body: Schema.String }) }),
]);

export function decodeDeliveryV1(value: unknown): SubscriptionDelivery {
	const delivery = decodeSync(deliverySchema, value);
	return 'execution' in delivery
		? { ...delivery, execution: currentState(identifyExecution(delivery.execution)) }
		: delivery;
}
