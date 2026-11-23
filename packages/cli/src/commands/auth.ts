import type { SpinnerHandle } from '@kjanat/dreamcli';
import { flag, group } from '@kjanat/dreamcli';
import { Effect, Schema } from 'effect';
import { openBrowser } from '@/cli/browser-launch';
import { base, connected } from '@/cli/command';
import { lookOf, step } from '@/cli/render/look';
import { emit } from '@/cli/render/output';
import { looseStruct, safeDecode } from '@/kernel/schema/structs.ts';

const sessionStatus = looseStruct({ subject: Schema.String });
const authStatus = base('status', 'Verify your saved session with the server').action(
	connected((client, { out }) =>
		Effect.gen(function*() {
			const look = lookOf(out);
			const status = yield* step(
				out,
				`Checking your session with ${client.origin}`,
				client.status(),
				() => 'Session is valid',
			);
			if (out.jsonMode) return yield* emit(out, status);
			const parsed = safeDecode(sessionStatus, status);
			out.log(
				`${look.mark('published')} Signed in to ${look.link(client.origin)}${
					parsed.success ? ` as ${look.pkg(parsed.data.subject)}` : ''
				}`,
			);
		})
	),
);
export const auth = group('auth').description('Sign in, inspect your session, or revoke it')
	.command(
		base('login', 'Approve this terminal in your browser; the session lasts until logout', true)
			.flag(
				'browser',
				flag.boolean().prompt({ kind: 'confirm', message: 'Open the login page in your browser?', default: true })
					.default(true),
			)
			.action(connected((client, { flags, out }) =>
				Effect.gen(function*() {
					const look = lookOf(out);
					let waiting: SpinnerHandle | undefined;
					yield* client.login((url, code) =>
						Effect.gen(function*() {
							out.status(`Login page: ${look.link(url)}\nConfirm code: ${look.heading(code)}`);
							if (!flags.browser) return;
							if (!(yield* openBrowser(url))) out.status('Could not open the browser. Open the login page above.');
						}).pipe(Effect.ensuring(Effect.sync(() => {
							waiting = out.spinner('Waiting for you to approve this terminal in the browser');
						}))), () => Effect.sync(() => waiting?.update('Still waiting for your approval in the browser'))).pipe(
							Effect.tapError(() => Effect.sync(() => waiting?.fail('Login did not complete'))),
						);
					waiting?.succeed('Approved in the browser');
					if (out.jsonMode) return yield* emit(out, { server: client.origin, signedIn: true });
					out.log(`${look.mark('published')} Signed in to ${look.link(client.origin)}.`);
				})
			)),
	)
	.command(authStatus)
	.command(
		base('logout', 'Revoke this terminal session and remove its local credential').action(
			connected((client, { out }) =>
				Effect.gen(function*() {
					yield* step(out, 'Revoking this terminal session', client.logout(), () => 'Session revoked');
					out.log(`${lookOf(out).mark('published')} Signed out.`);
				})
			),
		),
	);
