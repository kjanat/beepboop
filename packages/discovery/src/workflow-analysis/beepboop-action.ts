export function beepboopAction(value: unknown): string | undefined {
	if (typeof value !== 'string') return;
	return /^(?:(?:\$|\.)\/actions\/|kjanat\/beepboop\/actions\/)([\w-]+)(?:@[\w./-]+)?$/.exec(value)?.[1];
}
const actionRoles = ['begin', 'prepare', 'report', 'publish'] as const;
export type ActionRole = (typeof actionRoles)[number];
export function actionRole(value: unknown): ActionRole | undefined {
	const action = beepboopAction(value);
	return actionRoles.find(role => role === action);
}
export function beepboopActionReference(name: string, revision: string | undefined): string {
	return `kjanat/beepboop/actions/${name}@${revision ?? 'v1'}`;
}
