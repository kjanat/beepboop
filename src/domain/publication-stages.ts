export function publicationStages(
	ids: readonly string[],
	needs: Readonly<Record<string, readonly string[]>>,
): string[][] {
	const remaining = [...new Set(ids)];
	const done = new Set<string>();
	const stages: string[][] = [];
	while (remaining.length) {
		const ready = remaining.filter(id =>
			(needs[id] ?? []).every(dependency => done.has(dependency) || !remaining.includes(dependency))
		);
		const stage = ready.length ? ready : [...remaining];
		stages.push(stage);
		for (const id of stage) {
			done.add(id);
			remaining.splice(remaining.indexOf(id), 1);
		}
	}
	return stages;
}
