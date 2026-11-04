import type { Channel } from '@/automation/destinations';
import { githubHref } from '@/contract/links';

export function htmlEscape(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
	);
}

export function link(href: string, text: string): string {
	return `<a href="${htmlEscape(href)}">${htmlEscape(text)}</a>`;
}

export function channelHref(channel: Channel): string {
	if (channel.destination === 'aur') return `https://aur.archlinux.org/packages/${encodeURIComponent(channel.name)}`;
	const file = `${channel.name}.${channel.destination === 'scoop' ? 'json' : 'rb'}`;
	return githubHref(channel.repository, 'blob', 'HEAD', channel.directory, file);
}
