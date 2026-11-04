import { z } from 'zod';
import { credentialHash } from '@/automation/cli-auth';
import { resolveConfiguration } from '@/automation/configuration';
import type { RepositoryGateway } from '@/automation/github';
import { discover } from '@/automation/managers';
import { packageId } from '@/automation/package-identity';
import { exclusionLabel, publishable } from '@/automation/package-publication';
import { documentRow } from '@/automation/schemas';
import { previewSetup, setupBody, setupOptions, withRegistryStatus } from '@/automation/setup';
import type { SetupChoices } from '@/automation/setup-types';
import type { Store } from '@/automation/store';
import type { Edit, Snapshot } from '@/automation/types';
import { record } from '@/model';
import { packageLabel } from '@/ui/package-label';

const editsSchema = z.array(z.object({ path: z.string(), before: z.string(), after: z.string() }));
export function sameEdits(left: Edit[], right: Edit[]): boolean {
	const sorted = (edits: Edit[]) => JSON.stringify([...edits].sort((a, b) => a.path.localeCompare(b.path)));
	return sorted(left) === sorted(right);
}
export function setupEdits(saved: Record<string, unknown> | undefined): Edit[] {
	if (Array.isArray(saved?.edits)) return editsSchema.parse(saved.edits);
	return typeof saved?.content === 'string'
		? [{ path: '.github/beepboop.json', before: '', after: saved.content }]
		: [];
}

/** Reconcile an already-open proposal after discovery, without starting a release or changing human edits. */
export async function maintainSetup(
	store: Store,
	gateway: RepositoryGateway,
	snapshot: Snapshot,
	requested?: { number: number; choices: SetupChoices },
): Promise<void> {
	const { name, id } = snapshot.repository;
	const row = documentRow.nullable().parse(
		await store.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(id).first(),
	);
	if (!row) return;
	const saved = record(JSON.parse(row.document));
	const pull = await gateway.openSetupPull(name, id);
	if (!pull || (requested && pull.number !== requested.number)) return;
	const generated = await gateway.generatedFiles(name, id, pull.head);
	if (!generated && saved.head !== pull.head) return;
	const previous = generated ?? setupEdits(saved);
	const inventory = withRegistryStatus(discover(snapshot), (await store.repository(id))?.inventory);
	const summary = `Inspected [${snapshot.sha}](https://github.com/${name}/commit/${snapshot.sha}).\n\n`
		+ 'Discovered packages:\n'
		+ inventory.packages.map(pkg =>
			`- \`${publishable(pkg) ? packageLabel(packageId(pkg)) : pkg.name}\` (${
				[pkg.manifest, exclusionLabel(pkg.publication)].filter(Boolean).join(', ')
			})`
		).join(
			'\n',
		);
	const save = async (next: Record<string, unknown>) => {
		// Do not overwrite a newer explicit setup operation or another reconciliation's journal.
		await store.db.prepare('UPDATE onboarding SET document=? WHERE repository_id=? AND document=?')
			.bind(JSON.stringify(next), id, row.document).run();
	};
	try {
		const resolved = await resolveConfiguration(
			JSON.parse(snapshot.files['.github/beepboop.json'] ?? '{}'),
			ref => gateway.preset(ref),
		);
		const original = previous.find(edit => edit.path === '.github/beepboop.json')?.before ?? '';
		const choices = requested?.choices
			?? ((snapshot.files['.github/beepboop.json'] ?? '') === original ? saved.choices : undefined);
		const plan = await previewSetup(snapshot, inventory, choices, {
			head: pull.head,
			workflowPermission: await gateway.canEditWorkflows(name, id),
			presetShas: resolved.presetShas,
			prior: { url: pull.url, content: typeof saved.content === 'string' ? saved.content : undefined },
		}, resolved.configuration);
		const fingerprint = await credentialHash(JSON.stringify({ plan, head: pull.head }));
		const unboxed = saved.options === undefined;
		const addBoxes = async () => {
			if (!unboxed) return {};
			await gateway.refreshPullRequest(
				snapshot,
				'automation/onboarding',
				'chore: configure release automation',
				setupBody(plan),
				pull.head,
			);
			return { options: setupOptions(plan) };
		};
		if (saved.maintenanceFingerprint === fingerprint && !unboxed) return;
		if (plan.blockers.length || !plan.edits.length) {
			await gateway.setupStatus(
				name,
				id,
				pull.number,
				`${summary}\n\n${
					plan.blockers.length
						? `Automatic update needs attention:\n${plan.blockers.map(message => `- ${message}`).join('\n')}`
						: 'The default branch already matches the proposed setup.'
				}`,
			);
			await save({ ...saved, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha, ...await addBoxes() });
			return;
		}
		// Even an unchanged source may need a newer generator's output. An identical proposal needs no commit.
		if (saved.sourceSha === snapshot.sha && sameEdits(previous, plan.edits)) {
			const boxes = await addBoxes();
			await gateway.setupStatus(name, id, pull.number, `${summary}\n\nThe proposal is up to date.`);
			await save({ ...saved, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha, ...boxes });
			return;
		}
		const result = await gateway.pullRequest(
			snapshot,
			'automation/onboarding',
			'chore: configure release automation',
			setupBody(plan),
			plan.edits,
			pull.head,
			undefined,
			previous,
			pull.number,
		);
		const generated = new Map(
			previous.flatMap(edit => {
				const after = snapshot.files[edit.path];
				return after === undefined ? [] : [[edit.path, { ...edit, after }] as const];
			}),
		);
		for (const edit of plan.edits) generated.set(edit.path, edit);
		await save({
			...saved,
			...result,
			sourceSha: snapshot.sha,
			checkedSha: snapshot.sha,
			content: plan.edits.find(edit => edit.path === '.github/beepboop.json')?.after
				?? snapshot.files['.github/beepboop.json'],
			choices: plan.choices,
			options: setupOptions(plan),
			edits: [...generated.values()],
			maintenanceFingerprint: undefined,
		});
		await store.audit(
			'beepboop',
			requested ? 'repository.setup.edited' : 'repository.setup.refreshed',
			`${name} ${snapshot.sha} ${result.url}`,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Setup refresh failed';
		await gateway.setupStatus(
			name,
			id,
			pull.number,
			`${summary}\n\nAutomatic update stopped: ${message}\n\nReview the reported conflict or permissions. Beepboop will recheck this proposal on the next repository refresh.`,
		);
		throw error;
	}
}
