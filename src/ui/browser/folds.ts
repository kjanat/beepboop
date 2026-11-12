import { Schema } from 'effect';
import type { Decoded } from '@/schema';
import { decodeSync, mutableRecord, mutableStruct } from '@/schema';

const key = 'beepboop:folds';
const choices = mutableRecord(Schema.String, mutableStruct({ initial: Schema.Boolean, open: Schema.Boolean }));
type Choices = Decoded<typeof choices>;

function read(storage: Pick<Storage, 'getItem'>): Choices {
	try {
		return decodeSync(choices, JSON.parse(storage.getItem(key) ?? '{}'));
	} catch {
		return {};
	}
}

type FoldStorage = Pick<Storage, 'getItem' | 'setItem'>;

function opened(open: () => FoldStorage): FoldStorage | undefined {
	try {
		return open();
	} catch {
		return undefined;
	}
}

export function rememberFolds(root: ParentNode, open: () => FoldStorage): void {
	const storage = opened(open);
	if (!storage) return;
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
