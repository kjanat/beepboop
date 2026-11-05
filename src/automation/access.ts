import { Effect } from 'effect';
import { type Grant, requestGrant } from '@/automation/vault.ts';
import { type DomainError, precondition } from '@/contract/errors';
import type { ReadyRepository } from '@/domain/repository';
import { record, text } from '@/model';

/** Resolve permissions against stored configuration, never browser-supplied scope. */
export function configuredGrant(repository: ReadyRepository, input: unknown): Effect.Effect<Grant, DomainError> {
	return Effect.gen(function*() {
		const data = yield* Effect.fromResult(record(input));
		const field = (value: unknown) => Effect.fromResult(text(value));
		const stream = repository.configuration.streams[yield* field(data.stream)];
		if (!stream) return yield* precondition('Choose a configured release stream');
		const operation = yield* field(data.operation);
		const workflow = operation === 'prepare'
			? stream.prepare.workflow
			: operation === 'promote'
			? stream.promote.workflow
			: stream.workflows[operation];
		if (!workflow) return yield* precondition('Choose a configured workflow');
		const alias = yield* field(data.alias);
		const delivery = yield* field(data.delivery);
		if (delivery === 'runtime' && !stream.credentials.includes(alias)) {
			return yield* precondition(
				'Add this name to the selected stream’s credentials list in .github/beepboop.json first',
			);
		}
		const ref = workflow.ref ?? repository.defaultBranch;
		return yield* requestGrant({
			id: crypto.randomUUID(),
			alias,
			repositoryId: repository.id,
			repository: repository.name,
			operation,
			workflow: workflow.file,
			ref: ref.startsWith('refs/') ? ref : `refs/heads/${ref}`,
			delivery,
			...(data.environment ? { environment: yield* field(data.environment) } : {}),
			...(delivery !== 'runtime' && data.secretName ? { secretName: yield* field(data.secretName) } : {}),
		});
	});
}
