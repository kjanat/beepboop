import { Clock, Effect } from 'effect';
import type { Vault } from '@/credentials/vault.ts';
import type { NotificationKind } from '@/domain/catalog.ts';
import { fromPromise, fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { decodeSync } from '@/kernel/schema/structs.ts';
import type { ClaimedDelivery, NotificationDeliveries } from '@/notifications/adapters/d1/deliveries.ts';
import type { RevisedDestination } from '@/notifications/adapters/d1/destinations.ts';
import type { DeliveryOutcome } from '@/notifications/notification.ts';
import { slackMessage, versionChangedPayload } from '@/notifications/notification.ts';

export interface Sender {
	readonly vault: () => Pick<Vault, 'reveal'>;
	readonly request: Fetcher;
	readonly deliveries: Pick<NotificationDeliveries, 'owned'>;
}

function target(kind: NotificationKind, value: string): URL | undefined {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || url.username || url.password) return undefined;
		if (kind === 'slack' && !['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname)) return undefined;
		return url;
	} catch {
		return undefined;
	}
}

function retryable(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

export const send = Effect.fnUntraced(function*(
	sender: Sender,
	claim: ClaimedDelivery,
	destination: RevisedDestination | undefined,
): Effect.fn.Return<DeliveryOutcome, DomainError> {
	const clock = yield* Clock.Clock;
	const payload = yield* fromSync(() => decodeSync(versionChangedPayload, JSON.parse(claim.document))).pipe(
		Effect.orElseSucceed(() => undefined),
	);
	if (!payload) return { state: 'failed', error: 'Invalid notification payload' };
	if (!destination?.enabled) return { state: 'failed', error: 'Destination unavailable' };
	const secret = yield* sender.vault().reveal(destination.credential, `notify:${destination.id}`).pipe(
		Effect.map(credential => credential.value),
		Effect.catch(() => Effect.undefined),
	);
	if (secret === undefined) return { state: 'pending', error: 'Webhook secret unavailable' };
	const url = target(destination.kind, secret);
	if (!url) {
		return {
			state: 'failed',
			error: destination.kind === 'slack' ? 'Secret is not a Slack webhook URL' : 'Secret is not an HTTPS URL',
		};
	}
	const request = sender.request;
	if (!(yield* sender.deliveries.owned(claim, destination.revision))) {
		return { state: 'pending', error: 'Delivery claim or destination changed before sending' };
	}
	const remaining = claim.lease_until - clock.currentTimeMillisUnsafe();
	if (remaining <= 0) return { state: 'pending', error: 'Delivery lease expired before sending' };
	const response = yield* fromPromise(signal =>
		request(url, {
			method: 'POST',
			redirect: 'manual',
			signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(10_000, remaining))]),
			headers: {
				'Content-Type': 'application/json',
				'Idempotency-Key': payload.id,
				'User-Agent': 'beepboop notifications',
			},
			body: JSON.stringify(destination.kind === 'slack' ? slackMessage(payload) : payload),
		})
	).pipe(Effect.catch(() => Effect.undefined));
	if (!response) return { state: 'pending', error: 'Request failed' };
	yield* Effect.promise(() => response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
	if (response.ok) return { state: 'delivered' };
	return { state: retryable(response.status) ? 'pending' : 'failed', error: `HTTP ${response.status}` };
});
