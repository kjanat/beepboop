import { Schema } from 'effect';
import type { Decoded } from '@/schema';
import { decodeSync, mutableRecord, mutableStruct } from '@/schema';

const key = 'beepboop:folds';
const maximumChoices = 1024;
const maximumBytes = 256_000;
const choices = mutableRecord(Schema.String, mutableStruct({ initial: Schema.Boolean, open: Schema.Boolean }));
type Choices = Decoded<typeof choices>;

function read(storage: Pick<Storage, 'getItem'>): Choices {
	try {
		const value = storage.getItem(key) ?? '{}';
		return value.length > maximumBytes ? {} : decodeSync(choices, JSON.parse(value));
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
	const folds = [...root.querySelectorAll<HTMLDetailsElement>('details[data-fold]')];
	const visible = new Set(folds.map(fold => fold.dataset.fold));
	for (const fold of folds) {
		const id = fold.dataset.fold;
		if (!id) continue;
		const initial = fold.open;
		const choice = saved[id];
		if (choice?.initial === initial) fold.open = choice.open;
		fold.querySelector(':scope > summary')?.addEventListener('click', () => {
			const before = fold.open;
			setTimeout(() => {
				if (fold.open === before) return;
				try {
					const previous = read(storage);
					delete previous[id];
					const retained = Object.entries(previous).sort(([a], [b]) => Number(visible.has(a)) - Number(visible.has(b)))
						.slice(-(maximumChoices - 1));
					storage.setItem(key, JSON.stringify(Object.fromEntries([...retained, [id, { initial, open: fold.open }]])));
				} catch {
					return;
				}
			});
		});
	}
}
