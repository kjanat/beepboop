import { Effect, Schema } from 'effect';
import { fromSync } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { decodeSync, mutableArray, mutableStruct } from '@/kernel/schema/structs.ts';
import type { Sql } from '@/persistence/d1/database';
import { parse } from '@/persistence/d1/database';
import { documentRow } from '@/persistence/d1/document-row';
import type { WinGetSubmission } from '@/publication/winget/submission.ts';
import { parseSubmission } from '@/publication/winget/submission.ts';

const submissionRow = mutableStruct({ id: Schema.String, document: Schema.String });
const watchRow = Schema.NullOr(mutableStruct({ since: Schema.Finite }));

export class WinGetSubmissions {
	constructor(private readonly sql: Sql) {}

	private documents(rows: unknown[]): Effect.Effect<WinGetSubmission[], DomainError> {
		return fromSync(() => rows.map(row => parseSubmission(decodeSync(documentRow, row).document)));
	}

	recent(): Effect.Effect<WinGetSubmission[], DomainError> {
		return this.sql.all('SELECT document FROM winget_submissions ORDER BY updated_at DESC LIMIT 100').pipe(
			Effect.flatMap(rows => this.documents(rows)),
		);
	}

	latestPerRepository(): Effect.Effect<WinGetSubmission[], DomainError> {
		return this.sql.all(
			"SELECT document FROM (SELECT document,ROW_NUMBER() OVER (PARTITION BY json_extract(document,'$.plan.repositoryId') ORDER BY json_extract(document,'$.plan.releaseId') DESC) AS position FROM winget_submissions) WHERE position=1",
		).pipe(Effect.flatMap(rows => this.documents(rows)));
	}

	get(id: string): Effect.Effect<WinGetSubmission | undefined, DomainError> {
		return this.sql.first('SELECT document FROM winget_submissions WHERE id=?', id).pipe(
			Effect.flatMap(row =>
				fromSync(() => {
					const parsed = decodeSync(Schema.NullOr(documentRow), row);
					return parsed ? parseSubmission(parsed.document) : undefined;
				})
			),
		);
	}

	insert(pending: WinGetSubmission): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'INSERT OR IGNORE INTO winget_submissions(id,package,version,document,updated_at) VALUES(?,?,?,?,?)',
			pending.plan.id,
			pending.plan.packageIdentifier,
			pending.plan.version,
			JSON.stringify(pending),
			pending.updatedAt,
		).pipe(Effect.asVoid);
	}

	lock(id: string, lease: string, until: number, now: number): Effect.Effect<boolean, DomainError> {
		return this.sql.run(
			'UPDATE winget_submissions SET lease=?,lease_until=? WHERE id=? AND lease_until<?',
			lease,
			until,
			id,
			now,
		).pipe(Effect.map(locked => locked.meta.changes > 0));
	}

	unlock(id: string, lease: string): Effect.Effect<void, DomainError> {
		return this.sql.run('UPDATE winget_submissions SET lease_until=0 WHERE id=? AND lease=?', id, lease).pipe(
			Effect.asVoid,
		);
	}

	save(value: WinGetSubmission, lease: string): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'UPDATE winget_submissions SET document=?,updated_at=? WHERE id=? AND lease=?',
			JSON.stringify(value),
			value.updatedAt,
			value.plan.id,
			lease,
		).pipe(Effect.asVoid);
	}

	replace(pending: WinGetSubmission, lease: string, now: number): Effect.Effect<boolean, DomainError> {
		return this.sql.run(
			'UPDATE winget_submissions SET package=?,version=?,document=?,updated_at=? WHERE id=? AND lease=? AND lease_until>?',
			pending.plan.packageIdentifier,
			pending.plan.version,
			JSON.stringify(pending),
			pending.updatedAt,
			pending.plan.id,
			lease,
			now,
		).pipe(Effect.map(updated => updated.meta.changes > 0));
	}

	settle(value: WinGetSubmission, updatedAt: number, now: number): Effect.Effect<void, DomainError> {
		return this.sql.run(
			'UPDATE winget_submissions SET document=?,updated_at=? WHERE id=? AND lease_until<?',
			JSON.stringify(value),
			updatedAt,
			value.plan.id,
			now,
		).pipe(Effect.asVoid);
	}

	open(after: string | null, now: number): Effect.Effect<{ id: string; document: string }[], DomainError> {
		return this.sql.all(
			"SELECT id,document FROM winget_submissions WHERE json_extract(document,'$.state') IN ('open','pending') AND lease_until<? AND (? IS NULL OR id>?) ORDER BY id LIMIT 100",
			now,
			after,
			after,
		).pipe(Effect.flatMap(rows => parse(mutableArray(submissionRow), rows)));
	}

	watch(repositoryId: number, since: number): Effect.Effect<void, DomainError> {
		return this.sql.run('INSERT OR IGNORE INTO winget_watches(repository_id,since) VALUES(?,?)', repositoryId, since)
			.pipe(Effect.asVoid);
	}

	unwatch(repositoryId: number): Effect.Effect<void, DomainError> {
		return this.sql.run('DELETE FROM winget_watches WHERE repository_id=?', repositoryId).pipe(Effect.asVoid);
	}

	watchedSince(repositoryId: number): Effect.Effect<number | undefined, DomainError> {
		return this.sql.first('SELECT since FROM winget_watches WHERE repository_id=?', repositoryId).pipe(
			Effect.flatMap(row => parse(watchRow, row)),
			Effect.map(watch => watch?.since),
		);
	}
}
