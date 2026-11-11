import { expect, test } from 'bun:test';
import { widgetConfiguration } from '@root/test/support/repositories.ts';
import { Effect, Result } from 'effect';
import { z } from 'zod';
import { companionProposals } from '@/automation/companion-detection';
import { parseRepositoryConfiguration } from '@/automation/configuration';
import { packageId } from '@/automation/package-identity';
import { registry } from '@/automation/package-publication';
import type { RefPolicy } from '@/automation/refs';
import { planRefs, streamModuleTagPrefixes } from '@/automation/refs';
import type { SetupChoices } from '@/automation/setup-types';
import type { Inventory, Package, Snapshot } from '@/automation/types';
import { configurationDrift, configurationSchema } from '@/domain/configuration';
import { validateAgainst } from '@/domain/validate';
import { storedConfiguration } from '@/persistence/codecs/configuration';

const commit = 'a'.repeat(40);
const policy: RefPolicy = { phase: 'version', prefix: 'rshellcheck-v', aliases: [], signed: false };
const goModule: Package = {
	manager: 'go',
	name: 'github.com/octo/shellcheck/go',
	manifest: 'go/go.mod',
	versionSource: 'tags:go/v',
	publication: registry,
	dependencies: [],
};
const crate: Package = {
	manager: 'cargo',
	name: 'rshellcheck',
	version: '1.0.0',
	manifest: 'Cargo.toml',
	versionSource: 'manifest:Cargo.toml',
	publication: registry,
	dependencies: [],
};
const module = packageId(goModule), cargo = packageId(crate);

test('a stream pushes the tag of each companion module beside its own tag', async () => {
	const packages = [goModule, crate];
	const stream = { packages: [cargo], companionModules: [module] };
	expect(streamModuleTagPrefixes(packages, stream)).toEqual(['go/v']);
	const changes = await Effect.runPromise(
		planRefs(policy, '1.1.0', commit, [], streamModuleTagPrefixes(packages, stream)),
	);
	expect(changes.map(change => [change.name, change.commit, change.annotated])).toEqual([
		['rshellcheck-v1.1.0', commit, true],
		['go/v1.1.0', commit, true],
	]);
});

test('a stream without companion modules pushes only its own tag', async () => {
	const packages = [goModule, crate];
	expect(streamModuleTagPrefixes(packages, { packages: [cargo] })).toEqual([]);
	expect(streamModuleTagPrefixes(packages, undefined)).toEqual([]);
	const changes = await Effect.runPromise(planRefs(policy, '1.1.0', commit, [], streamModuleTagPrefixes(packages, {})));
	expect(changes.map(change => change.name)).toEqual(['rshellcheck-v1.1.0']);
});

test('a module named in packages and companionModules is tagged once', () => {
	expect(streamModuleTagPrefixes([goModule], { packages: [module], companionModules: [module] })).toEqual(['go/v']);
});

test('companionModules reads the same through the schema, the parser and the stored codec', () => {
	const document = z.looseObject({ streams: z.looseObject({ main: z.looseObject({}) }) }).parse(
		JSON.parse(widgetConfiguration()),
	);
	document.streams.main.companionModules = [module];
	const parsed = configurationSchema.parse(document);
	expect(parsed.streams.main?.companionModules).toEqual([module]);
	const configuration = parseRepositoryConfiguration(document);
	if (Result.isFailure(configuration)) throw configuration.failure;
	expect(configuration.success.streams.main?.companionModules).toEqual([module]);
	expect(configurationDrift(document, configuration.success)).toEqual([]);
	const encoded = JSON.stringify(parsed);
	expect(JSON.stringify(storedConfiguration.parse(JSON.parse(encoded)))).toBe(encoded);
	document.streams.main.companionModules = 'pkg:golang/github.com/octo/shellcheck/go';
	expect(configurationSchema.safeParse(document).success).toBe(false);
	expect(Result.isFailure(parseRepositoryConfiguration(document))).toBe(true);
});

test('validation warns when a companion module is already in packages', () => {
	const document = z.looseObject({ streams: z.looseObject({ main: z.looseObject({}) }) }).parse(
		JSON.parse(widgetConfiguration()),
	);
	document.streams.main.packages = [module];
	document.streams.main.companionModules = [module];
	const inventory: Inventory = {
		packages: [goModule],
		workflows: [],
		managers: ['go'],
		diagnostics: [],
		publicationOrder: [],
	};
	const found = validateAgainst(configurationSchema.parse(document), inventory, {
		paths: ['.github/workflows/publish.yml', '.github/workflows/ci.yml'],
	}).filter(entry => entry.code === 'companion-module');
	expect(found.map(entry => [entry.severity, entry.message])).toEqual([[
		'warning',
		`Stream main lists ${module} in packages and companionModules; packages already pushes its tag`,
	]]);
});

const inventory: Inventory = {
	packages: [crate, goModule],
	workflows: [],
	managers: ['cargo', 'go'],
	diagnostics: [],
	publicationOrder: [],
};
const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
	repository: { id: 1, name: 'octo/shellcheck', defaultBranch: 'main' },
	sha: commit,
	files: {},
	paths: [],
	...overrides,
});
const choices = (overrides: Partial<SetupChoices['streams'][number]> = {}): SetupChoices => ({
	streams: [
		{
			name: 'main',
			packages: [cargo],
			required: [cargo],
			versioning: 'workspace',
			promote: {
				file: 'release-rshellcheck.yml',
				triggers: 'review',
				commands: '',
				publicationSteps: {},
				tagPrefix: 'rshellcheck-v',
			},
			...overrides,
		},
		{
			name: 'go',
			packages: [module],
			required: [module],
			versioning: 'workspace',
			versionSource: { kind: 'tags', prefix: 'go/v' },
		},
	],
});

test('a module whose tags track another stream gets a proposal naming both options', () => {
	const [note, ...rest] = companionProposals(
		choices(),
		snapshot({ tags: ['go/v1.0.0', 'rshellcheck-v1.0.0', 'rshellcheck-v1.1.0'] }),
		inventory,
	);
	expect(rest).toEqual([]);
	expect(note).toContain('main: github.com/octo/shellcheck/go tags `go/v<version>` in its own stream `go`');
	expect(note).toContain('every `go/v<version>` tag has a matching `rshellcheck-v<version>` tag');
	expect(note).toContain(`set \`companionModules\` of \`main\` to \`${module}\``);
	expect(note).toContain('--stream main --companion-module github.com/octo/shellcheck/go');
	expect(note).toContain(`move ${module} into \`packages\` of \`main\``);
	expect(note).toContain('Both stay proposals until you choose.');
});

test('a module whose tags diverge from the other stream gets no proposal', () => {
	expect(companionProposals(choices(), snapshot({ tags: ['go/v1.0.0', 'go/v1.0.1', 'rshellcheck-v1.0.0'] }), inventory))
		.toEqual([]);
	expect(companionProposals(choices(), snapshot({ tags: ['rshellcheck-v1.0.0'] }), inventory)).toEqual([]);
	expect(companionProposals(choices(), snapshot(), inventory)).toEqual([]);
});

test('a script that builds both tags gets a proposal', () => {
	const files = { '.github/release/release.py': 'tag = f"rshellcheck-v{version}"\ncompanion = f"go/v{version}"\n' };
	const [note] = companionProposals(choices(), snapshot({ files }), inventory);
	expect(note).toContain('`.github/release/release.py` refers to `go/v<version>` and `rshellcheck-v<version>`');
});

test('a file that mentions only one of the tags, or Go sources, gets no proposal', () => {
	const only = { 'release.sh': 'git tag "go/v${version}"\n' };
	const code = { 'go/go.mod': 'module x/go/v2\n', 'go/main.go': 'import "x/go/v2"\n"rshellcheck-v1"\n' };
	expect(companionProposals(choices(), snapshot({ files: only }), inventory)).toEqual([]);
	expect(companionProposals(choices(), snapshot({ files: code }), inventory)).toEqual([]);
});

test('a module the other stream already pushes, by companionModules or packages, gets no proposal', () => {
	const tags = ['go/v1.0.0', 'rshellcheck-v1.0.0'];
	expect(companionProposals(choices({ companionModules: [module] }), snapshot({ tags }), inventory)).toEqual([]);
	const joined = choices().streams.map(stream =>
		stream.name === 'main' ? { ...stream, packages: [cargo, module] } : stream
	);
	expect(
		companionProposals({ streams: joined.filter(stream => stream.name === 'main') }, snapshot({ tags }), inventory),
	)
		.toEqual([]);
});
