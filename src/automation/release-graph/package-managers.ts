const directoryFlags = '--prefix|--cwd|--dir|-C';
const selectorFlags = '-w|--workspace|--filter|-F';
const argument = `[= ]["']?`;
const word = `([^\\s"';&|]+)`;

export const directoryFlagPattern = directoryFlags;
export const selectorFlagPattern = selectorFlags;

const directoryFlag = new RegExp(`(?:^|\\s)(?:${directoryFlags})${argument}${word}`);
const valueFlag = new RegExp(`(?:^|\\s)(?:${directoryFlags}|${selectorFlags})${argument}${word}`, 'g');
const selectorFlag = new RegExp(`(?:^|\\s)(?:${selectorFlags})${argument}${word}`, 'g');
const yarnWorkspace = /\byarn\s+workspace\s+["']?([^\s"';&|]+)/g;
const recursive = /(?:^|\s)(?:-r|--recursive)(?=\s|$)/;
const everyWorkspace = /(?:^|\s)(?:--workspaces|-ws)(?=\s|$)/;
const workspaceRoot = /(?:^|\s)(?:--include-workspace-root|-iwr)(?:=true)?(?=\s|$)/;
const forwarded = /\s--\s+(.+)$/;
const folder =
	/\b(?:publish|pack)\s+(?:-\S+\s+)*["']?(\.{1,2}(?=[\s"';&|]|$|\/)[^\s"';&|]*|[\w@][^\s"';&|$]*\/[^\s"';&|]*)/;

export const crossesDirectories =
	/\bcd\s|--prefix\b|--cwd\b|--dir\b|--config\b|--workspaces?\b|--recursive\b|--filter\b|\byarn\s+workspace\s|(?:^|\s)-(?:C|w|ws|r|F)(?=\s|$)/m;

const builtins = [
	'run',
	'run-script',
	'install',
	'install-test',
	'i',
	'it',
	'add',
	'remove',
	'rm',
	'uninstall',
	'un',
	'init',
	'dlx',
	'exec',
	'npm',
	'publish',
	'pack',
	'version',
	'config',
	'c',
	'workspaces',
	'workspace',
	'why',
	'info',
	'set',
	'up',
	'update',
	'upgrade',
	'cache',
	'audit',
	'bin',
	'create',
	'dedupe',
	'deploy',
	'doctor',
	'env',
	'fetch',
	'import',
	'link',
	'ln',
	'list',
	'ls',
	'outdated',
	'patch',
	'prune',
	'rebuild',
	'rb',
	'root',
	'setup',
	'store',
	'unlink',
	'licenses',
	'approve-builds',
	'self-update',
	'help',
	'ignored-builds',
];
export const scriptShorthand = new RegExp(`\\b(?:yarn|pnpm)\\s+(?!(?:${builtins.join('|')})\\b)`, 'g');

export function directoryOverride(command: string): string | undefined {
	return directoryFlag.exec(command)?.[1];
}

export function withoutValueFlags(text: string): string {
	return text.replace(valueFlag, ' ');
}

export function workspaceSelectors(command: string): string[] {
	return [...command.matchAll(selectorFlag), ...command.matchAll(yarnWorkspace)].flatMap(match => match[1] ?? []);
}

export function workspaceScope(command: string): { all: boolean; recursive: boolean; root: boolean } {
	return { all: everyWorkspace.test(command), recursive: recursive.test(command), root: workspaceRoot.test(command) };
}

export function forwardedArguments(command: string): string | undefined {
	return forwarded.exec(command)?.[1]?.trim();
}

export function publishesTarball(command: string): boolean {
	const found = folder.exec(command)?.[1];
	return found !== undefined && /\.(?:tgz|tar\.gz)$/.test(found);
}

export function publishFolder(command: string): string | undefined {
	const found = folder.exec(command)?.[1];
	return found === undefined || /\.(?:tgz|tar\.gz)$/.test(found) ? undefined : found;
}
