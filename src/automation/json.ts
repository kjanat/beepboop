export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };

const width = 80;

export function json(value: unknown): Json {
	if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) return value.map(json);
	if (typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, item === undefined ? undefined : json(item)] as const),
		);
	}
	throw new Error('Expected JSON value');
}

export function formatJson(value: Json): string {
	return `${render(value, '', 0, 0)}\n`;
}

function render(value: Json, indent: string, lead: number, trail: number): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	const inner = `${indent}  `;
	if (Array.isArray(value)) {
		if (!value.length) return '[]';
		if (value.every(item => item === null || typeof item !== 'object')) {
			const line = `[${value.map(item => JSON.stringify(item)).join(', ')}]`;
			if (lead + line.length + trail <= width) return line;
		}
		const items = value.map((item, index) =>
			`${inner}${render(item, inner, inner.length, index < value.length - 1 ? 1 : 0)}`
		);
		return `[\n${items.join(',\n')}\n${indent}]`;
	}
	const entries = Object.entries(value).filter((entry): entry is [string, Json] => entry[1] !== undefined);
	if (!entries.length) return '{}';
	const lines = entries.map(([key, item], index) => {
		const head = `${inner}${JSON.stringify(key)}: `;
		return `${head}${render(item, inner, head.length, index < entries.length - 1 ? 1 : 0)}`;
	});
	return `{\n${lines.join(',\n')}\n${indent}}`;
}
