import { expect, test } from 'bun:test';
import type { World } from '@root/test/support/world.ts';
import { eachWorld, origin } from '@root/test/support/world.ts';
import { confirmationCode, loginSecret } from '@/kernel/schema/ids.ts';
import { errorPage } from '@/server/failure.ts';

let world: World;
eachWorld(created => {
	world = created;
});

const approvalHeaders = {
	'cache-control': 'no-store',
	'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
	'content-type': 'text/html; charset=utf-8',
	'referrer-policy': 'no-referrer',
};

function headers(response: Response): Record<string, string> {
	return Object.fromEntries(response.headers);
}

test('a callback without a login attempt answers with the sign-in failure page', async () => {
	const response = await world.handle(new Request(`${origin}/auth/callback?code=c&state=s`));
	expect(response.status).toBe(401);
	expect(headers(response)).toEqual({
		'cache-control': 'no-store',
		'content-type': 'text/html; charset=utf-8',
		'set-cookie': '__Host-beepboop_flow=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
	});
	expect(await response.text()).toBe(errorPage({
		title: 'Sign-in failed',
		heading: 'Sign-in failed',
		message: 'This sign-in link has no login attempt behind it. Cookies may be blocked.',
		link: { href: '/auth/login', text: 'Sign in again' },
	}));
});

test('the signed-in browser sees the CLI approval page, then the approved page', async () => {
	const challenge = loginSecret();
	const cookie = await world.adminCookie();
	const url = `${origin}/auth/cli/authorize?challenge=${challenge}`;
	const pending = await world.handle(new Request(url, { headers: { Cookie: cookie } }));
	expect(pending.status).toBe(200);
	expect(headers(pending)).toEqual(approvalHeaders);
	expect(await pending.text()).toBe(
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beepboop CLI login</title><main><h1>Authorize Beepboop CLI</h1><p>Only approve if you just ran beepboop auth login in your own terminal. This grants administrator API access until you run beepboop auth logout. Security-key checks still apply.</p><p>Confirm this code matches your terminal: <strong>${
			confirmationCode(challenge)
		}</strong></p><form method="post"><button>Authorize my terminal</button></form></main></html>`,
	);
	const approved = await world.handle(
		new Request(url, { method: 'POST', headers: { Cookie: cookie, Origin: origin } }),
	);
	expect(approved.status).toBe(200);
	expect(headers(approved)).toEqual(approvalHeaders);
	expect(await approved.text()).toBe(
		'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beepboop CLI login</title><main><h1>Terminal approved</h1><p>Return to your terminal. You can close this page.</p></main></html>',
	);
});
