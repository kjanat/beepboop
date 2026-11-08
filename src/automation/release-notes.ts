const botAuthor = / by @[A-Za-z0-9-]+\[bot\](?= in https:\/\/)/g;
const botNewcomer = /^\* @[A-Za-z0-9-]+\[bot\] made their first contribution in /;

export function releaseNotes(generated: string): string {
	const lines = generated.split(/\r?\n/).filter(line => !botNewcomer.test(line)).map(line =>
		line.replace(botAuthor, '')
	);
	return lines.filter((line, index) =>
		line !== '## New Contributors'
		|| (lines.slice(index + 1).find(next => next.trim() !== '')?.startsWith('* ') ?? false)
	).join('\n').replace(/\n{3,}/g, '\n\n');
}
