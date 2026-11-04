import { z } from 'zod';

const subjectRow = z.object({ subject: z.string() });
const sessionRow = z.object({ id: z.string(), created_at: z.number() });
export type CLISessionRow = z.output<typeof sessionRow>;

export class CLISessionStore {
	constructor(private readonly db: D1Database) {}
	async subject(hash: string): Promise<string | undefined> {
		const row = await this.db.prepare('SELECT subject FROM cli_sessions WHERE id=?').bind(hash).first();
		return row === null ? undefined : subjectRow.parse(row).subject;
	}
	async create(hash: string, subject: string): Promise<void> {
		await this.db.prepare('INSERT INTO cli_sessions(id,subject,created_at) VALUES(?,?,?)')
			.bind(hash, subject, Date.now()).run();
	}
	async revoke(hash: string): Promise<void> {
		await this.db.prepare('DELETE FROM cli_sessions WHERE id=?').bind(hash).run();
	}
	async revokeAll(): Promise<void> {
		await this.db.prepare('DELETE FROM cli_sessions').run();
	}
	async list(): Promise<CLISessionRow[]> {
		const rows = await this.db.prepare('SELECT id,created_at FROM cli_sessions ORDER BY created_at DESC').all();
		return z.array(sessionRow).parse(rows.results);
	}
}
