import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect } from 'effect';
import { compile } from 'json-schema-to-typescript';
import { record } from '@/model';
import { parseTypeDefinition } from '@/package-url/definition';
import { attempt, attemptPromise, format, main, readJson, readText, refuse, type ToolFailure } from '@/tooling/runtime';

const root = resolve(import.meta.dir, '../../package-url');
const banner =
	'/* Generated from pinned upstream PURL data and local extensions by bun run purl:generate. Do not edit. */';

function definitionFiles(directory: string): Effect.Effect<string[], ToolFailure> {
	return attemptPromise(() => readdir(`${root}/${directory}`)).pipe(
		Effect.map(names => names.filter(name => name.endsWith('-definition.json')).sort()),
	);
}

await main(Effect.gen(function*() {
	const { values: { check } } = yield* attempt(() =>
		parseArgs({ args: Bun.argv.slice(2), options: { check: { type: 'boolean' } }, strict: true })
	);
	const emit = (path: string, source: string) =>
		Effect.gen(function*() {
			const output = yield* format(path, source).pipe(Effect.catch(() => refuse('Cannot format generated types')));
			if (!check) return yield* attemptPromise(() => Bun.write(path, output));
			if ((yield* readText(path)) !== output) return yield* refuse(`Generated PURL types are stale: ${path}`);
		});
	const schema = record(yield* readJson(`${root}/type-definition.schema.json`));
	const definitionTypes = yield* attemptPromise(() =>
		compile(schema, 'TypeDefinition', { bannerComment: banner, style: { singleQuote: true, useTabs: true } })
	);
	yield* emit(`${root}/definition.generated.ts`, definitionTypes);
	const names = yield* definitionFiles('definitions');
	const extensions = yield* definitionFiles('extensions');
	if (extensions.some(name => names.includes(name))) {
		return yield* refuse('A local PURL extension now exists upstream; reconcile its definition before generating');
	}
	const sources = [...names.map(name => `definitions/${name}`), ...extensions.map(name => `extensions/${name}`)];
	const imports: string[] = [];
	const identities: string[] = [];
	const typeNames: string[] = [];
	for (const [index, source] of sources.entries()) {
		const filename = source.split('/').at(-1);
		const value = yield* readJson(`${root}/${source}`);
		const definition = yield* attempt(() => parseTypeDefinition(value));
		if (filename !== `${definition.type}-definition.json`) return yield* refuse(`Type filename mismatch: ${filename}`);
		imports.push(`import definition${index} from '@/package-url/${source}';`);
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
	yield* emit(
		`${root}/definitions/index.ts`,
		`${banner}\n${imports.join('\n')}\nexport default [${sources.map((_, i) => `definition${i}`).join(', ')}];\n`,
	);
	yield* emit(
		`${root}/identity.generated.ts`,
		`${banner}\nexport type RegisteredPackageType = ${
			typeNames.slice(0, names.length).join(' | ')
		};\nexport type RegisteredPackageIdentity =\n${
			identities.slice(0, names.length).map(value => `\t| ${value}`).join('\n')
		};\nexport type ProposedPackageType = ${
			typeNames.slice(names.length).join(' | ')
		};\nexport type ProposedPackageIdentity = ${
			identities.slice(names.length).join(' | ')
		};\nexport type KnownPackageType = RegisteredPackageType | ProposedPackageType;\nexport type KnownPackageIdentity = RegisteredPackageIdentity | ProposedPackageIdentity;\n`,
	);
}));
