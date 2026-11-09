export const stdin = {
	piped: (): Promise<string | null> => process.stdin.isTTY ? Promise.resolve(null) : Bun.stdin.text(),
};
