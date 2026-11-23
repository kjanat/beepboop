import type { WorkflowEvidence } from '@/discovery/workflow-analysis/workflow-evidence.ts';
import type { BinaryBuild, BinaryCandidate, BinaryTarget } from '@/domain/binary-platforms.ts';
import { defaultBinaryTargets } from '@/domain/binary-platforms.ts';
import { publishable } from '@/domain/package-publication.ts';
import type { ApprovalPolicy, VersionBump } from '@/domain/release-start.ts';
import { approvalPolicies, versionBumps } from '@/domain/release-start.ts';
import type { VersionPrMerge } from '@/domain/setup-terms.ts';
import { versionPrMerges } from '@/domain/setup-terms.ts';
import type { Selection } from '@/setup/editing/commands.ts';
import { ledgerCommand } from '@/setup/editing/commands.ts';
import type { SetupPlan, SetupWorkflow, TriggerHandover, Versioning } from '@/setup/types.ts';

export type Role = 'prepare' | 'promote';

export function packageCandidates(plan: SetupPlan): Selection['packages'] {
	return plan.inventory.packages.flatMap((pkg, index) => {
		const id = plan.packageIds[index];
		return id && publishable(pkg) ? [{ ...pkg, id }] : [];
	});
}

export function binaryLabel(build: BinaryBuild): string {
	return `${build.name} (${
		build.toolchain === 'cargo'
			? `Cargo, ${build.manifest}`
			: `Go, ${build.package === '.' ? build.module : `${build.module}/${build.package.slice(2)}`}`
	})`;
}

export interface OfferedBinary {
	build: BinaryBuild;
	candidate?: BinaryCandidate;
}

export function offeredBinaries(
	plan: SetupPlan,
	packages: readonly string[],
	previous: SetupWorkflow | undefined,
): OfferedBinary[] {
	const candidates = (plan.binaryCandidates ?? []).filter(candidate => packages.includes(candidate.package));
	const existing = previous?.binaries?.builds ?? [];
	return [
		...existing.map(build => {
			const candidate = candidates.find(entry => entry.build.name === build.name);
			return candidate ? { build, candidate } : { build };
		}),
		...candidates.filter(candidate => !existing.some(build => build.name === candidate.build.name)).map(
			candidate => ({ build: candidate.build, candidate }),
		),
	];
}

export function binaryTicked(build: BinaryBuild, previous: SetupWorkflow | undefined): boolean {
	return previous ? previous.binaries?.builds.some(entry => entry.name === build.name) ?? false : true;
}

export function binaryTargetDefaults(
	ticked: readonly OfferedBinary[],
	previous: SetupWorkflow | undefined,
): BinaryTarget[] {
	return previous?.binaries?.targets
		?? defaultBinaryTargets.filter(target => ticked.every(entry => entry.candidate?.targets.includes(target) ?? true));
}

export function generatedJob(role: Role): string {
	return role === 'prepare' ? 'prepare' : 'publish';
}

export function inferredJob(
	role: Role,
	stream: string,
	file: string,
	evidence: WorkflowEvidence | undefined,
	previous: SetupWorkflow | undefined,
	usable: readonly string[] = evidence?.jobs ?? [],
): string | undefined {
	const fits = (job: string) => !evidence || usable.includes(job);
	if (previous?.file === file && previous.job && fits(previous.job)) return previous.job;
	const roles = evidence?.roles.filter(entry => entry.stream === stream && entry.operation === role) ?? [];
	const [only] = roles;
	if (only && roles.length === 1 && fits(only.job)) return only.job;
	const [single] = usable;
	return evidence && single !== undefined && usable.length === 1 ? single : undefined;
}

export function defaultTriggers(file: string, previous: SetupWorkflow | undefined): TriggerHandover {
	return previous?.file === file ? previous.triggers : 'review';
}

export function triggerChoices(current: TriggerHandover): TriggerHandover[] {
	return ['review', 'dispatchOnly', ...(current === 'preserve' ? ['preserve' as const] : [])];
}

export function versioningChoices(current: Versioning): Versioning[] {
	return ['workspace', 'independent', ...(current === 'none' ? ['none' as const] : [])];
}

export function publicationStepDefault(
	pkg: string,
	file: string,
	job: string,
	steps: readonly { id: string; label: string }[],
	packages: number,
	previous: SetupWorkflow | undefined,
): string {
	if (previous?.file === file && previous.job === job) {
		const step = previous.publicationSteps[pkg];
		if (step !== undefined) return step;
	}
	const [only] = steps;
	return packages === 1 && only && steps.length === 1 && /publish/i.test(only.label) ? only.id : '';
}

export function keptDistributionCommands(previous: SetupWorkflow | undefined): string | undefined {
	return previous?.commands && previous.commands !== ledgerCommand ? previous.commands : undefined;
}

export function distributionCommands(previous: SetupWorkflow | undefined, build: string, suggested: string): string {
	return [build, previous?.commands || suggested].filter(Boolean).join('\n');
}

export function chosenBump(value: string): VersionBump | undefined {
	return versionBumps.find(entry => entry === value);
}

export function chosenApproval(value: string): ApprovalPolicy | undefined {
	return approvalPolicies.find(entry => entry === value);
}

export function chosenMerge(value: string, previous: VersionPrMerge | undefined): VersionPrMerge | undefined {
	const chosen = versionPrMerges.find(entry => entry === value);
	return chosen && (chosen !== 'manual' || previous) ? chosen : undefined;
}
