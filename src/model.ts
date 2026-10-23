export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Expected object');
	}
	return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error('Expected nonempty string');
	return value;
}
export function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new Error('Expected positive integer');
	}
	return value;
}
export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Expected array');
	return value;
}
export function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new Error('Expected boolean');
	return value;
}
export function matches(value: unknown, pattern: RegExp): string {
	const result = text(value);
	if (!pattern.test(result)) throw new Error('Invalid value format');
	return result;
}
export function sha(value: unknown): string {
	return matches(value, /^[0-9a-f]{40}$/);
}
export function semver(value: unknown): string {
	return matches(
		value,
		/^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
	);
}
export function isPrerelease(value: string): boolean {
	return semver(value).split('+')[0]?.includes('-') ?? false;
}
export function compareVersions(left: string, right: string): number {
	const parts = (value: string) => {
		const normalized = semver(value).replace(/^v/, '').split('+')[0] ?? '';
		const dash = normalized.indexOf('-');
		return {
			core: (dash < 0 ? normalized : normalized.slice(0, dash)).split('.').map(BigInt),
			pre: dash < 0 ? [] : normalized.slice(dash + 1).split('.'),
		};
	};
	const a = parts(left),
		b = parts(right);
	for (let i = 0; i < 3; i++) {
		const x = a.core[i],
			y = b.core[i];
		if (x === undefined || y === undefined) throw new Error('Invalid version');
		if (x < y) return -1;
		if (x > y) return 1;
	}
	if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
	for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
		const x = a.pre[i],
			y = b.pre[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		const xn = /^\d+$/.test(x),
			yn = /^\d+$/.test(y);
		if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
		if (xn !== yn) return xn ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}
