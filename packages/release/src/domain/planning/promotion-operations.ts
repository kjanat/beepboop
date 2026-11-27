import { Result } from 'effect';
import type { Stream } from '@/domain/configuration/schema.ts';
import { dependencyOrder } from '@/kernel/collections/dependency-order.ts';
import { invalid } from '@/kernel/schema/result.ts';

/** Select downstream workflows and the prerequisites they share. */
export function promotionOperations(stream: Stream) {
	const workflows = new Map(
		Object.entries(stream.workflows).filter(([, binding]) =>
			binding.mode !== 'observe' && binding.each !== 'package' && !binding.backfill
		),
	);
	const needs = (name: string) => workflows.get(name)?.needs ?? [];
	const cycle = (name: string) => invalid(`Operation dependency cycle: ${name}`);
	return Result.gen(function*() {
		const order = yield* dependencyOrder(workflows.keys(), name => Result.succeed(needs(name)), cycle);
		const downstream = new Set(['promote']);
		for (const name of order) {
			if (needs(name).some(dependency => downstream.has(dependency))) downstream.add(name);
		}
		const required = yield* dependencyOrder(downstream, name => Result.succeed(needs(name)), cycle);
		return required.filter(name => workflows.has(name));
	});
}
