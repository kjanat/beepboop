import { expect, test } from 'bun:test';
import { completeLogin, type LoginCompletion } from '#automation/auth';

const flow = JSON.stringify({ state: 'state-1', verifier: 'verifier-1' });

function callback(query: string, cookie?: string): Request {
	return new Request(`https://beepboop.example/auth/callback?${query}`, {
		headers: cookie === undefined ? {} : { cookie: `__Host-beepboop_flow=${cookie}` },
	});
}

function steps(overrides: Partial<LoginCompletion> = {}): LoginCompletion & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		consumeFlow: async (id) => {
			calls.push(`consume ${id}`);
			return flow;
		},
		exchange: async (code, verifier) => {
			calls.push(`exchange ${code} ${verifier}`);
			return { access: 'access-token', expiresIn: 600 };
		},
		verify: async (access) => {
			calls.push(`verify ${access}`);
			return 'user:admin';
		},
		...overrides,
	};
}

test('a completed login sets the session and lands on the dashboard', async () => {
	const login = steps();
	const response = await completeLogin(callback('code=c1&state=state-1', 'flow-1'), login);
	expect(response.status).toBe(302);
	expect(response.headers.get('Location')).toBe('/');
	expect(response.headers.get('Set-Cookie')).toStartWith('__Host-beepboop_access=access-token;');
	expect(login.calls).toEqual(['consume flow-1', 'exchange c1 verifier-1', 'verify access-token']);
});

test('a used or expired login attempt starts a fresh login', async () => {
	const login = steps({ consumeFlow: async () => null });
	const response = await completeLogin(callback('code=c1&state=state-1', 'flow-1'), login);
	expect(response.status).toBe(302);
	expect(response.headers.get('Location')).toBe('/auth/login');
});

test('a callback for another attempt starts a fresh login without exchanging its code', async () => {
	const login = steps();
	const response = await completeLogin(callback('code=c1&state=someone-elses', 'flow-1'), login);
	expect(response.headers.get('Location')).toBe('/auth/login');
	expect(login.calls).toEqual(['consume flow-1']);
});

test('a callback without a login cookie explains itself instead of looping', async () => {
	const login = steps();
	const response = await completeLogin(callback('code=c1&state=state-1'), login);
	expect(response.status).toBe(401);
	expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
	const page = await response.text();
	expect(page).toContain('Cookies may be blocked');
	expect(page).toContain('<a href="/auth/login">Sign in again</a>');
	expect(login.calls).toEqual([]);
});

test('a refused login shows the reason on a page that offers to sign in again', async () => {
	const login = steps({
		verify: async () => {
			throw new Error('Administrator access denied <script>');
		},
	});
	const response = await completeLogin(callback('code=c1&state=state-1', 'flow-1'), login);
	expect(response.status).toBe(401);
	expect(response.headers.get('Set-Cookie')).toStartWith('__Host-beepboop_flow=;');
	const page = await response.text();
	expect(page).toContain('Administrator access denied &#60;script&#62;');
	expect(page).not.toContain('<script>');
	expect(page).toContain('Sign in again');
});

test('a failed code exchange shows the reason', async () => {
	const login = steps({
		exchange: async () => {
			throw new Error('Login exchange failed');
		},
	});
	const page = await (await completeLogin(callback('code=c1&state=state-1', 'flow-1'), login)).text();
	expect(page).toContain('Login exchange failed');
});

test('a non-Error failure still lands on the sign-in-again page', async () => {
	const login = steps({
		exchange: async () => {
			throw 'boom';
		},
	});
	const page = await (await completeLogin(callback('code=c1&state=state-1', 'flow-1'), login)).text();
	expect(page).toContain('<p>Login failed</p>');
});
