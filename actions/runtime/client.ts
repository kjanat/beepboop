import { appendFileSync } from 'node:fs';
import { endpoints, exchange, type Mode, parseMode, requestBody } from '@root/actions/runtime/protocol.ts';
import { record, text } from '@/model.ts';
import { writeOutput } from '@/tooling/github-output.ts';

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw Error(`${name} is required`);
	return value;
}

function mask(value: string): void {
	console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
}

function writeResult(mode: Mode, data: Record<string, unknown>): void {
	if (mode === 'begin') {
		const id = text(data.id);
		writeOutput('execution-id', id);
		writeOutput('context', JSON.stringify(data));
		appendFileSync(required('GITHUB_ENV'), `BEEPBOOP_EXECUTION_ID=${id}\n`);
	} else if (mode === 'credentials') {
		for (const [alias, value] of Object.entries(data)) {
			if (typeof value !== 'string') throw Error('Invalid credential response');
			mask(value);
			writeOutput(alias, value);
		}
		writeOutput('values', JSON.stringify(data));
	} else if (mode === 'token') {
		if (typeof data.token !== 'string') throw Error('Invalid token response');
		if (process.env.TOKEN_IDENTITY === 'true') {
			const bot = record(data.bot);
			const login = bot.login, id = bot.id, email = bot.email;
			if (
				typeof login !== 'string' || !/^[a-z0-9-]+\[bot\]$/.test(login)
				|| typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0
				|| email !== `${id}+${login}@users.noreply.github.com`
			) throw Error('Invalid bot identity response');
			writeOutput('bot-login', login);
			writeOutput('bot-id', String(id));
			writeOutput('bot-email', email);
		}
		mask(data.token);
		writeOutput('token', data.token);
	} else writeOutput('result', JSON.stringify(data));
}

const mode = parseMode(process.argv[2]);
const origin = new URL(process.env.SERVICE_ORIGIN || 'https://beepboop.kjanat.dev');
if (
	origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username
	|| origin.password
) throw Error('Expected an HTTPS service origin');
const endpoint = new URL(required('ACTIONS_ID_TOKEN_REQUEST_URL'));
endpoint.searchParams.set('audience', origin.origin);
const identity = await fetch(endpoint, {
	headers: { Authorization: `Bearer ${required('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` },
	redirect: 'error',
	signal: AbortSignal.timeout(20000),
});
if (!identity.ok) throw Error('Could not obtain workflow identity');
const token = record(await identity.json()).value;
if (typeof token !== 'string') throw Error('Missing workflow identity');
mask(token);
const result = await exchange(
	mode,
	() =>
		fetch(new URL(endpoints[mode].path, origin), {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(requestBody(mode, process.env)),
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
		}),
	milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
);
writeResult(mode, result);
