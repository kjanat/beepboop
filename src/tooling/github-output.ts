import { appendFileSync } from 'node:fs';

export function outputEntry(name: string, value: string): string {
	if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw new Error(`Invalid output name: ${name}`);
	const marker = `value_${crypto.randomUUID()}`;
	return `${name}<<${marker}\n${value}\n${marker}\n`;
}

export function writeOutput(name: string, value: string): void {
	const file = process.env.GITHUB_OUTPUT;
	if (!file) throw new Error('GITHUB_OUTPUT is required');
	appendFileSync(file, outputEntry(name, value));
}
