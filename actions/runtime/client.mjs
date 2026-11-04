import { appendFileSync, readFileSync } from 'node:fs';
const mode = process.argv[2];
const origin = new URL(process.env.SERVICE_ORIGIN || 'https://beepboop.kjanat.dev');
if (
	origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username
	|| origin.password
) throw Error('Expected an HTTPS service origin');
const endpoint = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
endpoint.searchParams.set('audience', origin.origin);
const identity = await fetch(endpoint, {
	headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
	redirect: 'error',
	signal: AbortSignal.timeout(20000),
});
if (!identity.ok) throw Error('Could not obtain workflow identity');
const { value: token } = await identity.json();
if (typeof token !== 'string') throw Error('Missing workflow identity');
const mask = value =>
	console.log(`::add-mask::${value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
mask(token);
const executionId = process.env.EXECUTION_ID || process.env.BEEPBOOP_EXECUTION_ID;
let body;
if (mode === 'begin') {
	body = {
		executionId,
		stream: process.env.STREAM,
		operation: process.env.OPERATION,
		version: process.env.RELEASE_VERSION || undefined,
	};
} else if (mode === 'prepared') body = JSON.parse(readFileSync(process.env.PREPARED_FILE, 'utf8'));
else if (mode === 'report') {
	body = {
		executionId,
		publications: JSON.parse(process.env.PUBLICATIONS || '[]').map(publication => {
			if (publication?.outcome !== 'rate-limited') return publication;
			const retryAfter = new Date(publication.retryAfter);
			if (Number.isNaN(retryAfter.getTime())) throw Error('A rate-limited publication needs a retryAfter time');
			return { ...publication, retryAfter: retryAfter.toISOString() };
		}),
		artifacts: JSON.parse(process.env.ARTIFACTS || '[]'),
	};
} else if (mode === 'credentials') body = { executionId, aliases: JSON.parse(process.env.ALIASES || '[]') };
else if (mode === 'refs-plan' || mode === 'refs-complete' || mode === 'release') body = { executionId };
else if (mode === 'token') {
	body = {
		permissions: JSON.parse(process.env.PERMISSIONS || '{}'),
		...(process.env.TOKEN_PURPOSE ? { purpose: process.env.TOKEN_PURPOSE } : {}),
		...(process.env.TOKEN_IDENTITY === 'true' ? { identity: true } : {}),
		...(executionId ? { executionId } : {}),
	};
} else throw Error('Unknown integration action');
const result = await fetch(new URL(`/api/workflow/${mode}`, origin), {
	method: 'POST',
	headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
	body: JSON.stringify(body),
	redirect: 'error',
	signal: AbortSignal.timeout(30000),
});
if (!result.ok) {
	const reason = await result.json().then(body => body?.error, () => undefined);
	throw Error(`Beepboop request failed: HTTP ${result.status}${typeof reason === 'string' ? `: ${reason}` : ''}`);
}
const data = await result.json();
function output(name, value) {
	if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) throw Error('Invalid output name');
	const marker = `value_${crypto.randomUUID()}`;
	appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${marker}\n${value}\n${marker}\n`);
}
if (mode === 'begin') {
	output('execution-id', data.id);
	output('context', JSON.stringify(data));
	appendFileSync(process.env.GITHUB_ENV, `BEEPBOOP_EXECUTION_ID=${data.id}\n`);
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
		const bot = data.bot;
		if (
			!bot || typeof bot.login !== 'string' || !/^[a-z0-9-]+\[bot\]$/.test(bot.login)
			|| !Number.isSafeInteger(bot.id) || bot.id <= 0
			|| bot.email !== `${bot.id}+${bot.login}@users.noreply.github.com`
		) throw Error('Invalid bot identity response');
		output('bot-login', bot.login);
		output('bot-id', String(bot.id));
		output('bot-email', bot.email);
	}
	mask(data.token);
	output('token', data.token);
} else output('result', JSON.stringify(data));
