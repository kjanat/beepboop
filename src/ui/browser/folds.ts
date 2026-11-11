import { z } from 'zod';

const key = 'beepboop:folds';
const choices = z.record(z.string(), z.object({ initial: z.boolean(), open: z.boolean() }));
type Choices = z.output<typeof choices>;

function read(storage: Pick<Storage, 'getItem'>): Choices {
	try {
		return choices.parse(JSON.parse(storage.getItem(key) ?? '{}'));
	} catch {
		return {};
	}
}

export function rememberFolds(root: ParentNode, storage: Pick<Storage, 'getItem' | 'setItem'>): void {
	const saved = read(storage);
	for (const fold of root.querySelectorAll<HTMLDetailsElement>('details[data-fold]')) {
		const id = fold.dataset.fold;
		if (!id) continue;
		const initial = fold.open;
		const choice = saved[id];
		if (choice?.initial === initial) fold.open = choice.open;
		fold.addEventListener('toggle', () => {
			try {
				storage.setItem(key, JSON.stringify({ ...read(storage), [id]: { initial, open: fold.open } }));
			} catch {
				return;
			}
		});
	}
}
