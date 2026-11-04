import { appendFileSync, readFileSync } from 'node:fs';
import { array, record, text } from '../../src/model.ts';

type Mode =
	| 'begin'
	| 'prepared'
	| 'report'
	| 'credentials'
	| 'refs-plan'
	| 'refs-complete'
	| 'release'
	| 'token';
const modes: readonly Mode[] = [
	'begin',
	'prepared',
	'report',
	'credentials',
	'refs-plan',
	'refs-complete',
	'release',
	'token',
];

function parseMode(value: string | undefined): Mode {
	const mode = modes.find(candidate => candidate === value);
	if (!mode) throw Error('Unknown integration action');
	return mode;
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw Error(`${name} is required`);
	return value;
}

function mask(value: string): void {
	console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
}

function output(name: string, value: string): void {
	if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw Error('Invalid output name');
	const marker = `value_${crypto.randomUUID()}`;
	appendFileSync(required('GITHUB_OUTPUT'), `${name}<<${marker}\n${value}\n${marker}\n`);
}

function publication(value: unknown): unknown {
	const entry = record(value);
	if (entry.outcome !== 'rate-limited') return value;
	const retryAfter = new Date(text(entry.retryAfter));
	if (Number.isNaN(retryAfter.getTime())) throw Error('A rate-limited publication needs a retryAfter time');
	return { ...entry, retryAfter: retryAfter.toISOString() };
}

function requestBody(mode: Mode, executionId: string | undefined): unknown {
	switch (mode) {
		case 'begin':
			return {
				executionId,
				stream: process.env.STREAM,
				operation: process.env.OPERATION,
				version: process.env.RELEASE_VERSION || undefined,
			};
		case 'prepared':
			return JSON.parse(readFileSync(required('PREPARED_FILE'), 'utf8'));
		case 'report':
			return {
				executionId,
				publications: array(JSON.parse(process.env.PUBLICATIONS || '[]')).map(publication),
				artifacts: array(JSON.parse(process.env.ARTIFACTS || '[]')),
			};
		case 'credentials':
			return { executionId, aliases: array(JSON.parse(process.env.ALIASES || '[]')) };
		case 'refs-plan':
		case 'refs-complete':
		case 'release':
			return { executionId };
		case 'token':
			return {
				permissions: record(JSON.parse(process.env.PERMISSIONS || '{}')),
				...(process.env.TOKEN_PURPOSE ? { purpose: process.env.TOKEN_PURPOSE } : {}),
				...(process.env.TOKEN_IDENTITY === 'true' ? { identity: true } : {}),
				...(executionId ? { executionId } : {}),
			};
	}
}

function writeResult(mode: Mode, data: Record<string, unknown>): void {
	if (mode === 'begin') {
		const id = text(data.id);
		output('execution-id', id);
		output('context', JSON.stringify(data));
		appendFileSync(required('GITHUB_ENV'), `BEEPBOOP_EXECUTION_ID=${id}\n`);
	} else if (mode === 'credentials') {
		for (const [alias, value] of Object.entries(data)) {
			if (typeof value !== 'string') throw Error('Invalid credential response');
			mask(value);
			output(alias, value);
		}
		output('values', JSON.stringify(data));
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
			output('bot-login', login);
			output('bot-id', String(id));
			output('bot-email', email);
		}
		mask(data.token);
		output('token', data.token);
	} else output('result', JSON.stringify(data));
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
const result = await fetch(new URL(`/api/workflow/${mode}`, origin), {
	method: 'POST',
	headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
	body: JSON.stringify(requestBody(mode, process.env.EXECUTION_ID || process.env.BEEPBOOP_EXECUTION_ID)),
	redirect: 'error',
	signal: AbortSignal.timeout(30000),
});
if (!result.ok) {
	const reason = await result.json().then(
		(body: unknown) => typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined,
		() => undefined,
	);
	throw Error(`Beepboop request failed: HTTP ${result.status}${typeof reason === 'string' ? `: ${reason}` : ''}`);
}
writeResult(mode, record(await result.json()));
