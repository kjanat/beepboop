import { z } from 'zod';
import type { ChangesResponse } from '@/contract/changes';
import { change } from '@/contract/changes';
import type { SqlDatabase } from '@/persistence/d1/database';

const page = 500;
const changeRow = z.object({
	seq: z.number(),
	repository_id: z.number(),
	entity: change.shape.entity,
	id: z.string(),
	revision: z.number(),
}).transform(({ repository_id, ...row }) => change.parse({ ...row, repositoryId: repository_id }));

export class ChangeLog {
	constructor(private readonly db: SqlDatabase) {}
	async since(cursor: number, repositoryId?: number): Promise<ChangesResponse> {
		const query = repositoryId === undefined
			? this.db.prepare('SELECT seq,repository_id,entity,id,revision FROM changes WHERE seq>? ORDER BY seq LIMIT ?')
				.bind(cursor, page)
			: this.db.prepare(
				'SELECT seq,repository_id,entity,id,revision FROM changes WHERE seq>? AND repository_id=? ORDER BY seq LIMIT ?',
			).bind(cursor, repositoryId, page);
		const changes = z.array(changeRow).parse((await query.all()).results);
		return { cursor: changes.at(-1)?.seq ?? cursor, changes };
	}
	async prune(before: number): Promise<void> {
		await this.db.prepare('DELETE FROM changes WHERE created_at<?').bind(before).run();
	}
}
