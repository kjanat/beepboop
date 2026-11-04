import { appendFileSync, readFileSync } from 'node:fs';
import { parseRetryAfter } from '../../src/domain/http-date.ts';
import { array, record, text } from '../../src/model.ts';
import { writeOutput } from '../../src/tooling/github-output.ts';

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

function publication(value: unknown): unknown {
	const entry = record(value);
	if (entry.outcome !== 'rate-limited') return value;
	const field = text(entry.retryAfter);
	const retryAfter = parseRetryAfter(field, Date.now())
		?? (/^\d{4}-\d{2}-\d{2}T/.test(field) ? Date.parse(field) : Number.NaN);
	if (Number.isNaN(retryAfter)) throw Error('A rate-limited publication needs a Retry-After value');
	return { ...entry, retryAfter: new Date(retryAfter).toISOString() };
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
