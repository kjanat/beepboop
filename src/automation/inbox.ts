import { z } from 'zod';

export const setupPullEdit = z.object({
	action: z.literal('edited'),
	changes: z.object({ body: z.object({ from: z.string().nullable() }) }),
	sender: z.object({ id: z.number() }),
	pull_request: z.object({
		number: z.number().int().positive(),
		state: z.literal('open'),
		body: z.string().nullable(),
		user: z.object({ id: z.number() }),
		head: z.object({
			ref: z.literal('automation/onboarding'),
			sha: z.string().regex(/^[a-f0-9]{40}$/),
			repo: z.object({ id: z.number() }),
		}),
		base: z.object({ repo: z.object({ id: z.number() }) }),
	}),
});
export type SetupPullEdit = z.output<typeof setupPullEdit>;

export const inboxEvent = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('push'), ref: z.string() }),
	z.object({ kind: z.literal('release'), action: z.string() }),
	z.object({
		kind: z.literal('workflow_run'),
		action: z.string(),
		run: z.object({
			id: z.number().int().positive(),
			conclusion: z.string().nullable(),
			event: z.string(),
			path: z.string(),
			headRepositoryId: z.number().int().nullable(),
		}),
	}),
	z.object({ kind: z.literal('pull_request'), edit: setupPullEdit }),
]);
export type InboxEvent = z.output<typeof inboxEvent>;

export const inboxEntry = z.object({
	delivery: z.string().min(1),
	repositoryId: z.number().int().positive(),
	event: inboxEvent,
	attempts: z.number().int().nonnegative(),
	due: z.number(),
	error: z.string().optional(),
});
export type InboxEntry = z.output<typeof inboxEntry>;
