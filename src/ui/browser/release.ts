import { Effect } from 'effect';
import { routes } from '@/contract/routes';
import type { Encoded } from '@/kernel/schema/structs.ts';
import { api } from '@/ui/browser/api';

export function submitRelease(request: Encoded<typeof routes.releasesPlan.request>) {
	return Effect.gen(function*() {
		const reviewed = yield* api(routes.releasesPlan, request);
		return yield* api(routes.releasesPrepare, {
			...request,
			sourceSha: reviewed.sourceSha,
			planId: reviewed.planId,
			start: reviewed.starts,
		});
	});
}
