export const systemComponents = ['beepboop', 'winget'] as const;
export type SystemComponent = (typeof systemComponents)[number];
export type Actor =
	| { kind: 'admin'; subject: string }
	| { kind: 'run'; runId: number; repositoryId?: never; attempt?: never }
	| { kind: 'run'; runId: number; repositoryId: number; attempt: number }
	| { kind: 'system'; component: SystemComponent }
	| { kind: 'setup'; execution: string };

const systemLabels = {
	beepboop: 'Beepboop',
	winget: 'WinGet automation',
} as const satisfies Record<SystemComponent, string>;

function identifier(digits: string | undefined): number | undefined {
	const value = Number(digits);
	return digits !== undefined && Number.isSafeInteger(value) ? value : undefined;
}

function parseRun(value: string): Actor | undefined {
	const run = /^run:(?:([1-9][0-9]*):)?([1-9][0-9]*)(?::([1-9][0-9]*))?$/.exec(value);
	const runId = identifier(run?.[2]);
	if (runId === undefined) return undefined;
	if (run?.[1] === undefined && run?.[3] === undefined) return { kind: 'run', runId };
	const repositoryId = identifier(run?.[1]);
	const attempt = identifier(run?.[3]);
	return repositoryId === undefined || attempt === undefined
		? undefined
		: { kind: 'run', runId, repositoryId, attempt };
}

export function parseActor(value: string): Actor {
	const run = parseRun(value);
	if (run) return run;
	const setup = /^setup:(.+)$/.exec(value)?.[1];
	if (setup) return { kind: 'setup', execution: setup };
	const component = systemComponents.find(name => name === value);
	return component ? { kind: 'system', component } : { kind: 'admin', subject: value };
}

export function actorLabel(actor: Actor): string {
	switch (actor.kind) {
		case 'run':
			return `Workflow run ${actor.runId}`;
		case 'system':
			return systemLabels[actor.component];
		case 'setup':
			return 'Beepboop setup';
		case 'admin':
			return 'Administrator';
	}
}

export function runRepository(target: string): string | undefined {
	return /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)/.exec(target)?.[1];
}
