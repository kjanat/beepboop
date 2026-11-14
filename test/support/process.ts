import { spyOn } from 'bun:test';

export async function withEnvironment<A>(
	variables: Record<string, string>,
	work: () => Promise<A>,
): Promise<A> {
	const saved = { env: { ...process.env }, argv: [...process.argv] };
	for (const key of Object.keys(process.env)) delete process.env[key];
	Object.assign(process.env, variables);
	try {
		return await work();
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
		Object.assign(process.env, saved.env);
		process.argv.splice(0, process.argv.length, ...saved.argv);
	}
}

export async function withConsoleLog<A>(log: (...values: unknown[]) => void, work: () => Promise<A>): Promise<A> {
	const saved = console.log;
	console.log = log;
	try {
		return await work();
	} finally {
		console.log = saved;
	}
}

export async function silenced<A>(work: () => Promise<A>): Promise<A> {
	const write = process.stdout.write, error = process.stderr.write;
	process.stdout.write = () => true;
	process.stderr.write = () => true;
	try {
		return await work();
	} finally {
		process.stdout.write = write;
		process.stderr.write = error;
	}
}

export function loggedErrors() {
	const spy = spyOn(console, 'error').mockImplementation(() => {});
	return {
		events(): unknown[] {
			const lines = spy.mock.calls.flatMap(([first]): unknown[] => {
				if (typeof first !== 'string' || !first.startsWith('{')) return [];
				const parsed: unknown = JSON.parse(first);
				return [parsed];
			});
			spy.mockRestore();
			return lines;
		},
	};
}
