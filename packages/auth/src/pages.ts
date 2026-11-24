import { Context } from 'effect';

export type CliApprovalPage =
	| { readonly _tag: 'Authorize'; readonly code: string }
	| { readonly _tag: 'Approved' };

export class AuthPages extends Context.Service<AuthPages, {
	readonly loginFailed: (reason: string) => string;
	readonly cliApproval: (page: CliApprovalPage) => string;
}>()('beepboopbot/auth/AuthPages') {}
