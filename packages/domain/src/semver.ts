import type { Parsed } from '@/kernel/schema/result.ts';
import { matches } from '@/kernel/schema/result.ts';

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
export function aliasSeries(version: import('./version.ts').SemVer, alias: 'major' | 'minor'): string {
	return precedence(version).core.slice(0, alias === 'major' ? 1 : 2).join('.');
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

/** Binary text ordering equivalent to SemVer precedence; build metadata has no effect. */
export function precedenceKey(version: string): string | undefined {
	const normalized = version.replace(/^v/, '');
	if (!bareSemverPattern.test(normalized)) return undefined;
	const parsed = precedence(normalized);
	// Fixed-width length prefixes order arbitrary-precision numbers without numeric conversion.
	const number = (value: string) => `${value.length.toString(16).padStart(16, '0')}${value}`;
	const core = parsed.core.map(value => number(String(value))).join('!');
	const pre = parsed.pre.length
		? `0${parsed.pre.map(value => /^\d+$/.test(value) ? `0${number(value)}` : `1${value}`).join('!')}!`
		: '1';
	return `${core}!${pre}`;
}
export function semver(value: unknown): Parsed<string> {
	return matches(value, semverPattern);
}
/** Versions that are not semver order before every valid version. */
export function compareVersions(left: string, right: string): number {
	const a = semverPattern.test(left), b = semverPattern.test(right);
	if (!a || !b) return a === b ? 0 : a ? 1 : -1;
	return compare(left.replace(/^v/, ''), right.replace(/^v/, ''));
}
