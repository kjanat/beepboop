import { type Grant, requestGrant } from '@/automation/vault.ts';
import type { ReadyRepository } from '@/domain/repository';
import { record, text } from '@/model';

/** Resolve permissions against stored configuration, never browser-supplied scope. */
export function configuredGrant(repository: ReadyRepository, input: unknown): Grant {
	const data = record(input);
	const stream = repository.configuration.streams[text(data.stream)];
	if (!stream) throw new Error('Choose a configured release stream');
	const operation = text(data.operation);
	const workflow = operation === 'prepare'
		? stream.prepare.workflow
		: operation === 'promote'
		? stream.promote.workflow
		: stream.workflows[operation];
	if (!workflow) throw new Error('Choose a configured workflow');
	const alias = text(data.alias);
	const delivery = text(data.delivery);
	if (delivery === 'runtime' && !stream.credentials.includes(alias)) {
		throw new Error('Add this name to the selected stream’s credentials list in .github/beepboop.json first');
	}
	const ref = workflow.ref ?? repository.defaultBranch;
	return requestGrant({
		id: crypto.randomUUID(),
		alias,
		repositoryId: repository.id,
		repository: repository.name,
		operation,
		workflow: workflow.file,
		ref: ref.startsWith('refs/') ? ref : `refs/heads/${ref}`,
		delivery,
		...(data.environment ? { environment: text(data.environment) } : {}),
		...(delivery !== 'runtime' && data.secretName ? { secretName: text(data.secretName) } : {}),
	});
}
