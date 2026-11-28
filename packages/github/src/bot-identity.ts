import { Option, Schema } from 'effect';

export interface BotIdentity {
	login: string;
	id: number;
	email: string;
}

const appSlugPattern = /^[a-z0-9-]+$/;
const botLoginPattern = /^[a-z0-9-]+\[bot\]$/;

export function botLogin(slug: string): Option.Option<string> {
	return appSlugPattern.test(slug) ? Option.some(`${slug}[bot]`) : Option.none();
}

export function botIdentityOf(login: string, id: number): BotIdentity {
	return { login, id, email: `${id}+${login}@users.noreply.github.com` };
}

const claimedIdentity = Schema.Struct({
	login: Schema.String.check(Schema.isPattern(botLoginPattern)),
	id: Schema.Int.check(Schema.isGreaterThan(0)),
	email: Schema.String,
});

export function parseBotIdentity(value: unknown): Option.Option<BotIdentity> {
	return Schema.decodeUnknownOption(claimedIdentity)(value).pipe(
		Option.filter(claimed => claimed.email === botIdentityOf(claimed.login, claimed.id).email),
	);
}
