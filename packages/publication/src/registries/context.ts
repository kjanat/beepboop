import type { Effect } from 'effect';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export interface VerificationContext {
	repository: string;
	github(path: string): Effect.Effect<unknown, DomainError>;
}
