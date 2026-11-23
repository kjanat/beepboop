import { Effect } from 'effect';

function launcher(url: string): string[] {
	return process.platform === 'darwin'
		? ['open', url]
		: process.platform === 'win32'
		? ['rundll32', 'url.dll,FileProtocolHandler', url]
		: ['xdg-open', url];
}

export function openBrowser(url: string): Effect.Effect<boolean> {
	return Effect.tryPromise({
		try: async () => (await Bun.spawn(launcher(url), { stdout: 'ignore', stderr: 'ignore' }).exited) === 0,
		catch: () => false,
	}).pipe(Effect.orElseSucceed(() => false));
}
