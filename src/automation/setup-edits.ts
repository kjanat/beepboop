import { Clock, Context, Effect, Layer } from 'effect';
import { Automation } from '@/automation/service.ts';
import { repositorySnapshot } from '@/automation/snapshot.ts';
import { readiness } from '@/domain/repository';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { DurableStorage } from '@/persistence/durable/storage.ts';
import { Keys } from '@/release/adapters/do/keys.ts';
import { AlarmPlanner } from '@/release/services/coordinator/alarm-planner.ts';
import { decodeSetupEditV1 } from '@/setup/edit.ts';
import { maintainSetup } from '@/setup/server/maintenance.ts';
import type { SetupEdit } from '@/setup/types.ts';

export class SetupRebuild extends Context.Service<SetupRebuild, {
	readonly rebuild: (edit: SetupEdit) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/SetupRebuild') {
	static readonly layer = Layer.effect(
		SetupRebuild,
		Effect.gen(function*() {
			const automation = yield* Automation;
			const { gateway, store } = automation;
			return SetupRebuild.of({
				rebuild: edit =>
					Effect.gen(function*() {
						const repository = yield* store.repositories.get(edit.repositoryId);
						if (repository && readiness(repository).kind !== 'suspended') {
							const snapshot = yield* repositorySnapshot(gateway, repository.name, repository.id);
							yield* maintainSetup(store, gateway, snapshot, automation.publishingAccess(snapshot.repository), {
								number: edit.number,
								choices: edit.choices,
							});
						}
					}).pipe(store.auditFailure('beepboop', 'repository.setup.failed', `${edit.repositoryId} ${edit.head}`)),
			});
		}),
	);
}

export class SetupEdits extends Context.Service<SetupEdits, {
	readonly edited: (edit: Omit<SetupEdit, 'due'>, changed: boolean) => Effect.Effect<boolean, DomainError>;
	readonly rebuildDue: Effect.Effect<void, DomainError>;
}>()('beepboop/automation/SetupEdits') {
	static readonly layer = Layer.effect(
		SetupEdits,
		Effect.gen(function*() {
			const storage = yield* DurableStorage;
			const planner = yield* AlarmPlanner;
			const port = yield* SetupRebuild;
			const stored = storage.read(Keys.setupEdit).pipe(
				Effect.flatMap(value => value === undefined ? Effect.undefined : fromSync(() => decodeSetupEditV1(value))),
			);
			yield* planner.register({ due: () => stored.pipe(Effect.map(edit => [edit?.due])) });
			return SetupEdits.of({
				edited: Effect.fnUntraced(function*(edit: Omit<SetupEdit, 'due'>, changed: boolean) {
					const clock = yield* Clock.Clock;
					const previous = yield* stored;
					if (previous ? previous.number === edit.number && previous.body === edit.body : !changed) return false;
					const due = clock.currentTimeMillisUnsafe() + 5000;
					yield* storage.write(Keys.setupEdit, { ...edit, due });
					yield* planner.arm(due);
					return true;
				}),
				rebuildDue: Effect.gen(function*() {
					const clock = yield* Clock.Clock;
					const edit = yield* stored;
					if (!edit || edit.due > clock.currentTimeMillisUnsafe()) return;
					yield* port.rebuild(edit);
					const current = yield* stored;
					if (current?.due === edit.due) yield* storage.clear(Keys.setupEdit);
				}),
			});
		}),
	);
}
