import { z } from 'zod';

export const sessionKinds = ['login-flow', 'security-challenge', 'elevation', 'cli-approval'] as const;
export type SessionKind = (typeof sessionKinds)[number];

const documentRow = z.object({ document: z.string() });

export class SessionStore {
	constructor(private readonly db: D1Database) {}
	async open(kind: SessionKind, id: string, document: unknown, lifetime: number): Promise<void> {
		await this.db.prepare('INSERT INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)')
			.bind(id, kind, JSON.stringify(document), Date.now() + lifetime).run();
	}
	async offer(kind: SessionKind, id: string, document: unknown, lifetime: number): Promise<void> {
		await this.db.prepare('INSERT OR IGNORE INTO sessions(id,kind,document,expires_at) VALUES(?,?,?,?)')
			.bind(id, kind, JSON.stringify(document), Date.now() + lifetime).run();
	}
	async take(id: string): Promise<string | undefined> {
		const row = await this.db.prepare('DELETE FROM sessions WHERE id=? AND expires_at>? RETURNING document')
			.bind(id, Date.now()).first();
		return row === null ? undefined : documentRow.parse(row).document;
	}
	async sweep(): Promise<number> {
		return (await this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()).run()).meta.changes;
	}
}
