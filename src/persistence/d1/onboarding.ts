import { z } from 'zod';
import type { SqlDatabase } from '@/persistence/d1/database';

const documentRow = z.object({ document: z.string() });

export class OnboardingStore {
	constructor(private readonly db: SqlDatabase) {}
	async document(repositoryId: number): Promise<string | undefined> {
		const row = await this.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(repositoryId)
			.first();
		return row === null ? undefined : documentRow.parse(row).document;
	}
	async save(repositoryId: number, document: unknown): Promise<void> {
		await this.db.prepare(
			'INSERT INTO onboarding(repository_id,document) VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET document=excluded.document',
		).bind(repositoryId, JSON.stringify(document)).run();
	}
}
