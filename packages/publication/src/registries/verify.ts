import type { Effect } from 'effect';
import type { ManagerName } from '@/domain/catalog.ts';
import { managerSpec } from '@/domain/catalog.ts';
import type { Inventory } from '@/domain/inventory.ts';
import type { Fetcher } from '@/kernel/http/fetcher.ts';
import { platformFetch } from '@/kernel/http/fetcher.ts';
import type { Publication } from '@/publication/publication.ts';
import { managerRegistry } from '@/publication/registries/builtins.ts';
import type { VerificationContext } from '@/publication/registries/context.ts';
import type { CheckOutcome } from '@/publication/registries/outcome.ts';

export function canVerifyPublication(manager: ManagerName): boolean {
	return managerSpec(manager).verifiable;
}
export function verifyPublication(
	publication: Publication,
	request: Fetcher = platformFetch,
	context?: VerificationContext,
): Effect.Effect<CheckOutcome> {
	return managerRegistry.verifyPublication(publication, request, context);
}
export function verifySecondaryPublications(
	publication: Publication,
	request: Fetcher = platformFetch,
): Effect.Effect<CheckOutcome[]> {
	return managerRegistry.verifySecondaryPublications(publication, request);
}
export function resolvePublished(
	inventory: Inventory,
	request: Fetcher = platformFetch,
	context?: VerificationContext,
): Effect.Effect<Inventory> {
	return managerRegistry.resolvePublished(inventory, request, context);
}
