import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import { parseTypeDefinition } from '@/package-url/definition';

const root = resolve(import.meta.dir, '../../package-url');
const { values: { check } } = parseArgs({
	args: Bun.argv.slice(2),
	options: { check: { type: 'boolean' } },
	strict: true,
});
async function emit(path: string, source: string): Promise<void> {
	const formatter = Bun.spawn(['bunx', 'kfmt', '--stdin', path], { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' });
	formatter.stdin.write(source);
	formatter.stdin.end();
	const output = await new Response(formatter.stdout).text();
	if (await formatter.exited !== 0) throw new Error('Cannot format generated types');
	if (check) {
		if (!await Bun.file(path).exists() || await Bun.file(path).text() !== output) {
			throw new Error(`Generated PURL types are stale: ${path}`);
		}
	} else await Bun.write(path, output);
}
const banner = '/* Generated from pinned upstream PURL data by bun run purl:generate. Do not edit. */';
const schema = await Bun.file(`${root}/type-definition.schema.json`).json() as JSONSchema;
const definitionTypes = await compile(schema, 'TypeDefinition', {
	bannerComment: banner,
	style: { singleQuote: true, useTabs: true },
});
await emit(`${root}/definition.generated.ts`, definitionTypes);
const names = (await readdir(`${root}/definitions`)).filter(name => name.endsWith('-definition.json')).sort();
const imports: string[] = [];
const identities: string[] = [];
const typeNames: string[] = [];
for (const [index, filename] of names.entries()) {
	const definition = parseTypeDefinition(await Bun.file(`${root}/definitions/${filename}`).json());
	if (filename !== `${definition.type}-definition.json`) throw new Error(`Type filename mismatch: ${filename}`);
	imports.push(`import definition${index} from '@/package-url/definitions/${filename}';`);
	typeNames.push(JSON.stringify(definition.type));
	const namespace = definition.namespace_definition.requirement === 'prohibited'
		? 'namespace?: never;'
		: definition.namespace_definition.requirement === 'required'
		? 'namespace: string;'
		: 'namespace?: string;';
	const qualifiers = (definition.qualifiers_definition ?? []).map((q: { key: string; requirement?: string }) =>
		`${JSON.stringify(q.key)}${q.requirement === 'required' ? '' : '?'}: string;`
	).join(' ');
	const requiredQualifiers = (definition.qualifiers_definition ?? []).some((q: { requirement?: string }) =>
		q.requirement === 'required'
	);
	identities.push(
		`{ type: ${JSON.stringify(definition.type)}; ${namespace} name: string; version?: string; qualifiers${
			requiredQualifiers ? '' : '?'
		}: Record<string, string> & { ${qualifiers} }; subpath?: string; }`,
	);
}
await emit(
	`${root}/definitions/index.ts`,
	`${banner}\n${imports.join('\n')}\nexport default [${names.map((_, i) => `definition${i}`).join(', ')}];\n`,
);
await emit(
	`${root}/identity.generated.ts`,
	`${banner}\nexport type RegisteredPackageType = ${typeNames.join(' | ')};\nexport type RegisteredPackageIdentity =\n${
		identities.map(value => `\t| ${value}`).join('\n')
	};\n`,
);
