import { object } from '@/automation/managers/helpers';

export function matrixScalar(value: unknown): string | undefined {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
		? String(value)
		: undefined;
}
export const matrixLimit = 256;
function flatten(key: string, value: unknown): Record<string, string>[] {
	const scalar = matrixScalar(value);
	if (scalar !== undefined) return [{ [key]: scalar }];
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
	const merged: Record<string, string> = {};
	for (const [name, inner] of Object.entries(object(value))) {
		for (const part of flatten(`${key}.${name}`, inner)) Object.assign(merged, part);
	}
	return Object.keys(merged).length ? [merged] : [];
}
function flatRow(entry: Record<string, unknown>): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const [key, value] of Object.entries(entry)) {
		for (const part of flatten(key, value)) Object.assign(merged, part);
	}
	return merged;
}
export function matrixCombinations(matrix: Record<string, unknown>): Record<string, string>[] {
	const keys = Object.keys(matrix).filter(key => key !== 'include' && key !== 'exclude' && Array.isArray(matrix[key]));
	let combinations: Record<string, string>[] = keys.length ? [{}] : [];
	const original = new Set<string>();
	for (const key of keys) {
		const values = (Array.isArray(matrix[key]) ? matrix[key] : []).flatMap(value => flatten(key, value));
		if (combinations.length * values.length > matrixLimit) break;
		for (const value of values) for (const name of Object.keys(value)) original.add(name);
		combinations = combinations.flatMap(combination => values.map(value => ({ ...combination, ...value })));
	}
	const row = flatRow;
	const exclusions = (Array.isArray(matrix.exclude) ? matrix.exclude : []).map(entry => row(object(entry))).filter(
		entry => Object.keys(entry).length > 0,
	);
	combinations = combinations.filter(combination =>
		!exclusions.some(entry => Object.entries(entry).every(([key, value]) => combination[key] === value))
	);
	const added: Record<string, string>[] = [];
	for (const entry of (Array.isArray(matrix.include) ? matrix.include : []).map(item => row(object(item)))) {
		if (!Object.keys(entry).length) continue;
		const targets = combinations.filter(combination =>
			Object.entries(entry).every(([key, value]) => !original.has(key) || combination[key] === value)
		);
		const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !original.has(key)));
		if (keys.length && targets.length) {
			combinations = combinations.map(combination =>
				targets.includes(combination) ? { ...combination, ...extra } : combination
			);
		} else {
			added.push(entry);
		}
	}
	return [...combinations, ...added];
}
export const matrixExpression = /\$\{\{\s*matrix\.([\w-]+(?:\.[\w-]+)*)\s*\}\}/g;
export function substitute(text: string, assignment: Record<string, string>): string {
	return text.replace(matrixExpression, (expression, key: string) => assignment[key] ?? expression);
}
const guardKey = /\bmatrix\.([\w-]+(?:\.[\w-]+)*)/g;
const reference = '((?:matrix|inputs|github\\.event\\.inputs)\\.[\\w-]+(?:\\.[\\w-]+)*)';
const comparison = new RegExp(
	`^(?:${reference}\\s*(==|!=)\\s*(?:'([^']*)'|(true|false))|(?:'([^']*)'|(true|false))\\s*(==|!=)\\s*${reference})$`,
);
const truthiness = new RegExp(`^(!?)\\s*${reference}$`);
export interface GuardValues {
	matrix?: Readonly<Record<string, string>>;
	inputs?: Readonly<Record<string, string>>;
}
function lookup(path: string, values: GuardValues): string | undefined {
	if (path.startsWith('matrix.')) return values.matrix?.[path.slice('matrix.'.length)];
	return values.inputs?.[path.replace(/^(?:github\.event\.)?inputs\./, '')];
}
function evaluateTerm(term: string, values: GuardValues): boolean | undefined {
	const trimmed = term.trim().replace(/^\(\s*|\s*\)$/g, '').trim();
	const compared = comparison.exec(trimmed);
	if (compared) {
		const path = compared[1] ?? compared[8] ?? '';
		const literal = compared[3] ?? compared[4] ?? compared[5] ?? compared[6] ?? '';
		const operator = compared[2] ?? compared[7];
		const value = lookup(path, values);
		if (value === undefined) return undefined;
		return operator === '==' ? value === literal : value !== literal;
	}
	const bare = truthiness.exec(trimmed);
	if (bare) {
		const value = lookup(bare[2] ?? '', values);
		if (value === undefined) return undefined;
		const truthy = !(value === '' || value === 'false' || value === '0');
		return bare[1] ? !truthy : truthy;
	}
	return undefined;
}
export function staticGuard(condition: unknown, values: GuardValues): boolean | undefined {
	if (typeof condition !== 'string') return undefined;
	const unwrapped = condition.trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1').trim();
	const evaluated = unwrapped.split('||').map(alternative => {
		const terms = alternative.split('&&').map(term => evaluateTerm(term, values));
		return terms.includes(false) ? false : terms.every(term => term === true) ? true : undefined;
	});
	return evaluated.includes(true) ? true : evaluated.every(result => result === false) ? false : undefined;
}
export function expandStep(step: Record<string, unknown>, matrix: Record<string, unknown>): Record<string, unknown>[] {
	const directory = step['working-directory'];
	const texts = [step.run, directory, ...Object.values(object(step.with))].filter((value): value is string =>
		typeof value === 'string'
	);
	const combinations = matrixCombinations(matrix);
	const guards = typeof step.if === 'string' ? [...step.if.matchAll(guardKey)].flatMap(match => match[1] ?? []) : [];
	const keys = [
		...new Set([
			...texts.flatMap(text => [...text.matchAll(matrixExpression)].flatMap(match => match[1] ?? [])),
			...guards,
		]),
	]
		.filter(key => combinations.some(combination => combination[key] !== undefined));
	if (!keys.length) return [step];
	const assignments = [
		...new Map(
			combinations.map(combination =>
				Object.fromEntries(
					keys.flatMap(key => combination[key] === undefined ? [] : [[key, combination[key]] as const]),
				)
			).map(assignment => [JSON.stringify(assignment), assignment] as const),
		).values(),
	].filter(assignment => staticGuard(step.if, { matrix: assignment }) !== false).slice(0, matrixLimit);
	const apply = (assignment: Record<string, string>): Record<string, unknown> => ({
		...step,
		...(typeof step.run === 'string' ? { run: substitute(step.run, assignment) } : {}),
		...(typeof directory === 'string' ? { 'working-directory': substitute(directory, assignment) } : {}),
		...(step.with !== undefined
			? {
				with: Object.fromEntries(
					Object.entries(object(step.with)).map((
						[key, value],
					) => [key, typeof value === 'string' ? substitute(value, assignment) : value]),
				),
			}
			: {}),
	});
	return assignments.map(apply);
}
export function disabled(condition: unknown): boolean {
	return condition === false
		|| (typeof condition === 'string' && /^\s*(?:\$\{\{\s*false\s*\}\}|false)\s*$/.test(condition));
}

export const inputExpression = /\$\{\{\s*(?:github\.event\.)?inputs\.([\w-]+)\s*\}\}/g;
export function literalBindings(values: Record<string, unknown>): Record<string, string> {
	const bindings: Record<string, string> = {};
	for (const [key, input] of Object.entries(values)) {
		if (
			(typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean')
			&& !String(input).includes('${{')
		) {
			bindings[key] = String(input);
		}
	}
	return bindings;
}
export function inputDefaults(declared: unknown, passed: readonly string[]): Record<string, string> {
	return Object.fromEntries(
		Object.entries(object(declared)).flatMap(([key, input]) => {
			const fallback = matrixScalar(object(input).default);
			return passed.includes(key) || fallback === undefined || fallback.includes('${{')
				? []
				: [[key, fallback] as const];
		}),
	);
}
export function bindInputs(text: string, bindings: Readonly<Record<string, string>>): string {
	return text.replace(inputExpression, (expression, key: string) => bindings[key] ?? expression);
}
export function bindStep(
	step: Record<string, unknown>,
	bindings: Readonly<Record<string, string>>,
): Record<string, unknown> {
	if (!Object.keys(bindings).length) return step;
	const bound = (value: unknown) => typeof value === 'string' ? bindInputs(value, bindings) : value;
	return {
		...step,
		...(step.run !== undefined ? { run: bound(step.run) } : {}),
		...(step['working-directory'] !== undefined ? { 'working-directory': bound(step['working-directory']) } : {}),
		...(step.with !== undefined
			? { with: Object.fromEntries(Object.entries(object(step.with)).map(([key, value]) => [key, bound(value)])) }
			: {}),
	};
}
