const maximumBytes = 1_000_000;

/** Keep JSON parameters below D1's string limit; oversized rows need individual bindings. */
export function jsonBatches<T>(rows: readonly T[]): ({ json: string } | { row: T })[] {
	const result: ({ json: string } | { row: T })[] = [];
	const encoder = new TextEncoder();
	let batch: string[] = [], bytes = 2;
	const flush = () => {
		if (batch.length) result.push({ json: `[${batch.join(',')}]` });
		batch = [];
		bytes = 2;
	};
	for (const row of rows) {
		const encoded = JSON.stringify(row);
		const size = encoder.encode(encoded).byteLength;
		if (bytes + size + Number(batch.length > 0) > maximumBytes) flush();
		if (size + 2 > maximumBytes) result.push({ row });
		else {
			bytes += size + Number(batch.length > 0);
			batch.push(encoded);
		}
	}
	flush();
	return result;
}
