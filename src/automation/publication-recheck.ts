import { Context, Effect, Layer } from 'effect';
import { Automation } from '@/automation/service.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import type { Publication } from '@/publication/publication.ts';
import { verifiedPublication } from '@/publication/registries/verification.ts';
import { canVerifyPublication, verifyPublication } from '@/publication/registries/verify.ts';
import {
	publishedAfterFailure,
	recheckable,
	rechecked,
	recheckedPublication,
	recoverable,
	unreported,
	verifiableCancellation,
} from '@/release/domain/execution/execution.ts';
import type { Execution } from '@/release/domain/execution/types.ts';
import { referenceProbe } from '@/release/domain/reference-probe.ts';
import { Executions } from '@/release/services/coordinator/executions.ts';

export function unresolved(execution: Execution): boolean {
	return (execution.state === 'succeeded' || recoverable(execution)) && execution.publications.some(recheckable);
}

export class PublicationRecheck extends Context.Service<PublicationRecheck, {
	readonly recheck: (execution: Execution) => Effect.Effect<boolean, DomainError>;
	readonly probe: (execution: Execution) => Effect.Effect<void, DomainError>;
	readonly packagePublished: (manager: string, name: string, version: string) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/PublicationRecheck') {
	static readonly layer = Layer.effect(
		PublicationRecheck,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const { gateway } = automation;
			const executions = yield* Executions;
			const verify = (publication: Publication, repository: string, repositoryId: number) =>
				verifyPublication(
					publication,
					automation.dependencies.transport,
					gateway.verification(repository, repositoryId),
				);

			return PublicationRecheck.of({
				recheck: Effect.fnUntraced(function*(execution: Execution) {
					if (unresolved(execution)) {
						const context = gateway.verification(execution.repository, execution.repositoryId);
						const publications = yield* Effect.forEach(
							execution.publications,
							publication =>
								recheckable(publication)
									? verifyPublication(publication, automation.dependencies.transport, context).pipe(
										Effect.map(outcome => verifiedPublication(publication, outcome)),
									)
									: Effect.succeed(publication),
							{ concurrency: 'unbounded' },
						);
						if (publications.some((publication, i) => publication.outcome !== execution.publications[i]?.outcome)) {
							const checked = { ...execution, publications };
							yield* executions.put(publishedAfterFailure(checked) ?? checked);
							return true;
						}
					}
					const published = publishedAfterFailure(execution);
					if (published) {
						yield* executions.put(published);
						return true;
					}
					return false;
				}),
				probe: Effect.fnUntraced(function*(execution: Execution) {
					for (let i = 0; i < execution.publications.length; i++) {
						const publication = execution.publications[i];
						if (publication && (recheckable(publication) || verifiableCancellation(publication))) {
							execution.publications[i] = recheckedPublication(
								publication,
								verifiedPublication(
									publication,
									yield* verify(publication, execution.repository, execution.repositoryId),
								),
							);
						}
					}
					for (const reference of unreported(execution)) {
						const probe = execution.version ? referenceProbe(reference, execution.version) : undefined;
						if (!probe || !canVerifyPublication(probe.manager)) continue;
						const checked = yield* verify(probe, execution.repository, execution.repositoryId);
						if (checked._tag === 'Published') execution.publications.push(verifiedPublication(probe, checked));
					}
				}),
				packagePublished: Effect.fnUntraced(function*(manager: string, name: string, version: string) {
					for (const execution of yield* executions.all) {
						const matches = (publication: Publication) =>
							verifiableCancellation(publication) && publication.manager === manager && publication.name === name
							&& publication.version === version;
						if (!recoverable(execution) || !execution.publications.some(matches)) continue;
						const publications = yield* Effect.forEach(
							execution.publications,
							publication =>
								matches(publication)
									? verify(publication, execution.repository, execution.repositoryId).pipe(
										Effect.map(checked => recheckedPublication(publication, verifiedPublication(publication, checked))),
									)
									: Effect.succeed(publication),
						);
						const next = rechecked({ ...execution, publications });
						if (JSON.stringify(next) !== JSON.stringify(execution)) yield* executions.put(next);
					}
				}),
			});
		}),
	);
}
