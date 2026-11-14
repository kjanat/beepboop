import { Effect, Schema } from 'effect';
import { precondition } from '@/contract/errors';
import type { Sql } from '@/persistence/d1/database';
import { parse } from '@/persistence/d1/database';
import { mutableArray, mutableStruct } from '@/schema';

interface Query {
	query: string;
	values: unknown[];
}

const results = mutableStruct({ results: mutableArray(Schema.Unknown) });
const readyResults = Schema.Tuple([results, results]);

export function readyRead(sql: Sql, pending: Query, selected: Query, message: string) {
	return sql.batch([
		sql.statement(pending.query, ...pending.values),
		sql.statement(selected.query, ...selected.values),
	]).pipe(
		Effect.flatMap(result => parse(readyResults, result)),
		Effect.flatMap(([pendingResult, selectedResult]) =>
			pendingResult.results.length ? Effect.fail(precondition(message)) : Effect.succeed(selectedResult.results)
		),
	);
}
