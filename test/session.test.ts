import { afterEach, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { type AuthBindings, authRoute, enrollmentRefusal, signOut } from '@/automation/auth';

const origin = 'https://beepboop.example';

function logout(headers: Record<string, string>): Request {
	return new Request(`${origin}/auth/logout`, { method: 'POST', headers });
}

const unused = (): never => {
	throw new Error('database unused');
};
const env: AuthBindings = {
	DB: { prepare: unused, batch: unused, exec: unused, withSession: unused, dump: unused },
	APPLICATION_ORIGIN: origin,
	OPENAUTH_ISSUER: 'https://auth.example',
	OPENAUTH_CLIENT_ID: 'beepboop',
	ADMIN_SUBJECT: 'user:admin',
};

test('signing out with an expired session still clears the cookie and returns to login', async () => {
	const response = await authRoute(logout({ origin }), env);
	expect(response?.status).toBe(303);
	expect(response?.headers.get('Location')).toBe('/auth/login');
	expect(response?.headers.get('Set-Cookie')).toStartWith('__Host-beepboop_access=;');
	expect(response?.headers.get('Set-Cookie')).toContain('Max-Age=0');
});

test('signing out from another origin is refused', async () => {
	const response = signOut(logout({ origin: 'https://evil.example' }), origin);
	expect(response.status).toBe(403);
	expect(response.headers.get('Set-Cookie')).toBeNull();
	expect(await response.json()).toEqual({ error: 'Invalid request origin' });
});

test('the first key enrolls with the login alone and key checks need an enrolled key', () => {
	expect(enrollmentRefusal(true, 0)).toBeUndefined();
	expect(enrollmentRefusal(true, 1)).toBeUndefined();
	expect(enrollmentRefusal(false, 2)).toBeUndefined();
	expect(enrollmentRefusal(false, 0)).toBe('Enroll a security key first.');
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	Reflect.deleteProperty(globalThis, 'location');
});

test('a dashboard request with an expired session sends the browser back to login', async () => {
	const { api } = await import('../src/ui/browser/dom.ts');
	const visited: string[] = [];
	Object.defineProperty(globalThis, 'location', {
		value: { assign: (url: string) => visited.push(url) },
		configurable: true,
	});
	globalThis.fetch = Object.assign(
		async () => Response.json({ error: 'Administrator authentication required' }, { status: 401 }),
		{ preconnect: realFetch.preconnect },
	);
	await rejects(api('/api/activity'), /Session expired\. Signing in again\./);
	expect(visited).toEqual(['/auth/login']);
});
