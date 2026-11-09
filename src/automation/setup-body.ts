const start = '<!-- beepboop:setup:start -->';
const end = '<!-- beepboop:setup:end -->';
const statusStart = '<!-- beepboop:setup-status -->';
const statusEnd = '<!-- /beepboop:setup-status -->';

function block(body: string): { from: number; to: number } | undefined {
	const from = body.indexOf(start);
	const to = from < 0 ? -1 : body.indexOf(end, from);
	return to < 0 ? undefined : { from, to: to + end.length };
}
function statusSection(status: string): string {
	return `${statusStart}\n${status}\n${statusEnd}`;
}
export function marked(body: string): boolean {
	return block(body) !== undefined;
}
export function setupBlock(proposal: string, status?: string): string {
	return `${start}\n${proposal.trimEnd()}${status === undefined ? '' : `\n\n${statusSection(status)}`}\n${end}`;
}
export function authored(current: string, previous: string): string {
	const remaining = new Map<string, number>();
	for (const line of previous.split('\n')) remaining.set(line, (remaining.get(line) ?? 0) + 1);
	return current.split('\n').filter(line => {
		const count = line.trim() ? remaining.get(line) ?? 0 : 0;
		if (count) remaining.set(line, count - 1);
		return !count;
	}).join('\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n').trim();
}
export function placeBlock(current: string, generated: string, previous: string): string {
	const range = block(current);
	if (range) return current.slice(0, range.from) + generated + current.slice(range.to);
	const kept = authored(current, previous);
	return kept ? `${generated}\n\n${kept}\n` : `${generated}\n`;
}
export function withStatus(current: string, status: string): string {
	const section = statusSection(status);
	const from = current.indexOf(statusStart), to = from < 0 ? -1 : current.indexOf(statusEnd, from);
	if (to >= 0) return current.slice(0, from) + section + current.slice(to + statusEnd.length);
	const range = block(current);
	if (!range) return `${current}\n\n${section}`;
	const close = range.to - end.length;
	return `${current.slice(0, close).trimEnd()}\n\n${section}\n${current.slice(close)}`;
}
