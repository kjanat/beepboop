import { Effect } from 'effect';
import type { WatchedRegistry } from '@/domain/catalog.ts';
import type { Notifications } from '@/notifications/delivery.ts';
import { addWatch, removeManualWatch } from '@/notifications/package-watch.ts';
import { AuditStore } from '@/persistence/d1/audit';
import type { Sql, SqlDatabase } from '@/persistence/d1/database';

interface WatchedName {
	readonly registry: WatchedRegistry;
	readonly name: string;
}

export const watchPackage = Effect.fnUntraced(function*(
	db: SqlDatabase | Sql,
	notifications: Notifications,
	input: WatchedName,
	actor: string,
) {
	yield* addWatch(db, notifications, input.registry, input.name, true);
	yield* new AuditStore(db).record(actor, 'package.watch', `${input.registry}:${input.name}`);
	return { ok: true };
});

export const unwatchPackage = Effect.fnUntraced(function*(db: SqlDatabase | Sql, input: WatchedName, actor: string) {
	yield* removeManualWatch(db, input.registry, input.name);
	yield* new AuditStore(db).record(actor, 'package.unwatch', `${input.registry}:${input.name}`);
	return { ok: true };
});
