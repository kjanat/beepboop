import { Effect } from 'effect';
import { routes } from '@/contract/routes';
import { checkChoices } from '@/domain/release-gates.ts';
import { api } from '@/ui/browser/api';
import { oneOf } from '@/ui/browser/dom.ts';

export function chooseChecks(id: string, clicked: string) {
	return Effect.gen(function*() {
		const choice = yield* oneOf(checkChoices, clicked, 'Choose rerun, skip or always.');
		return yield* api(routes.executionsChecks, { id, choice });
	});
}
