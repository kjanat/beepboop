/// <reference types="astro/client" />
declare namespace App {
	interface Locals {
		actor: string;
	}
}

interface Env {
	GITHUB_WEBHOOK_SECRET: string;
	VAULT_KEYS: string;
	GITHUB_APP_ID: string;
	GITHUB_APP_PRIVATE_KEY: string;
}
declare namespace Cloudflare {
	interface Env {
		GITHUB_WEBHOOK_SECRET: string;
		VAULT_KEYS: string;
		GITHUB_APP_ID: string;
		GITHUB_APP_PRIVATE_KEY: string;
	}
}
