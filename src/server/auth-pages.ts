import { AuthPages } from '@/auth/pages.ts';
import { errorPage } from '@/server/failure.ts';

export const authPages = AuthPages.of({
	loginFailed: reason =>
		errorPage({
			title: 'Sign-in failed',
			heading: 'Sign-in failed',
			message: reason,
			link: { href: '/auth/login', text: 'Sign in again' },
		}),
	cliApproval: page =>
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beepboop CLI login</title><main><h1>${
			page._tag === 'Approved' ? 'Terminal approved' : 'Authorize Beepboop CLI'
		}</h1>${
			page._tag === 'Approved'
				? '<p>Return to your terminal. You can close this page.</p>'
				: `<p>Only approve if you just ran beepboop auth login in your own terminal. This grants administrator API access until you run beepboop auth logout. Security-key checks still apply.</p><p>Confirm this code matches your terminal: <strong>${page.code}</strong></p><form method="post"><button>Authorize my terminal</button></form>`
		}</main></html>`,
});
