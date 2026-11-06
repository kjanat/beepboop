import { Result } from 'effect';
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
	| { kind: 'publish'; destination: Destination; source: string; text: string; repository?: string }
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
			/\b(?:npm|pnpm|yarn)(?:@[\w.]+)?\s+(?:[^\n|;&]*\s)?(?<!\brun(?:-script)?\s+)publish(?![\w:-])|\bargs=\(publish\b/,
		action: /^JS-DevTools\/npm-publish@/,
	},
	{
		destination: 'jsr',
		command: /\b(?:jsr|deno)\s+publish\b|\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+(?:-y\s+)?jsr\s+publish\b/,
	},
	{
		destination: 'crates-io',
		command: /\bcargo\s+(?:\+\S+\s+)?publish\b|\bcargo-release\b|\bcargo\s+release\b/,
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
	/^(?:softprops\/action-gh-release|ncipollo\/release-action|taiki-e\/create-gh-release-action|taiki-e\/upload-rust-binary-action|svenstaro\/upload-release-action|goreleaser\/goreleaser-action)@/;
const releaseCommand = /\bgh\s+release\s+(create|upload|edit)\b|\bgoreleaser\s+release\b/;
const goreleaserBuildOnly = /--snapshot\b|--skip[= ][\w,]*\bpublish\b/;
const aliasCommand =
	/\bgit\s+tag\s+(?:-[a-z]*f[a-z]*\s|--force\b)|\bgit\s+push\b[^\n]*(?:--force|\+refs\/tags\/)|\bnpm\s+dist-tag\s+add\b|\bdocker\s+buildx\s+imagetools\s+create\b[^\n]*:latest\b/;

function lines(text: string): string[] {
	return text.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(line =>
		line && !line.startsWith('#') && !/--dry-run(?:\b|=true)/.test(line)
		&& !/--registry[= ]["']?https?:\/\/(?:localhost|127\.0\.0\.1)\b/.test(line)
	);
}
function otherRepository(text: string): string | undefined {
	return /--repo(?:=|\s+)["']?([\w.-]+\/[\w.-]+)/.exec(text)?.[1];
}

function commandEffects(text: string, source: string): StepEffect[] {
	const effects: StepEffect[] = [];
	for (const line of lines(text.replace(/["']\s*,\s*["']/g, ' '))) {
		for (const pattern of patterns) {
			if (pattern.command?.test(line)) {
				const repository = otherRepository(line);
				effects.push({
					kind: 'publish',
					destination: pattern.destination,
					source,
					text: line,
					...(repository ? { repository } : {}),
				});
			}
		}
		const release = releaseCommand.exec(line);
		if (release && !(release[0].startsWith('goreleaser') && goreleaserBuildOnly.test(line))) {
			const repository = otherRepository(line);
			effects.push({
				kind: 'release',
				action: release[1] === 'upload' ? 'upload' : release[1] === 'edit' ? 'publish' : 'create',
				source,
				text: line,
				...(repository ? { repository } : {}),
			});
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
function modulePath(snapshot: Snapshot, module: string): string | undefined {
	const relative = module.replaceAll('.', '/');
	return Object.keys(snapshot.files).find(path =>
		path.endsWith(`/${relative}.py`) || path === `${relative}.py` || path.endsWith(`/${relative}/__main__.py`)
	);
}
const taskRunner =
	/\b(?:(?:npm|pnpm|yarn|bun)\s+run|deno\s+task|runner(?:\s+(?:run|install|i))?|run|just|make|mise\s+run|cargo)\b/;
type Task = { body: string; source: string };
const taskTables = new WeakMap<Snapshot, { tasks: Map<string, Task>; aliases: Map<string, Task> }>();
function taskTable(snapshot: Snapshot): { tasks: Map<string, Task>; aliases: Map<string, Task> } {
	const known = taskTables.get(snapshot);
	if (known) return known;
	const tasks = new Map<string, Task>();
	for (const path of ['package.json', 'deno.json', 'deno.jsonc']) {
		const source = snapshot.files[path];
		if (!source) continue;
		let manifest: Record<string, unknown>;
		try {
			manifest = object(JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')));
		} catch {
			continue;
		}
		for (const [name, body] of Object.entries({ ...object(manifest.scripts), ...object(manifest.tasks) })) {
			const command = typeof body === 'string' ? body : object(body).command;
			if (typeof command === 'string' && !tasks.has(name)) tasks.set(name, { body: command, source: path });
		}
	}
	for (const path of ['justfile', 'Justfile', '.justfile', 'Makefile', 'GNUmakefile']) {
		const source = snapshot.files[path];
		if (!source) continue;
		for (const match of source.matchAll(/^([A-Za-z][\w:-]*)(?:[^\n:=]*)?:(?!=)[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/gm)) {
			if (match[1] && !tasks.has(match[1])) tasks.set(match[1], { body: match[2] ?? '', source: path });
		}
	}
	for (const path of ['mise.toml', '.mise.toml', '.config/mise.toml', 'mise.local.toml']) {
		const source = snapshot.files[path];
		if (!source) continue;
		let config: Record<string, unknown>;
		try {
			config = object(parseToml(source));
		} catch {
			continue;
		}
		for (const [name, task] of Object.entries(object(config.tasks))) {
			const run = typeof task === 'string' ? task : object(task).run;
			const body = Array.isArray(run) ? run.map(String).join('\n') : typeof run === 'string' ? run : '';
			if (body && !tasks.has(name)) tasks.set(name, { body, source: path });
		}
	}
	for (const [path, source] of Object.entries(snapshot.files)) {
		const task = /^(?:\.mise\/tasks|mise-tasks|\.config\/mise\/tasks)\/([^/.]+)(?:\.\w+)?$/.exec(path)?.[1];
		if (task && !tasks.has(task)) tasks.set(task, { body: source, source: path });
	}
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
	const table = { tasks, aliases };
	taskTables.set(snapshot, table);
	return table;
}
function taskBodies(snapshot: Snapshot, line: string): { name: string; body: string; source: string }[] {
	if (!taskRunner.test(line)) return [];
	const { tasks, aliases } = taskTable(snapshot);
	const cargo = /\bcargo\s+([a-z][\w-]*)/.exec(line)?.[1];
	const alias = cargo ? aliases.get(cargo) : undefined;
	if (cargo && alias) return [{ name: cargo, ...alias }];
	return line.split(/\s+/).flatMap(word => {
		const task = tasks.get(word);
		return task ? [{ name: word, ...task }] : [];
	});
}
const scriptCall =
	/(?:(?:^|[\s;&|(])(?:bash|sh|node|bun(?:\s+run)?|deno\s+run(?:\s+-\S+)*|python3?|uv\s+run|pwsh(?:\s+-File)?)\s+["']?(?:\.\/)?|(?:^|[\s;&|(])["']?\.\/|^\s*)((?:[\w.-]+\/)*[\w.-]+\.(?:sh|bash|ps1|py|[cm]?[jt]s|rb))\b["']?(?:\s+([a-z][\w-]*))?/gm;

function scriptEffects(
	snapshot: Snapshot,
	run: string,
	seen: Set<string>,
	directory?: string,
): { effects: StepEffect[]; runs: string[] } {
	const effects: StepEffect[] = [], runs: string[] = [];
	const base = directory?.replace(/^\.\//, '').replace(/\/+$/, '');
	for (const match of run.matchAll(scriptCall)) {
		const called = (match[1] ?? '').replace(/^\.\//, '');
		const relative = base && base !== '.' ? `${base}/${called}` : undefined;
		const path = relative !== undefined && snapshot.files[relative] !== undefined ? relative : called;
		const source = snapshot.files[path];
		const key = `${path} ${match[2] ?? ''}`;
		if (!source || seen.has(key) || /(?:^|\/)(?:tests?|__tests__|fixtures)\/|\.test\./.test(path)) continue;
		seen.add(key);
		const text = segment(source, match[2]);
		effects.push(...commandEffects(text, path));
		if (/^(?:promote|aliases?|float|latest)$/.test(match[2] ?? '')) {
			effects.push({ kind: 'alias', source: path, text: match[0].trim() });
		}
		runs.push(text);
		const nested = scriptEffects(snapshot, text, seen);
		effects.push(...nested.effects);
		runs.push(...nested.runs);
	}
	for (const match of run.matchAll(moduleCall)) {
		const path = modulePath(snapshot, match[1] ?? '');
		const key = `${path ?? ''} ${match[2] ?? ''}`;
		const source = path ? snapshot.files[path] : undefined;
		if (!path || !source || seen.has(key)) continue;
		seen.add(key);
		const choice = match[2] ? new RegExp(`["']${match[2]}["']`).test(source) : false;
		const text = match[2] ? segment(source, match[2], !choice) : source;
		effects.push(...commandEffects(text, path));
		runs.push(text);
	}
	for (const line of lines(run)) {
		for (const task of taskBodies(snapshot, line)) {
			const key = `${task.source}#${task.name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			effects.push(...commandEffects(task.body, task.source));
			runs.push(task.body);
			const nested = scriptEffects(snapshot, task.body, seen);
			effects.push(...nested.effects);
			runs.push(...nested.runs);
		}
	}
	return { effects, runs };
}

function localAction(uses: string): string | undefined {
	return /^(?:\.\/|\$\/)(.+?)\/?$/.exec(uses)?.[1];
}

function actionFiles(snapshot: Snapshot, path: string): [string, string][] {
	const prefix = `${path}/`;
	return Object.entries(snapshot.files).filter(([file]) => file.startsWith(prefix));
}

function actionEffects(snapshot: Snapshot, path: string, seen: Set<string>): { effects: StepEffect[]; runs: string[] } {
	if (seen.has(path)) return { effects: [], runs: [] };
	seen.add(path);
	const effects: StepEffect[] = [], runs: string[] = [];
	const files = actionFiles(snapshot, path);
	for (const [file, text] of files) {
		if (/\/action\.ya?ml$/.test(file)) {
			const parsed = yaml(text);
			const definition = object(Result.isSuccess(parsed) ? parsed.success.runs : undefined);
			const steps = definition.steps;
			const declared = [text, ...files.filter(([other]) => /\/Dockerfile$/.test(other)).map(([, source]) => source)]
				.join(
					'\n',
				);
			const stepRuns = (Array.isArray(steps) ? steps : []).flatMap(step => {
				const run = object(step).run;
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
				const step = object(entry);
				const nested = typeof step.uses === 'string' ? stepEffects(snapshot, step, file, seen) : undefined;
				if (nested) {
					effects.push(...nested.effects);
					runs.push(...nested.runs);
				}
				if (typeof step.run === 'string') {
					effects.push(...commandEffects(step.run, file));
					runs.push(step.run);
					const called = scriptEffects(
						snapshot,
						step.run.replace(/\$\{?GITHUB_ACTION_PATH\}?\//g, `${path}/`),
						seen,
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
		const local = localAction(uses);
		if (local && !local.startsWith('.github/workflows/')) {
			const found = actionEffects(snapshot, local, seen);
			return { effects: [...alias, ...found.effects], runs: found.runs, action: local };
		}
		const effects: StepEffect[] = [
			...alias,
			...(typeof inputs.script === 'string' ? commandEffects(inputs.script, source) : []),
		];
		const dispatch = /^(?:benc-uk|the-actions-org)\/workflow-dispatch@/.test(uses) ? inputs.workflow : undefined;
		if (typeof dispatch === 'string') effects.push({ kind: 'dispatch', workflow: dispatch, source, text: uses });
		for (const pattern of patterns) {
			if (pattern.action?.test(uses)) {
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
			effects.splice(
				0,
				effects.length,
				...effects.filter(effect => !(effect.kind === 'publish' && effect.text === uses)),
			);
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
		return { effects, runs: given ? [given] : [] };
	}
	if (typeof step.run === 'string') {
		const directory = typeof step['working-directory'] === 'string' ? step['working-directory'] : undefined;
		const run = directory ? `cd ${directory}\n${step.run}` : step.run;
		const called = scriptEffects(snapshot, run, seen, directory);
		return {
			effects: [...alias, ...commandEffects(run, source), ...called.effects],
			runs: [run, ...called.runs],
		};
	}
	return { effects: alias, runs: [] };
}

function triggerList(value: unknown, key: string): string[] {
	const list = object(value)[key];
	return Array.isArray(list) ? list.map(String) : typeof list === 'string' ? [list] : [];
}

export function workflowModels(snapshot: Snapshot): Workflow[] {
	const workflows: Workflow[] = [];
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
		const jobs: Job[] = Object.entries(object(document.jobs)).map(([id, value]) => {
			const job = object(value);
			const effects: StepEffect[] = [], runs: string[] = [], actions: string[] = [];
			const steps = Array.isArray(job.steps) ? job.steps : [];
			const directory = object(object(job.defaults).run)['working-directory']
				?? object(object(document.defaults).run)['working-directory'];
			for (const entry of steps) {
				const step = object(entry);
				const result = stepEffects(
					snapshot,
					typeof directory === 'string' && step['working-directory'] === undefined
						? { ...step, 'working-directory': directory }
						: step,
					path,
					new Set(),
				);
				effects.push(...result.effects);
				runs.push(...result.runs);
				if (result.action) actions.push(result.action);
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
			const matrix = object(object(job.strategy).matrix);
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
		});
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
	return workflows;
}

export function literalPrefix(pattern: string): string {
	return (/^[A-Za-z0-9._/-]*/.exec(pattern)?.[0] ?? '').replace(/(?<![\d.])\d[\d.]*$/, '');
}
