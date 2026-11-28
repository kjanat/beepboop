import type { ManagerName } from '@/domain/catalog.ts';
import type { PackageIdentity } from '@/domain/purl/index.ts';

export const outcomes = ['pending', 'succeeded', 'failed', 'cancelled', 'uncertain', 'skipped'] as const;
export type Outcome = (typeof outcomes)[number];
interface PublicationFields {
	identity?: PackageIdentity;
	id: string;
	manager: ManagerName;
	name: string;
	version: string;
	digest?: string;
	url?: string;
	channel?: string;
	required: boolean;
}
export type Publication =
	| (PublicationFields & { outcome: Outcome })
	| (PublicationFields & { outcome: 'rate-limited'; retryAfter: string });
