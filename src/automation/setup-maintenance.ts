import { z } from 'zod';
import { credentialHash } from '@/automation/cli-auth';
import { resolveConfiguration } from '@/automation/configuration';
import type { RepositoryGateway } from '@/automation/github';
import { discover } from '@/automation/managers';
import { packageId } from '@/automation/package-identity';
import { exclusionLabel, publishable } from '@/automation/package-publication';
import { documentRow } from '@/automation/schemas';
import { previewSetup, setupBody } from '@/automation/setup';
import type { Store } from '@/automation/store';
import type { Edit, Snapshot } from '@/automation/types';
import { record } from '@/model';
import { packageLabel } from '@/ui/package-label';

const editsSchema = z.array(z.object({ path: z.string(), before: z.string(), after: z.string() }));
export function setupEdits(saved: Record<string, unknown> | undefined): Edit[] {
	if (Array.isArray(saved?.edits)) return editsSchema.parse(saved.edits);
	return typeof saved?.content === 'string'
		? [{ path: '.github/beepboop.json', before: '', after: saved.content }]
		: [];
}

/** Reconcile an already-open proposal after discovery, without starting a release or changing human edits. */
export async function maintainSetup(store: Store, gateway: RepositoryGateway, snapshot: Snapshot): Promise<void> {
	const { name, id } = snapshot.repository;
	const row = documentRow.nullable().parse(
		await store.db.prepare('SELECT document FROM onboarding WHERE repository_id=?').bind(id).first(),
	);
	if (!row) return;
	const saved = record(JSON.parse(row.document));
	const pull = await gateway.openSetupPull(name, id);
	if (!pull) return;
	const previous = setupEdits(saved);
	const conflict = saved.head !== pull.head;
	const inventory = discover(snapshot);
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
		const choices = (snapshot.files['.github/beepboop.json'] ?? '') === original ? saved.choices : undefined;
		const plan = await previewSetup(snapshot, inventory, choices, {
			head: pull.head,
			branchConflict: conflict,
			workflowPermission: await gateway.canEditWorkflows(name, id),
			presetShas: resolved.presetShas,
			prior: { url: pull.url, content: typeof saved.content === 'string' ? saved.content : undefined },
		}, resolved.configuration);
		const fingerprint = await credentialHash(JSON.stringify({ plan, head: pull.head }));
		if (saved.maintenanceFingerprint === fingerprint) return;
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
			await save({ ...saved, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha });
			return;
		}
		// Even an unchanged source may need a newer generator's output. An identical proposal needs no commit.
		if (saved.sourceSha === snapshot.sha && JSON.stringify(previous) === JSON.stringify(plan.edits)) {
			await gateway.setupStatus(name, id, pull.number, `${summary}\n\nThe proposal is up to date.`);
			await save({ ...saved, maintenanceFingerprint: fingerprint, checkedSha: snapshot.sha });
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
			edits: [...generated.values()],
			maintenanceFingerprint: undefined,
		});
		await store.audit('beepboop', 'repository.setup.refreshed', `${name} ${snapshot.sha} ${result.url}`);
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
