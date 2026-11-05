import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunIdentity, World } from '@root/test/support/world.ts';

const client = join(import.meta.dir, '../../actions/runtime/client.ts');
const tokenHost = 'pipelines.actions.githubusercontent.com';
let invocation = 0;

function outputs(file: string): Record<string, string> {
	const entries: Record<string, string> = {};
	const pattern = /^([A-Za-z_][\w-]*)<<(value_[0-9a-f-]+)\n([\s\S]*?)\n\2$/gm;
	for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
		if (match[1] !== undefined && match[3] !== undefined) entries[match[1]] = match[3];
	}
	return entries;
}

export interface ActionResult {
	outputs: Record<string, string>;
	environment: string;
	logs: string[];
}

export async function runAction(
	world: World,
	mode: string,
	run: RunIdentity,
	variables: Record<string, string>,
): Promise<ActionResult> {
	const directory = mkdtempSync(join(tmpdir(), 'beepboop-action-'));
	const output = join(directory, 'output'), environment = join(directory, 'env');
	writeFileSync(output, '');
	writeFileSync(environment, '');
	const token = await world.runToken(run);
	world.network.serve(tokenHost, request => {
		if (request.headers.get('authorization') !== 'Bearer request-token') {
			return Response.json({ message: 'Bad credentials' }, { status: 401 });
		}
		return Response.json({ value: token });
	});
	const saved = { env: { ...process.env }, argv: [...process.argv] };
	const logs: string[] = [];
	const log = console.log;
	Object.assign(process.env, {
		SERVICE_ORIGIN: world.env.APPLICATION_ORIGIN,
		ACTIONS_ID_TOKEN_REQUEST_URL: `https://${tokenHost}/token?api-version=2.0`,
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
		GITHUB_OUTPUT: output,
		GITHUB_ENV: environment,
		...variables,
	});
	process.argv[2] = mode;
	console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
	try {
		await import(`${client}?run=${++invocation}`);
		return { outputs: outputs(output), environment: readFileSync(environment, 'utf8'), logs };
	} finally {
		console.log = log;
		for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
		Object.assign(process.env, saved.env);
		process.argv.splice(0, process.argv.length, ...saved.argv);
		rmSync(directory, { recursive: true, force: true });
	}
}
