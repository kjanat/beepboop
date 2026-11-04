import { z } from 'zod';

const cursorRow = z.object({ last_tick: z.number() });

export class ScheduleStore {
	constructor(private readonly db: D1Database) {}
	async cursor(key: string): Promise<number | undefined> {
		const row = await this.db.prepare('SELECT last_tick FROM schedules WHERE id=?').bind(key).first();
		return row === null ? undefined : cursorRow.parse(row).last_tick;
	}
	async start(key: string, tick: number): Promise<void> {
		await this.db.prepare('INSERT OR IGNORE INTO schedules(id,last_tick) VALUES(?,?)').bind(key, tick).run();
	}
	async advance(key: string, tick: number): Promise<void> {
		await this.db.prepare('UPDATE schedules SET last_tick=? WHERE id=?').bind(tick, key).run();
	}
}
