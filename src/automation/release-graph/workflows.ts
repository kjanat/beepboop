import { Result } from 'effect';
import { type ParseError, parse as parseJsonc } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';
import { object, yaml } from '@/automation/managers/helpers';
import type { Snapshot } from '@/automation/types';

export const destinations = [
	'npm',
	'jsr',
	'crates-io',
	'pypi',
	'oci',
	'oci-artifact',
	'github-release',
	'go-proxy',
	'aur',
	'homebrew',
	'scoop',
	'winget',
	'vscode-marketplace',
	'open-vsx',
	'zed-extensions',
	'docs',
] as const;
export type Destination = (typeof destinations)[number];

export type StepEffect =
	| {
		kind: 'publish';
		destination: Destination;
		source: string;
		text: string;
		repository?: string;
		directory?: string;
	}
	| { kind: 'release'; action: 'create' | 'publish' | 'upload'; source: string; text: string; repository?: string }
	| { kind: 'artifact'; direction: 'upload' | 'download'; name: string; source: string }
	| { kind: 'alias'; source: string; text: string }
	| { kind: 'dispatch'; workflow: string; source: string; text: string }
	| { kind: 'tag'; source: string; text: string }
	| { kind: 'preview'; source: string; text: string };

export interface Job {
	id: string;
	needs: string[];
	calls?: string;
	callRef?: string;
	callers?: { caller: string; effects: StepEffect[]; runs: string[] }[];
	own?: StepEffect[];
	ownRuns?: string[];
	environment?: string;
	matrix?: string;
	condition?: string;
	effects: StepEffect[];
	runs: string[];
	actions: string[];
}
export interface Workflow {
	file: string;
	name: string;
	events: string[];
	tagPatterns: string[];
	branchPatterns: string[];
	pathPatterns: string[];
	releaseTypes: string[];
	workflowRuns: string[];
	dispatchInputs: string[];
	dispatchText: string;
	callInputs: string[];
	generator?: string;
	jobs: Job[];
}

interface Pattern {
	destination: Destination;
	command?: RegExp;
	action?: RegExp;
}
const patterns: readonly Pattern[] = [
	{
		destination: 'npm',
		command:
			/\b(?:npm|pnpm|yarn|bun)(?:@[\w.]+)?\s+(?:(?!(?:exec|dlx|x|run|run-script|--)(?:\s|$))[^\s|;&]+\s+)*publish(?![\w:-])|\bargs=\(publish\b|\bchangesets?\s+publish\b|\bsemantic-release\b(?![\w/-])|\blerna\s+publish\b|\bnx\s+release(?:\s+publish)?\b/,
		action: /^JS-DevTools\/npm-publish@/,
	},
	{
		destination: 'jsr',
		command:
			/\b(?:jsr|deno)\s+publish\b|\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+(?:(?:-y|--yes)\s+)?jsr(?:@[\w.-]+)?\s+publish\b/,
	},
	{
		destination: 'crates-io',
		command:
			/\bcargo\s+(?:\+\S+\s+)?publish\b|\bcargo(?:-release|\s+release)\b(?=[^\n;&|]*(?:--execute\b|\s-x(?:\s|$)))|\bcargo\s+(?:workspaces|ws)\s+publish\b/,
		action: /^katyo\/publish-crates@/,
	},
	{
		destination: 'pypi',
		command:
			/\btwine\s+upload\b|\buv\s+publish\b|\bmaturin\s+(?:publish|upload)\b|\b(?:poetry|flit|hatch|pdm)\s+publish\b/,
		action: /^pypa\/gh-action-pypi-publish@/,
	},
	{
		destination: 'oci',
		command:
			/\bdocker\s+(?:image\s+)?push\b|\bdocker\s+buildx\s+(?:build|bake)\b[^\n]*--push\b|\bdocker\s+buildx\s+imagetools\s+create\b|\b(?:skopeo|crane)\s+copy\b|\bcrane\s+push\b|\bpodman\s+push\b|\boras\s+manifest\s+push\b/,
		action: /^(?:docker\/build-push-action|redhat-actions\/push-to-registry)@/,
	},
	{ destination: 'oci-artifact', command: /\boras\s+(?:push|attach|blob\s+push)\b/ },
	{ destination: 'go-proxy', command: /\/@v\/[^\s"']+\.(?:info|mod|zip)\b|\/@latest\b/ },
	{
		destination: 'aur',
		command: /aur@aur\.archlinux\.org|\baur\.archlinux\.org\/[\w.-]+\.git/,
		action: /^KSXGitHub\/github-actions-deploy-aur@/,
	},
	{
		destination: 'homebrew',
		command: /homebrew-[\w.-]+|\bbrew\s+bump/,
		action:
			/^(?:Homebrew\/actions\/bump-packages|mislav\/bump-homebrew-formula-action|dawidd6\/action-homebrew-bump-formula)@/,
	},
	{ destination: 'scoop', command: /\bscoop-[\w.-]+|\bbucket\/[\w.-]+\.json\b/ },
	{
		destination: 'winget',
		command: /\bwingetcreate\b|\bkomac\b|winget-pkgs/,
		action: /^(?:vedantmgoyal(?:2009|9)\/winget-releaser|michidk\/winget-updater)@/,
	},
	{ destination: 'vscode-marketplace', command: /\bvsce\s+publish\b/, action: /^HaaLeo\/publish-vscode-extension@/ },
	{ destination: 'open-vsx', command: /\bovsx\s+publish\b/ },
	{ destination: 'zed-extensions', command: /zed-industries\/extensions/ },
	{
		destination: 'docs',
		command: /\bwrangler\s+(?:pages\s+)?deploy\b|\bgh-pages\b|\bmkdocs\s+gh-deploy\b/,
		action: /^(?:actions\/deploy-pages|cloudflare\/wrangler-action|peaceiris\/actions-gh-pages)@/,
	},
];
const releaseActions =
	/^(?:softprops\/action-gh-release|ncipollo\/release-action|taiki-e\/create-gh-release-action|taiki-e\/upload-rust-binary-action|svenstaro\/upload-release-action|goreleaser\/goreleaser-action|googleapis\/release-please-action)@/;
const releaseCommand = /\bgh\s+release\s+(create|upload|edit)\b|\bgoreleaser\s+release\b/g;
const goreleaserBuildOnly = /--snapshot\b|--skip[= ][\w,]*\bpublish\b|--skip-publish\b/;
const aliasCommand =
	/\bgit\s+tag\s+(?:-[a-z]*f[a-z]*\s|--force\b)|\bgit\s+push\b[^\n]*(?:--force|\+refs\/tags\/)|\bnpm\s+dist-tag\s+add\b|\bdocker\s+buildx\s+imagetools\s+create\b[^\n]*:latest\b/;

const dryRun =
	/--dry-run(?![\w-]|=(?:false|0)\b)|\bnpm_config_dry_run=["']?(?:true|1)\b|\bcargo\s+(?:\+\S+\s+)?publish\b[^\n;&|]*\s-[a-z]*n[a-z]*\b/i;
const rehearsalRegistry =
	/--registry[= ]["']?https?:\/\/(?!registry\.npmjs\.org\b|registry\.yarnpkg\.com\b)|--repository(?:-url)?[= ]["']?(?:testpypi\b|https?:\/\/test\.pypi\.org)|\bcargo\s+(?:\+\S+\s+)?publish\b[^\n;&|]*\s--(?:registry[= ]["']?(?!crates-io\b)[\w.-]|index\b)/;
function rehearsing(command: string): boolean {
	const literal = command.replace(/\$\{\{[^}]*\}\}/g, '');
	return dryRun.test(literal) || rehearsalRegistry.test(literal);
}
function lines(text: string): string[] {
	return text.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(line =>
		line && !line.startsWith('#')
	);
}
function otherRepository(text: string): string | undefined {
	return /--repo(?:=|\s+)["']?([\w.-]+\/[\w.-]+)/.exec(text)?.[1];
}

function walkDirectories(text: string, directory: string, visit: (command: string, here: string) => void): void {
	let current = within('', directory);
	for (const line of lines(text)) {
		let here = current;
		let depth = 0;
		for (const part of line.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
			let command = part.replace(/^(?:if|then|elif|else|do|fi|done)\b\s*/, '').trim();
			const opens = command.startsWith('(');
			if (opens) command = command.slice(1).trim();
			const closes = /\)\s*$/.test(command);
			if (closes) command = command.replace(/\)\s*$/, '').trim();
			if (opens) depth++;
			const change = /^cd\s+["']?([^\s"';&|)]+)["']?$/.exec(command);
			if (change) {
				here = within(here, change[1] ?? '');
				if (depth === 0) current = here;
			} else if (command && !rehearsing(command)) {
				visit(command, here);
			}
			if (closes && depth > 0) {
				depth--;
				if (depth === 0) here = current;
			}
		}
	}
}
const packCommand = /\b(?:npm|pnpm|yarn|bun(?:\s+pm)?)\s+pack\b|\bcargo\s+(?:\+\S+\s+)?package\b/;
export function packDirectories(run: string): string[] {
	const found: string[] = [];
	walkDirectories(run, '', (line, here) => {
		if (here && packCommand.test(line)) found.push(here);
	});
	return found;
}

const logging = /^(?:echo|printf)\b/;
function executed(command: string): string[] {
	if (!logging.test(command)) return [command];
	return [...command.replace(/'[^']*'/g, "''").matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map(match =>
		(match[1] ?? match[2] ?? '').trim()
	).filter(Boolean);
}
function commandEffects(text: string, source: string, directory = ''): StepEffect[] {
	const effects: StepEffect[] = [];
	walkDirectories(text.replace(/["']\s*,\s*(?:\{\s*args:\s*)?\[?\s*["']/g, ' '), directory, (command, here) => {
		for (const line of executed(command)) {
			for (const pattern of patterns) {
				if (pattern.command?.test(line)) {
					const repository = otherRepository(line);
					effects.push({
						kind: 'publish',
						destination: pattern.destination,
						source,
						text: line,
						...(repository ? { repository } : {}),
						...(here ? { directory: here } : {}),
					});
				}
			}
			for (const release of line.matchAll(releaseCommand)) {
				if (release[0].startsWith('goreleaser') && goreleaserBuildOnly.test(line)) continue;
				const repository = otherRepository(line);
				effects.push({
					kind: 'release',
					action: release[1] === 'upload' ? 'upload' : release[1] === 'edit' ? 'publish' : 'create',
					source,
					text: line,
					...(repository ? { repository } : {}),
				});
			}
			if (/\bsemantic-release\b(?![\w/-])/.test(line)) {
				effects.push({ kind: 'release', action: 'publish', source, text: line });
			}
			if (aliasCommand.test(line)) effects.push({ kind: 'alias', source, text: line });
			const dispatched = /\bgh\s+workflow\s+run\s+["']?([\w.-]+\.ya?ml)/.exec(line)
				?? /\bcreateWorkflowDispatch\b[^\n]*workflow_id:\s*["']([\w.-]+\.ya?ml)/.exec(line);
			if (dispatched?.[1]) effects.push({ kind: 'dispatch', workflow: dispatched[1], source, text: line });
			if (/\bgit\s+push\b[^\n]*(?:--tags|refs\/tags\/|--atomic|\$\{?\{?\s*\w*tag)/i.test(line)) {
				effects.push({ kind: 'tag', source, text: line });
			}
			if (/\bpkg-pr-new\s+publish\b/.test(line)) effects.push({ kind: 'preview', source, text: line });
		}
	});
	const assembled = /\bbuildx\s+(?:build|bake)\b/.exec(text);
	if (
		assembled && /--push\b|type=registry/.test(text)
		&& !effects.some(effect => effect.kind === 'publish' && effect.destination === 'oci')
	) effects.push({ kind: 'publish', destination: 'oci', source, text: assembled[0] });
	return effects;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function withCalledFunctions(source: string, body: string, seen = new Set<string>()): string {
	const parts = [body];
	for (const match of source.matchAll(/^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{/gm)) {
		const name = match[1];
		if (!name || seen.has(name)) continue;
		if (!new RegExp(`(?:^\\s*|\\$\\(\\s*|[;&|]\\s*)${name}(?![\\w-])`, 'm').test(body)) continue;
		seen.add(name);
		const rest = source.slice(match.index + match[0].length);
		const end = rest.search(/^\}/m);
		parts.push(withCalledFunctions(source, end < 0 ? rest : rest.slice(0, end), seen));
	}
	return parts.join('\n');
}
function segment(source: string, argument: string | undefined, whole = true): string {
	if (!argument) return source;
	const escaped = escapeRegExp(argument);
	const branch = new RegExp(`^\\s*(?:[\\w-]+\\|)*["']?${escaped}["']?(?:\\|[\\w-]+)*\\)\\s*$`, 'm').exec(source);
	if (branch) {
		const rest = source.slice(branch.index + branch[0].length);
		const end = rest.search(/^\s*;;/m);
		return withCalledFunctions(source, end < 0 ? rest : rest.slice(0, end));
	}
	const name = escaped.replaceAll('-', '_');
	const fn = new RegExp(`^\\s*(?:function\\s+)?(?:cmd_|do_)?${name}\\s*\\(\\)\\s*\\{`, 'm').exec(source);
	if (fn) {
		const rest = source.slice(fn.index + fn[0].length);
		const end = rest.search(/^\}/m);
		return withCalledFunctions(source, end < 0 ? rest : rest.slice(0, end));
	}
	const def = new RegExp(`^(\\s*)(?:async\\s+)?def\\s+(?:cmd_|do_|_)?${name}\\s*\\(`, 'm').exec(source);
	if (def) {
		const rest = source.slice(def.index + def[0].length);
		const body = rest.slice(rest.indexOf('\n') + 1);
		const end = body.search(new RegExp(`^${def[1] ?? ''}(?:async\\s+)?def\\s|^\\S`, 'm'));
		return end < 0 ? body : body.slice(0, end);
	}
	return whole ? source : '';
}
const moduleCall = /\bpython3?\s+-m\s+([A-Za-z_][\w.]*)(?:\s+([a-z][\w-]*))?/g;
function modulePath(snapshot: Snapshot, module: string, directory = ''): string | undefined {
	const relative = module.replaceAll('.', '/');
	const local = directory ? `${directory}/${relative}` : relative;
	const beside = [`${local}.py`, `${local}/__main__.py`].find(path => snapshot.files[path] !== undefined);
	if (beside) return beside;
	return Object.keys(snapshot.files).find(path =>
		path.endsWith(`/${relative}.py`) || path === `${relative}.py` || path.endsWith(`/${relative}/__main__.py`)
		|| path === `${relative}/__main__.py`
	);
}
function isolatedLines(recipe: string): string {
	return recipe.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line =>
		line.startsWith('#') ? line : `(${line})`
	).join('\n');
}
type Task = { body: string; source: string };
const taskKinds = ['package', 'deno', 'just', 'make', 'mise'] as const;
type TaskKind = (typeof taskKinds)[number];
type TaskTable = { tasks: Map<TaskKind, Map<string, Task>>; present: Set<TaskKind> };
const taskTables = new WeakMap<Snapshot, Map<string, TaskTable>>();
const cargoAliases = new WeakMap<Snapshot, Map<string, Task>>();
function taskTable(snapshot: Snapshot, directory: string): TaskTable {
	const cached = taskTables.get(snapshot) ?? new Map<string, TaskTable>();
	taskTables.set(snapshot, cached);
	const known = cached.get(directory);
	if (known) return known;
	const at = (name: string) => directory ? `${directory}/${name}` : name;
	const tasks = new Map<TaskKind, Map<string, Task>>(taskKinds.map(kind => [kind, new Map()]));
	const present = new Set<TaskKind>();
	const add = (kind: TaskKind, name: string, task: Task) => {
		const table = tasks.get(kind);
		if (table && !table.has(name)) table.set(name, task);
	};
	for (const name of ['package.json', 'deno.json', 'deno.jsonc']) {
		const path = at(name);
		const source = snapshot.files[path];
		if (source === undefined) continue;
		const kind: TaskKind = name === 'package.json' ? 'package' : 'deno';
		present.add(kind);
		const errors: ParseError[] = [];
		const manifest = object(parseJsonc(source, errors, { allowTrailingComma: true }));
		if (errors.length) continue;
		for (const [task, body] of Object.entries({ ...object(manifest.scripts), ...object(manifest.tasks) })) {
			const command = typeof body === 'string' ? body : object(body).command;
			if (typeof command === 'string') add(kind, task, { body: command, source: path });
		}
	}
	for (const name of ['justfile', 'Justfile', '.justfile', 'Makefile', 'GNUmakefile']) {
		const path = at(name);
		const source = snapshot.files[path];
		if (source === undefined) continue;
		const kind: TaskKind = /akefile$/.test(name) ? 'make' : 'just';
		present.add(kind);
		for (const match of source.matchAll(/^([A-Za-z][\w:-]*)(?:[^\n:=]*)?:(?!=)([^\n]*)\n((?:[ \t]+[^\n]*\n?)*)/gm)) {
			const prerequisites = (match[2] ?? '')
				.replace(/\(([^)]*)\)/g, (_, inner: string) => inner.trim().split(/\s+/)[0] ?? '')
				.split(/\s+/).filter(word => /^[A-Za-z][\w:-]*$/.test(word));
			const stripped = kind === 'make' ? (match[3] ?? '').replace(/^([ \t]+)[@+-]+/gm, '$1') : match[3] ?? '';
			const separate = !(kind === 'make' ? /^\.ONESHELL\s*:/m.test(source) : /^[ \t]*#!/.test(stripped));
			const recipe = separate ? isolatedLines(stripped) : stripped;
			const body = [recipe, ...prerequisites.map(prerequisite => `${kind} ${prerequisite}`)].join('\n');
			if (match[1]) add(kind, match[1], { body, source: path });
		}
	}
	for (const name of ['mise.toml', '.mise.toml', '.config/mise.toml', 'mise.local.toml']) {
		const path = at(name);
		const source = snapshot.files[path];
		if (source === undefined) continue;
		present.add('mise');
		let config: Record<string, unknown>;
		try {
			config = object(parseToml(source));
		} catch {
			continue;
		}
		for (const [task, definition] of Object.entries(object(config.tasks))) {
			const run = typeof definition === 'string' ? definition : object(definition).run;
			const depends = ['depends', 'depends_post'].flatMap(key => {
				const value = object(definition)[key];
				return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];
			});
			const body = [
				Array.isArray(run) ? run.map(String).join('\n') : typeof run === 'string' ? run : '',
				...depends.map(dependency => `mise run ${dependency}`),
			].filter(Boolean).join('\n');
			if (body) add('mise', task, { body, source: path });
		}
	}
	const prefix = directory ? `${directory}/` : '';
	for (const [path, source] of Object.entries(snapshot.files)) {
		if (!path.startsWith(prefix)) continue;
		const task = /^(?:\.mise\/tasks|mise-tasks|\.config\/mise\/tasks)\/([^/.]+)(?:\.\w+)?$/.exec(
			path.slice(prefix.length),
		)
			?.[1];
		if (task) {
			present.add('mise');
			add('mise', task, { body: source, source: path });
		}
	}
	const table = { tasks, present };
	cached.set(directory, table);
	return table;
}
function aliasTable(snapshot: Snapshot): Map<string, Task> {
	const known = cargoAliases.get(snapshot);
	if (known) return known;
	const aliases = new Map<string, Task>();
	for (const path of ['.cargo/config.toml', '.cargo/config']) {
		const source = snapshot.files[path];
		if (!source) continue;
		let config: Record<string, unknown>;
		try {
			config = object(parseToml(source));
		} catch {
			continue;
		}
		for (const [name, alias] of Object.entries(object(config.alias))) {
			const body = Array.isArray(alias) ? alias.map(String).join(' ') : typeof alias === 'string' ? alias : '';
			if (body && !aliases.has(name)) aliases.set(name, { body: `cargo ${body}`, source: path });
		}
	}
	cargoAliases.set(snapshot, aliases);
	return aliases;
}
const invocations: readonly { pattern: RegExp; kinds: readonly TaskKind[]; many: boolean }[] = [
	{ pattern: /\b(?:npm|pnpm|yarn|bun)\b[^\n;&|]*?\srun(?:-script)?\s+/g, kinds: ['package'], many: false },
	{
		pattern:
			/\b(?:yarn|pnpm)\s+(?!(?:run|run-script|install|install-test|i|it|add|remove|rm|uninstall|un|init|dlx|exec|npm|publish|pack|version|config|c|workspaces?|why|info|set|up|update|upgrade|cache|audit|bin|create|dedupe|deploy|doctor|env|fetch|import|link|ln|list|ls|outdated|patch|prune|rebuild|rb|root|setup|store|unlink|licenses|approve-builds|self-update|help|ignored-builds)\b)/g,
		kinds: ['package'],
		many: false,
	},
	{ pattern: /\bdeno\s+task\s+/g, kinds: ['deno'], many: false },
	{ pattern: /\bjust\s+/g, kinds: ['just'], many: true },
	{ pattern: /(?:\bmake|\$\(MAKE\)|\$\{MAKE\})\s+/g, kinds: ['make'], many: true },
	{ pattern: /\bmise\s+run\s+/g, kinds: ['mise'], many: false },
	{ pattern: /\brunner\s+(?:install|i)\s+/g, kinds: taskKinds, many: true },
	{ pattern: /(?:^|[\s;&|(])(?:runner\s+run|runner(?!\s+(?:install|i)\b)|run)\s+/g, kinds: taskKinds, many: false },
];
function ancestors(directory: string): string[] {
	const parts = directory ? directory.split('/') : [];
	return parts.map((_, index) => parts.slice(0, parts.length - index).join('/')).concat('');
}
const packageDirectories = new WeakMap<Snapshot, Map<string, string>>();
function workspaceDirectories(snapshot: Snapshot): Map<string, string> {
	const known = packageDirectories.get(snapshot);
	if (known) return known;
	const found = new Map<string, string>();
	for (const [path, source] of Object.entries(snapshot.files)) {
		if (!/(?:^|\/)package\.json$/.test(path) || path.includes('node_modules/')) continue;
		const errors: ParseError[] = [];
		const manifest = object(parseJsonc(source, errors, { allowTrailingComma: true }));
		if (errors.length || typeof manifest.name !== 'string') continue;
		found.set(manifest.name, path.replace(/\/?package\.json$/, ''));
	}
	packageDirectories.set(snapshot, found);
	return found;
}
export function declaredWorkspaces(snapshot: Snapshot): string[] {
	const patterns: string[] = [];
	const source = snapshot.files['package.json'];
	if (source !== undefined) {
		const errors: ParseError[] = [];
		const declared = object(parseJsonc(source, errors, { allowTrailingComma: true })).workspaces;
		const list = Array.isArray(declared) ? declared : object(declared).packages;
		if (!errors.length && Array.isArray(list)) {
			patterns.push(...list.filter((entry): entry is string => typeof entry === 'string'));
		}
	}
	const pnpm = snapshot.files['pnpm-workspace.yaml'];
	const parsed = pnpm === undefined ? undefined : yaml(pnpm);
	const packages = parsed && Result.isSuccess(parsed) ? parsed.success.packages : undefined;
	if (Array.isArray(packages)) patterns.push(...packages.filter((entry): entry is string => typeof entry === 'string'));
	return patterns;
}
export function inWorkspaces(patterns: readonly string[], directory: string): boolean {
	const matches = (pattern: string) =>
		new RegExp(
			`^${
				escapeRegExp(pattern.replace(/^\.\//, '').replace(/\/$/, '')).replaceAll('\\*\\*', '.*').replaceAll(
					'\\*',
					'[^/]*',
				)
			}$`,
		).test(directory);
	return patterns.some(pattern => !pattern.startsWith('!') && matches(pattern))
		&& !patterns.some(pattern => pattern.startsWith('!') && matches(pattern.slice(1)));
}
const valueFlag = /(?:^|\s)(?:--prefix|--cwd|--dir|-C|-w|--workspace|--filter|-F)[= ]["']?([^\s"';&|]+)/;
function taskBodies(
	snapshot: Snapshot,
	line: string,
	directory = '',
): { name: string; body: string; source: string }[] {
	const cargo = /\bcargo\s+([a-z][\w-]*)/.exec(line)?.[1];
	const alias = cargo ? aliasTable(snapshot).get(cargo) : undefined;
	if (cargo && alias) return [{ name: cargo, ...alias }];
	const found: { name: string; body: string; source: string }[] = [];
	for (const { pattern, kinds, many } of invocations) {
		for (const match of line.matchAll(pattern)) {
			const rest = line.slice((match.index ?? 0) + match[0].length).split(/\s--(?:\s|$)|[;&|]/)[0] ?? '';
			const invocation = `${match[0]} ${rest}`;
			const forwarded = /\s--\s+(.+)$/.exec(line.slice((match.index ?? 0) + match[0].length).split(/[;&|]/)[0] ?? '')
				?.[1]?.trim();
			const words = rest.replace(new RegExp(valueFlag.source, 'g'), ' ').split(/\s+/).filter(word =>
				word && !word.startsWith('-') && !word.includes('=')
			);
			const change = /(?:^|\s)(?:--prefix|--cwd|--dir|-C)[= ]["']?([^\s"';&|]+)/.exec(invocation)?.[1];
			const selectors = [
				...invocation.matchAll(/(?:^|\s)(?:-w|--workspace|--filter|-F)[= ]["']?([^\s"';&|]+)/g),
				...invocation.matchAll(/\byarn\s+workspace\s+["']?([^\s"';&|]+)/g),
			].flatMap(match => match[1] ?? []);
			const workspaces = workspaceDirectories(snapshot);
			const declared = declaredWorkspaces(snapshot);
			const every = /(?:^|\s)(?:-r|--recursive|--workspaces|-ws)(?=\s|$)/.test(invocation) || selectors.includes('*');
			const includeRoot = /(?:^|\s)(?:--include-workspace-root|-iwr)(?:=true)?(?=\s|$)/.test(invocation);
			const bases = every
				? [
					...new Set(
						[
							...(includeRoot ? [directory] : []),
							...[...workspaces.values()].filter(dir =>
								dir !== directory && dir.startsWith(directory)
								&& (!declared.length || inWorkspaces(declared, dir))
							),
						],
					),
				]
				: selectors.length
				? [
					...new Set(
						selectors.map(selector =>
							workspaces.get(selector)
								?? (selector.includes('/') || selector.startsWith('.') ? within(directory, selector) : directory)
						),
					),
				]
				: [change ? within(directory, change) : directory];
			for (const name of many ? words : words.slice(0, 1)) {
				for (const kind of kinds) {
					for (const base of bases) {
						const dirs = kind === 'make' ? [base] : ancestors(base);
						const owner = dirs.find(dir => taskTable(snapshot, dir).present.has(kind));
						const task = owner === undefined ? undefined : taskTable(snapshot, owner).tasks.get(kind)?.get(name);
						if (task) {
							const hooks = kind === 'package' && owner !== undefined && /^npm\b/.test(match[0])
									&& !/--ignore-scripts\b/.test(line)
								? taskTable(snapshot, owner).tasks.get('package')
								: undefined;
							const pre = hooks?.get(`pre${name}`), post = hooks?.get(`post${name}`);
							found.push(
								...(pre ? [{ name: `pre${name}`, ...pre }] : []),
								{ name, ...task, body: forwarded && kind === 'package' ? `${task.body} ${forwarded}` : task.body },
								...(post ? [{ name: `post${name}`, ...post }] : []),
							);
						}
					}
				}
			}
		}
	}
	return found;
}
const scriptCall =
	/(?:(?:^|[\s;&|(])(?:bash|sh|source|\.|node(?:\s+(?:--?(?:import|require|loader)\s+\S+|--?(?!(?:import|require|loader)\b)[\w-]+(?:=\S+)?))*|bun(?:\s+run)?|deno\s+run(?:\s+(?:-\S+|[\w./][\w./-]*\.jsonc?))*|python3?|uv\s+run|pwsh(?:\s+-File)?|(?:(?:npx|bunx|pnpm(?:\s+exec|\s+dlx)?|yarn(?:\s+dlx)?)\s+(?:-y\s+)?)?(?:tsx|ts-node|esno|jiti|vite-node|babel-node))\s+["']?(?:\.\/)?|(?:^|[\s;&|(])["']?\.\/|^\s*)((?:[\w.-]+\/)*[\w.-]+\.(?:sh|bash|ps1|py|[cm]?[jt]s|rb))\b["']?(?:\s+([a-z][\w-]*))?/gm;

export function within(directory: string, change: string): string {
	if (change.startsWith('/') || change.includes('$')) return directory;
	const parts = directory ? directory.split('/') : [];
	for (const part of change.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return parts.join('/');
}
const traversalLimit = 512;
const publishHooks = ['prepublishOnly', 'prepack', 'prepare', 'postpack', 'publish', 'postpublish'];
function scriptEffects(
	snapshot: Snapshot,
	run: string,
	seen: Set<string>,
	directory?: string,
): { effects: StepEffect[]; runs: string[] } {
	const effects: StepEffect[] = [], runs: string[] = [];
	walkDirectories(run, directory ?? '', (raw, here) => {
		for (const line of executed(raw)) {
			for (const match of line.matchAll(scriptCall)) {
				const called = (match[1] ?? '').replace(/^\.\//, '');
				const relative = here ? within(here, called) : undefined;
				const path = relative !== undefined && snapshot.files[relative] !== undefined ? relative : called;
				const source = snapshot.files[path];
				const key = `${path} ${match[2] ?? ''} ${here}`;
				if (
					!source || seen.size >= traversalLimit || seen.has(key)
					|| /(?:^|\/)(?:tests?|__tests__|fixtures)\/|\.test\./.test(path)
				) continue;
				seen.add(key);
				const text = segment(source, match[2]);
				effects.push(...commandEffects(text, path, here));
				if (/^(?:promote|aliases?|float|latest)$/.test(match[2] ?? '')) {
					effects.push({ kind: 'alias', source: path, text: match[0].trim() });
				}
				runs.push(text);
				const nested = scriptEffects(snapshot, text, seen, here);
				effects.push(...nested.effects);
				runs.push(...nested.runs);
			}
			for (const match of line.matchAll(moduleCall)) {
				const path = modulePath(snapshot, match[1] ?? '', here);
				const key = `${path ?? ''} ${match[2] ?? ''} ${here}`;
				const source = path ? snapshot.files[path] : undefined;
				if (!path || !source || seen.size >= traversalLimit || seen.has(key)) continue;
				seen.add(key);
				const choice = match[2] ? new RegExp(`["']${match[2]}["']`).test(source) : false;
				const text = match[2] ? segment(source, match[2], !choice) : source;
				effects.push(...commandEffects(text, path, here));
				runs.push(text);
				const nested = scriptEffects(snapshot, text, seen, here);
				effects.push(...nested.effects);
				runs.push(...nested.runs);
			}
			const hooks = /\bnpm\b[^\n;&|]*\spublish(?![\w:-])/.test(line) && !/--ignore-scripts\b/.test(line)
				? publishHooks.flatMap(hook => taskBodies(snapshot, line.replace(/\bpublish\b/, `run ${hook}`), here))
				: [];
			for (const task of [...taskBodies(snapshot, line, here), ...hooks]) {
				const key = `${task.source}#${task.name}#${task.body}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const owner = task.source.replace(
					/\/?(?:package\.json|deno\.jsonc?|[Jj]ustfile|\.justfile|(?:GNU)?[Mm]akefile|\.?mise(?:\.local)?\.toml|\.config\/mise\.toml|(?:\.mise\/tasks|mise-tasks|\.config\/mise\/tasks)\/[^/]+)$/,
					'',
				);
				effects.push(...commandEffects(task.body, task.source, owner));
				runs.push(task.body);
				const nested = scriptEffects(snapshot, task.body, seen, owner || undefined);
				effects.push(...nested.effects);
				runs.push(...nested.runs);
			}
		}
	});
	return { effects, runs };
}

function localAction(uses: string): string | undefined {
	return /^(?:\.\/|\$\/)(.+?)\/?$/.exec(uses)?.[1];
}

function actionFiles(snapshot: Snapshot, path: string): [string, string][] {
	const prefix = `${path}/`;
	return Object.entries(snapshot.files).filter(([file]) => file.startsWith(prefix));
}

function actionEffects(
	snapshot: Snapshot,
	path: string,
	seen: Set<string>,
	supplied: Readonly<Record<string, unknown>> = {},
): { effects: StepEffect[]; runs: string[] } {
	const manifest = [`${path}/action.yml`, `${path}/action.yaml`].flatMap(file => snapshot.files[file] ?? [])[0];
	const parsedManifest = manifest === undefined ? undefined : yaml(manifest);
	const declared = parsedManifest && Result.isSuccess(parsedManifest) ? parsedManifest.success.inputs : undefined;
	const bindings = { ...inputDefaults(declared, Object.keys(supplied)), ...literalBindings(supplied) };
	const visit = `${path} ${JSON.stringify(bindings)}`;
	if (seen.has(visit)) return { effects: [], runs: [] };
	seen.add(visit);
	const effects: StepEffect[] = [], runs: string[] = [];
	const files = actionFiles(snapshot, path);
	for (const file of [`${path}/action.yml`, `${path}/action.yaml`]) {
		const text = snapshot.files[file];
		if (text !== undefined) {
			const parsed = yaml(text);
			const definition = object(Result.isSuccess(parsed) ? parsed.success.runs : undefined);
			const steps = Array.isArray(definition.steps)
				? definition.steps.filter(step => !disabled(object(step).if))
				: definition.steps;
			const declared = `${text}\n${snapshot.files[`${path}/Dockerfile`] ?? ''}`;
			const stepRuns = (Array.isArray(steps) ? steps : []).flatMap(step => {
				const bound = bindStep(object(step), bindings);
				const run = bound['working-directory'] === undefined ? bound.run : undefined;
				return typeof run === 'string' ? [run.replace(/\$\{?GITHUB_ACTION_PATH\}?\//g, `${path}/`)] : [];
			});
			const called = new Set(stepRuns.flatMap(run => [...run.matchAll(scriptCall)].flatMap(match => match[1] ?? [])));
			for (const [entry] of files) {
				const relative = entry.slice(path.length + 1);
				if (/\/(?:action\.ya?ml|Dockerfile)$/.test(entry) || called.has(entry)) continue;
				const referenced = Array.isArray(steps)
					? stepRuns.some(run => run.includes(relative))
					: ['main', 'pre', 'post'].some(key => definition[key] === relative) || declared.includes(relative);
				if (!referenced) continue;
				const result = scriptEffects(snapshot, `bash ${entry}`, seen);
				effects.push(...result.effects);
				runs.push(...result.runs);
			}
			for (const entry of Array.isArray(steps) ? steps : []) {
				const step = bindStep(object(entry), bindings);
				const nested = typeof step.uses === 'string' ? stepEffects(snapshot, step, file, seen) : undefined;
				if (nested) {
					effects.push(...nested.effects);
					runs.push(...nested.runs);
				}
				if (typeof step.run === 'string') {
					const directory = typeof step['working-directory'] === 'string'
						? step['working-directory'].replace(/\$\{\{\s*github\.action_path\s*\}\}|\$\{?GITHUB_ACTION_PATH\}?/g, path)
						: undefined;
					const run = directory ? `cd ${directory}\n${step.run}` : step.run;
					effects.push(...commandEffects(run, file));
					runs.push(run);
					const called = scriptEffects(
						snapshot,
						step.run.replace(/\$\{?GITHUB_ACTION_PATH\}?\//g, `${path}/`),
						seen,
						directory,
					);
					effects.push(...called.effects);
					runs.push(...called.runs);
				}
			}
		}
	}
	return { effects, runs };
}

function stepEffects(
	snapshot: Snapshot,
	step: Record<string, unknown>,
	source: string,
	seen: Set<string>,
): { effects: StepEffect[]; runs: string[]; action?: string } {
	const uses = typeof step.uses === 'string' ? step.uses : undefined;
	const label = typeof step.name === 'string' ? step.name : '';
	const alias: StepEffect[] = /\b(?:promote|move|update|floating)\b.*\b(?:alias(?:es)?|tags?|latest)\b/i.test(label)
		? [{ kind: 'alias', source, text: label }]
		: [];
	if (
		/\b(?:deploy|trigger|publish|rebuild|build)\b.*\b(?:site|docs|documentation|pages|cloudflare)\b/i.test(label)
		&& typeof step.run === 'string' && /\b(?:curl|wrangler|gh\s+api)\b/.test(step.run)
	) alias.push({ kind: 'publish', destination: 'docs', source, text: label });
	if (/\b(?:bump|create|push)\b.*\btags?\b/i.test(label)) alias.push({ kind: 'tag', source, text: label });
	const inputs = object(step.with);
	if (uses) {
		const given = Object.values(inputs).filter(value => typeof value === 'string').join('\n');
		const own = new RegExp(`^${escapeRegExp(snapshot.repository.name)}/([^@]+?)/?@`, 'i').exec(uses)?.[1];
		const local = localAction(uses) ?? own;
		if (local && !local.startsWith('.github/workflows/')) {
			const found = actionEffects(snapshot, local, seen, inputs);
			return { effects: [...alias, ...found.effects], runs: found.runs, action: local };
		}
		const delegated = /^changesets\/action@/.test(uses) && typeof inputs.publish === 'string'
			? inputs.publish
			: undefined;
		const traversed = delegated ? scriptEffects(snapshot, delegated, seen) : undefined;
		let effects: StepEffect[] = [
			...alias,
			...(typeof inputs.script === 'string' ? commandEffects(inputs.script, source) : []),
			...(delegated ? commandEffects(delegated, source) : []),
			...(traversed?.effects ?? []),
		];
		const dispatch = /^(?:benc-uk|the-actions-org)\/workflow-dispatch@/.test(uses) ? inputs.workflow : undefined;
		if (typeof dispatch === 'string') effects.push({ kind: 'dispatch', workflow: dispatch, source, text: uses });
		const rehearsal = inputs['dry-run'] === true || inputs['dry-run'] === 'true' || inputs.dry_run === true
			|| inputs.dry_run === 'true'
			|| (typeof inputs['repository-url'] === 'string' && URL.canParse(inputs['repository-url'])
				&& new URL(inputs['repository-url']).hostname === 'test.pypi.org');
		for (const pattern of patterns) {
			if (pattern.action?.test(uses) && !rehearsal) {
				const repository = typeof inputs.repository === 'string' ? inputs.repository : undefined;
				effects.push({
					kind: 'publish',
					destination: pattern.destination,
					source,
					text: uses,
					...(repository ? { repository } : {}),
				});
			}
		}
		const pushes = inputs.push === true || (typeof inputs.push === 'string' && inputs.push !== 'false');
		if (/^docker\/build-push-action@/.test(uses) && !pushes) {
			effects = effects.filter(effect => !(effect.kind === 'publish' && effect.text === uses));
		}
		if (
			releaseActions.test(uses)
			&& !(uses.startsWith('goreleaser/') && goreleaserBuildOnly.test(String(inputs.args ?? '')))
		) {
			const repository = typeof inputs.repository === 'string' ? inputs.repository : undefined;
			effects.push({
				kind: 'release',
				action: inputs.draft === true || inputs.draft === 'true' ? 'create' : 'publish',
				source,
				text: uses,
				...(repository ? { repository } : {}),
			});
		}
		const artifact = /^actions\/(upload|download)-artifact@/.exec(uses);
		if (artifact) {
			effects.push({
				kind: 'artifact',
				direction: artifact[1] === 'upload' ? 'upload' : 'download',
				name: typeof inputs.name === 'string' ? inputs.name : '',
				source,
			});
		}
		return { effects, runs: [...(given ? [given] : []), ...(traversed?.runs ?? [])] };
	}
	if (typeof step.run === 'string') {
		const directory = typeof step['working-directory'] === 'string' ? step['working-directory'] : undefined;
		const run = directory ? `cd ${directory}\n${step.run}` : step.run;
		const called = scriptEffects(snapshot, step.run, seen, directory);
		return {
			effects: [...alias, ...commandEffects(run, source), ...called.effects],
			runs: [run, ...called.runs],
		};
	}
	return { effects: alias, runs: [] };
}

function matrixScalar(value: unknown): string | undefined {
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
		? String(value)
		: undefined;
}
export function matrixCombinations(matrix: Record<string, unknown>): Record<string, string>[] {
	const keys = Object.keys(matrix).filter(key => key !== 'include' && key !== 'exclude' && Array.isArray(matrix[key]));
	let combinations: Record<string, string>[] = keys.length ? [{}] : [];
	for (const key of keys) {
		const values = (Array.isArray(matrix[key]) ? matrix[key] : []).flatMap(value => matrixScalar(value) ?? []);
		if (combinations.length * values.length > 256) break;
		combinations = combinations.flatMap(combination => values.map(value => ({ ...combination, [key]: value })));
	}
	const row = (entry: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(entry).flatMap(([key, value]) => {
				const scalar = matrixScalar(value);
				return scalar === undefined ? [] : [[key, scalar] as const];
			}),
		);
	const exclusions = (Array.isArray(matrix.exclude) ? matrix.exclude : []).map(entry => row(object(entry))).filter(
		entry => Object.keys(entry).length > 0,
	);
	combinations = combinations.filter(combination =>
		!exclusions.some(entry => Object.entries(entry).every(([key, value]) => combination[key] === value))
	);
	const original = new Set(keys);
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
const matrixExpression = /\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g;
export function substitute(text: string, assignment: Record<string, string>): string {
	return text.replace(matrixExpression, (expression, key: string) => assignment[key] ?? expression);
}
function expandStep(step: Record<string, unknown>, matrix: Record<string, unknown>): Record<string, unknown>[] {
	const directory = step['working-directory'];
	const texts = [step.run, directory, ...Object.values(object(step.with))].filter((value): value is string =>
		typeof value === 'string'
	);
	const combinations = matrixCombinations(matrix);
	const keys = [
		...new Set(texts.flatMap(text => [...text.matchAll(matrixExpression)].flatMap(match => match[1] ?? []))),
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
	].slice(0, 64);
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
function disabled(condition: unknown): boolean {
	return condition === false
		|| (typeof condition === 'string' && /^\s*(?:\$\{\{\s*false\s*\}\}|false)\s*$/.test(condition));
}

function triggerList(value: unknown, key: string): string[] {
	const list = object(value)[key];
	return Array.isArray(list) ? list.map(String) : typeof list === 'string' ? [list] : [];
}

const inputExpression = /\$\{\{\s*(?:github\.event\.)?inputs\.([\w-]+)\s*\}\}/g;
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
function bindStep(step: Record<string, unknown>, bindings: Readonly<Record<string, string>>): Record<string, unknown> {
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

function buildJob(
	snapshot: Snapshot,
	path: string,
	document: Record<string, unknown>,
	id: string,
	job: Record<string, unknown>,
	bindings: Readonly<Record<string, string>> = {},
): Job {
	const effects: StepEffect[] = [], runs: string[] = [], actions: string[] = [];
	const steps = Array.isArray(job.steps) ? job.steps : [];
	const declared = object(object(job.defaults).run)['working-directory']
		?? object(object(document.defaults).run)['working-directory'];
	const directory = typeof declared === 'string' ? bindInputs(declared, bindings) : declared;
	const matrix = object(object(job.strategy).matrix);
	for (const entry of steps) {
		const raw = bindStep(object(entry), bindings);
		if (disabled(raw.if)) continue;
		const located = typeof directory === 'string' && raw['working-directory'] === undefined
			? { ...raw, 'working-directory': directory }
			: raw;
		for (const step of expandStep(located, matrix)) {
			const result = stepEffects(snapshot, step, path, new Set());
			effects.push(...result.effects);
			runs.push(...result.runs);
			if (result.action) actions.push(result.action);
		}
	}
	const own = typeof job.uses === 'string'
		? new RegExp(`^${escapeRegExp(snapshot.repository.name)}/(.+?)@(.+)$`, 'i').exec(
			job.uses,
		)
		: null;
	const calls = typeof job.uses === 'string' ? own?.[1] ?? localAction(job.uses) : undefined;
	const values = Object.values(object(job.with)).filter(value => typeof value === 'string');
	if (values.length) runs.push(values.join('\n'));
	const environment = typeof job.environment === 'string' ? job.environment : object(job.environment).name;
	const environmentUrl = object(job.environment).url;
	if (typeof environmentUrl === 'string') runs.push(environmentUrl);
	return {
		id,
		needs: Array.isArray(job.needs) ? job.needs.map(String) : typeof job.needs === 'string' ? [job.needs] : [],
		...(calls?.startsWith('.github/workflows/') ? { calls: calls.slice('.github/workflows/'.length) } : {}),
		...(own?.[2] ? { callRef: own[2] } : {}),
		...(typeof environment === 'string' ? { environment } : {}),
		...(Object.keys(matrix).length ? { matrix: JSON.stringify(matrix) } : {}),
		...(typeof job.if === 'string' ? { condition: job.if } : {}),
		effects,
		runs,
		actions,
	};
}

export function workflowModels(snapshot: Snapshot): Workflow[] {
	const workflows: Workflow[] = [];
	const documents = new Map<string, { path: string; document: Record<string, unknown> }>();
	const liveJobs = (document: Record<string, unknown>) =>
		Object.entries(object(document.jobs)).filter(([, value]) => !disabled(object(value).if));
	for (const [path, source] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
		if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) continue;
		const parsed = yaml(source);
		if (Result.isFailure(parsed)) continue;
		const document = parsed.success, trigger = document.on;
		const events = typeof trigger === 'string'
			? [trigger]
			: Array.isArray(trigger)
			? trigger.map(String)
			: Object.keys(object(trigger));
		const on = object(trigger);
		const file = path.slice('.github/workflows/'.length);
		documents.set(file, { path, document });
		const jobs: Job[] = liveJobs(document).map(([id, value]) => buildJob(snapshot, path, document, id, object(value)));
		const generator = Object.keys(snapshot.files).find(candidate =>
			/^\.github\/workflows\/[^/]+\.[cm]?[jt]s$/.test(candidate)
			&& (snapshot.files[candidate] ?? '').includes(file)
		);
		workflows.push({
			file,
			name: typeof document.name === 'string' ? document.name : file,
			events,
			tagPatterns: triggerList(on.push, 'tags'),
			branchPatterns: triggerList(on.push, 'branches'),
			pathPatterns: triggerList(on.push, 'paths'),
			releaseTypes: triggerList(on.release, 'types'),
			workflowRuns: triggerList(on.workflow_run, 'workflows'),
			dispatchInputs: Object.keys(object(object(on.workflow_dispatch).inputs)),
			dispatchText: JSON.stringify(object(object(on.workflow_dispatch).inputs)),
			callInputs: Object.keys(object(object(on.workflow_call).inputs)),
			...(generator ? { generator } : {}),
			jobs,
		});
	}
	const edges = new Map<string, { caller: string; bound?: Map<string, Job> }[]>();
	const called = new Set(workflows.flatMap(workflow => workflow.jobs.flatMap(job => job.calls ?? [])));
	const walk = (root: string, file: string, bindings: Readonly<Record<string, string>>, trail: readonly string[]) => {
		const workflow = workflows.find(candidate => candidate.file === file);
		const caller = documents.get(file);
		if (!workflow || !caller) return;
		for (const [id, value] of liveJobs(caller.document)) {
			const job = workflow.jobs.find(candidate => candidate.id === id);
			if (!job?.calls || trail.includes(job.calls)) continue;
			const callee = documents.get(job.calls);
			if (!callee) continue;
			const assignments = matrixCombinations(object(object(object(value).strategy).matrix)).slice(0, 64);
			for (const assignment of assignments.length ? assignments : [{}]) {
				const supplied = Object.fromEntries(
					Object.entries(object(object(value).with)).map((
						[key, input],
					) => [key, typeof input === 'string' ? substitute(bindInputs(input, bindings), assignment) : input]),
				);
				const inherited = {
					...inputDefaults(object(object(callee.document.on).workflow_call).inputs, Object.keys(supplied)),
					...literalBindings(supplied),
				};
				const usable = Object.keys(inherited).length > 0
					&& new RegExp(inputExpression.source).test(JSON.stringify(callee.document.jobs));
				const bound = usable
					? new Map(
						liveJobs(callee.document).map(([calleeId, calleeJob]) =>
							[
								calleeId,
								buildJob(snapshot, callee.path, callee.document, calleeId, object(calleeJob), inherited),
							] as const
						),
					)
					: undefined;
				edges.set(job.calls, [...edges.get(job.calls) ?? [], { caller: root, ...(bound ? { bound } : {}) }]);
				walk(root, job.calls, inherited, [...trail, job.calls]);
			}
		}
	};
	for (const workflow of workflows) {
		if (!called.has(workflow.file) || workflow.events.some(event => event !== 'workflow_call')) {
			walk(workflow.file, workflow.file, {}, [workflow.file]);
		}
	}
	const unique = <T>(values: T[]) => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
	for (const workflow of workflows) {
		const incoming = edges.get(workflow.file);
		if (!incoming?.some(edge => edge.bound)) continue;
		const direct = workflow.events.some(event => event !== 'workflow_call');
		for (const job of workflow.jobs) {
			const callers = incoming.map(edge => ({
				caller: edge.caller,
				effects: edge.bound?.get(job.id)?.effects ?? job.effects,
				runs: edge.bound?.get(job.id)?.runs ?? job.runs,
			}));
			const bound = incoming.flatMap(edge => edge.bound?.get(job.id) ?? []);
			job.own = direct ? job.effects : [];
			job.ownRuns = direct ? job.runs : [];
			job.callers = callers;
			job.effects = unique([...job.own, ...callers.flatMap(entry => entry.effects)]);
			job.runs = unique([...direct ? job.runs : [], ...bound.flatMap(variant => variant.runs)]);
			job.actions = unique([...direct ? job.actions : [], ...bound.flatMap(variant => variant.actions)]);
		}
	}
	return workflows;
}

export function literalPrefix(pattern: string): string {
	return (/^[A-Za-z0-9._/-]*/.exec(pattern)?.[0] ?? '').replace(/(?<![\d.])\d[\d.]*$/, '');
}
