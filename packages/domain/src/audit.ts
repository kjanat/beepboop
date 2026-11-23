export const systemComponents = ['beepboop', 'winget'] as const;
export type SystemComponent = (typeof systemComponents)[number];
export type Actor =
	| { kind: 'admin' }
	| { kind: 'run'; runId: number }
	| { kind: 'system'; component: SystemComponent };

const systemLabels = {
	beepboop: 'Beepboop',
	winget: 'WinGet automation',
} as const satisfies Record<SystemComponent, string>;

export function parseActor(value: string): Actor {
	const run = /^run:([1-9][0-9]*)$/.exec(value)?.[1];
	if (run) return { kind: 'run', runId: Number(run) };
	const component = systemComponents.find(name => name === value);
	return component ? { kind: 'system', component } : { kind: 'admin' };
}

export function actorLabel(actor: Actor): string {
	if (actor.kind === 'run') return `Workflow run ${actor.runId}`;
	if (actor.kind === 'system') return systemLabels[actor.component];
	return 'Administrator';
}

export function runRepository(target: string): string | undefined {
	return /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)/.exec(target)?.[1];
}

export type AuditActor =
	| { kind: 'admin'; subject: string }
	| { kind: 'run'; runId: number; repositoryId?: number; attempt?: number }
	| { kind: 'system'; component: SystemComponent }
	| { kind: 'setup'; execution: string };

export function auditActor(value: string): AuditActor {
	const run = /^run:(?:([1-9][0-9]*):)?([1-9][0-9]*)(?::([1-9][0-9]*))?$/.exec(value);
	if (run?.[2] && (run[1] === undefined) === (run[3] === undefined)) {
		return {
			kind: 'run',
			runId: Number(run[2]),
			...(run[1] && run[3] ? { repositoryId: Number(run[1]), attempt: Number(run[3]) } : {}),
		};
	}
	const setup = /^setup:(.+)$/.exec(value)?.[1];
	if (setup) return { kind: 'setup', execution: setup };
	const component = systemComponents.find(name => name === value);
	return component ? { kind: 'system', component } : { kind: 'admin', subject: value };
}
