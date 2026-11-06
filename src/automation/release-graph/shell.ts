const dryRun =
	/--dry-run(?![\w-]|=(?:false|0)\b)|\bnpm_config_dry_run=["']?(?:true|1)\b|\bcargo\s+(?:\+\S+\s+)?publish\b[^\n;&|]*\s-[a-z]*n[a-z]*\b/i;
const rehearsalRegistry =
	/--registry[= ]["']?https?:\/\/(?!registry\.npmjs\.org\b|registry\.yarnpkg\.com\b)|--repository(?:-url)?[= ]["']?(?:testpypi\b|https?:\/\/test\.pypi\.org)|\bcargo\s+(?:\+\S+\s+)?publish\b[^\n;&|]*\s--(?:registry[= ]["']?(?!crates-io\b)[\w.-]|index\b)/;
export function rehearsing(command: string): boolean {
	const literal = command.replace(/\$\{\{[^}]*\}\}/g, '');
	return dryRun.test(literal) || rehearsalRegistry.test(literal);
}
export function lines(text: string): string[] {
	return text.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(line =>
		line && !line.startsWith('#')
	);
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

export function walkDirectories(text: string, directory: string, visit: (command: string, here: string) => void): void {
	let here = within('', directory);
	const enclosing: string[] = [];
	for (const line of lines(text)) {
		for (const part of splitCommands(line)) {
			let command = part.replace(/^(?:if|then|elif|else|do|fi|done)\b\s*/, '').trim();
			const opens = command.startsWith('(');
			if (opens) command = command.slice(1).trim();
			const closes = /\)\s*$/.test(command);
			if (closes) command = command.replace(/\)\s*$/, '').trim();
			if (opens) enclosing.push(here);
			const change = /^cd\s+["']?([^\s"';&|)]+)["']?$/.exec(command);
			if (change) {
				here = within(here, change[1] ?? '');
			} else if (command && !rehearsing(command)) {
				visit(command, here);
			}
			if (closes && enclosing.length) here = enclosing.pop() ?? here;
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
	const parts = directory ? directory.split('/') : [];
	for (const part of change.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return parts.join('/');
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isolatedLines(recipe: string): string {
	return recipe.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line =>
		line.startsWith('#') ? line : `(${line})`
	).join('\n');
}
