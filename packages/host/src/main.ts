import { Cause, Effect, Exit } from 'effect';

function message(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const parts: string[] = [];
	for (let current: unknown = error, depth = 0; current instanceof Error && depth < 8; depth++) {
		const text = current.message;
		if (text && !parts.some(part => part.includes(text))) parts.push(text);
		current = current.cause;
	}
	return parts.join(': ');
}

export function failureReport(cause: Cause.Cause<unknown>): string {
	if (Cause.hasDies(cause)) return Cause.pretty(cause);
	const report = cause.reasons.filter(Cause.isFailReason).map(reason => message(reason.error)).join('\n');
	return report || Cause.pretty(cause);
}

function annotation(report: string): string {
	return `::error::${report.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`;
}

export async function runMain(program: Effect.Effect<void, unknown>): Promise<void> {
	const exit = await Effect.runPromiseExit(program);
	if (Exit.isSuccess(exit)) return;
	if (Cause.hasInterruptsOnly(exit.cause)) {
		process.exitCode = 130;
		return;
	}
	const report = failureReport(exit.cause);
	console.error(process.env.GITHUB_ACTIONS === 'true' ? annotation(report) : report);
	process.exitCode = 1;
}
