const numeric = '0|[1-9][0-9]*';
const identifier = `${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*`;
const grammar =
	`(${numeric})\\.(${numeric})\\.(${numeric})(?:-((?:${identifier})(?:\\.(?:${identifier}))*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?`;
export const semverPattern = new RegExp(`^v?${grammar}$`);
export const bareSemverPattern = new RegExp(`^${grammar}$`);

function precedence(version: string): { core: bigint[]; pre: string[] } {
	const [main = ''] = version.split('+');
	const dash = main.indexOf('-');
	return {
		core: (dash < 0 ? main : main.slice(0, dash)).split('.').map(BigInt),
		pre: dash < 0 ? [] : main.slice(dash + 1).split('.'),
	};
}
export function isPrerelease(version: string): boolean {
	return precedence(version).pre.length > 0;
}
export function compare(left: string, right: string): -1 | 0 | 1 {
	const a = precedence(left), b = precedence(right);
	for (let i = 0; i < 3; i++) {
		const x = a.core[i] ?? 0n, y = b.core[i] ?? 0n;
		if (x !== y) return x < y ? -1 : 1;
	}
	if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
	for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
		const x = a.pre[i], y = b.pre[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
		if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
		if (xn !== yn) return xn ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}
