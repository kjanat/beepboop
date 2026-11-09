import { walkRelative } from '@/relative-path';

const dryRun =
	/--dry-run(?![\w-]|=(?:false|0)\b)|\bnpm_config_dry_run=["']?(?:true|1)\b|\bcargo\s+(?:\+\S+\s+)?publish\b[^\n;&|]*\s-[a-z]*n[a-z]*\b/i;
const rehearsalRegistry =
	/--registry[= ]["']?https?:\/\/(?!registry\.npmjs\.org\b|registry\.yarnpkg\.com\b)|--repository(?:-url)?[= ]["']?(?:testpypi\b|https?:\/\/test\.pypi\.org)|\bcargo\s+(?:\+\S+\s+)?publish\b[^\n;&|]*\s--(?:registry[= ]["']?(?!crates-io\b)[\w.-]|index\b)/;
export function rehearsing(command: string): boolean {
	const literal = command.replace(/\$\{\{[^}]*\}\}/g, '');
	return dryRun.test(literal) || rehearsalRegistry.test(literal);
}
function withoutComment(line: string): string {
	let quote = '';
	for (let index = 0; index < line.length; index++) {
		const character = line[index] ?? '';
		if (quote) {
			if (character === '\\' && quote === '"') index++;
			else if (character === quote) quote = '';
		} else if (character === '\\') {
			index++;
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '#' && (index === 0 || /\s/.test(line[index - 1] ?? ''))) {
			return line.slice(0, index);
		}
	}
	return line;
}
const heredoc = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/;
export function posixShell(command: string): boolean {
	return /^(?:bash|sh|zsh|dash)\b/.test(command);
}
function logicalLines(text: string): string[] {
	return text.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
export function lines(text: string): string[] {
	const found: string[] = [];
	let delimiter: { word: string; run: boolean } | undefined;
	for (const raw of logicalLines(text)) {
		if (delimiter) {
			if (raw === delimiter.word) delimiter = undefined;
			else if (delimiter.run) {
				const body = withoutComment(raw).trim();
				if (body) found.push(body);
			}
			continue;
		}
		const line = withoutComment(raw).trim();
		if (!line) continue;
		found.push(line);
		const opened = heredoc.exec(line);
		if (opened && !line.includes('<<<')) {
			delimiter = { word: opened[2] ?? '', run: posixShell(line.replace(/^sudo\s+/, '')) };
		}
	}
	return found;
}
export function splitCommands(line: string): string[] {
	const parts: string[] = [];
	let quote = '';
	let start = 0;
	for (let index = 0; index < line.length; index++) {
		const character = line[index] ?? '';
		if (quote) {
			if (character === '\\' && quote === '"') index++;
			else if (character === quote) quote = '';
			continue;
		}
		if (character === '\\') {
			index++;
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === ';' || character === '|' || character === '&' && line[index + 1] === '&') {
			parts.push(line.slice(start, index).trim());
			if ((character === '|' || character === '&') && line[index + 1] === character) index++;
			start = index + 1;
		}
	}
	parts.push(line.slice(start).trim());
	return parts;
}

function parentheses(part: string): { open: number; close: number; leading: number } {
	let quote = '';
	let open = 0;
	let close = 0;
	for (let index = 0; index < part.length; index++) {
		const character = part[index] ?? '';
		if (quote) {
			if (character === '\\' && quote === '"') index++;
			else if (character === quote) quote = '';
		} else if (character === '\\') {
			index++;
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '(') {
			open++;
		} else if (character === ')') {
			close++;
		}
	}
	return { open, close, leading: /^\(+/.exec(part)?.[0].length ?? 0 };
}

export function walkDirectories(text: string, directory: string, visit: (command: string, here: string) => void): void {
	let here = within('', directory);
	const enclosing: string[] = [];
	for (const line of lines(text)) {
		for (const part of splitCommands(line)) {
			const trimmed = part.replace(/^(?:if|then|elif|else|do|fi|done)\b\s*/, '').trim();
			const { open, close, leading } = parentheses(trimmed);
			const closing = Math.max(0, close - (open - leading));
			let command = trimmed.slice(leading).trim();
			for (let index = 0; index < closing; index++) command = command.replace(/\)\s*$/, '').trim();
			for (let index = 0; index < leading; index++) enclosing.push(here);
			const change = /^cd\s+["']?([^\s"';&|)]+)["']?$/.exec(command);
			if (change) {
				here = within(here, change[1] ?? '');
			} else if (command && !rehearsing(command)) {
				visit(command, here);
			}
			for (let index = 0; index < closing && enclosing.length; index++) here = enclosing.pop() ?? here;
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
export function executed(command: string): string[] {
	if (!logging.test(command)) return [command];
	return [...command.replace(/'[^']*'/g, "''").matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map(match =>
		(match[1] ?? match[2] ?? '').trim()
	).filter(Boolean);
}

export function within(directory: string, change: string): string {
	if (change.startsWith('/') || change.includes('$')) return directory;
	return walkRelative(directory, change).path;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isolatedLines(recipe: string): string {
	return logicalLines(recipe).map(line => line.startsWith('#') ? line : `(${line})`).join('\n');
}

export function globMatches(pattern: string, name: string): boolean {
	const source = [...pattern].map(character =>
		character === '*'
			? '.*'
			: character === '?'
			? '.'
			: character === '[' || character === ']'
			? character
			: escapeRegExp(character)
	).join('');
	try {
		return new RegExp(`^${source}$`).test(name);
	} catch {
		return pattern === name;
	}
}
