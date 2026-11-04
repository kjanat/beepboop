import { z } from 'zod';
import { auditActor } from '@/domain/audit';
import type { SqlDatabase } from '@/persistence/d1/database';

const activityRow = z.object({
	id: z.string(),
	actor: z.string(),
	action: z.string(),
	target: z.string(),
	created_at: z.number(),
});
export interface AuditRow {
	id: string;
	actor: string;
	action: string;
	target: string;
	createdAt: number;
}

export class AuditStore {
	constructor(private readonly db: SqlDatabase) {}
	async record(actor: string, action: string, target: string): Promise<void> {
		await this.db.prepare('INSERT INTO audit(id,actor,actor_json,action,target,created_at) VALUES(?,?,?,?,?,?)')
			.bind(crypto.randomUUID(), actor, JSON.stringify(auditActor(actor)), action, target, Date.now()).run();
	}
	async recent(): Promise<AuditRow[]> {
		const result = await this.db
			.prepare('SELECT id, actor, action, target, created_at FROM audit ORDER BY created_at DESC LIMIT 200')
			.all();
		return z.array(activityRow).parse(result.results).map(({ created_at, ...entry }) => ({
			...entry,
			createdAt: created_at,
		}));
	}
}
