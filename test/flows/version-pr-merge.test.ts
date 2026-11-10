import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { begin, runAction, runIdentity } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { prepareWorkflow } from '@root/test/support/packed-release.ts';
import { only, prepareRelease } from '@root/test/support/releases.ts';
import { editableConfiguration, passChecks, widget } from '@root/test/support/repositories.ts';
import type { World } from '@root/test/support/world.ts';
import { eachWorld } from '@root/test/support/world.ts';
import { behaviourChanges } from '@/automation/setup-changes';
import type { VersionPrMerge } from '@/contract/setup-terms';
import { versionPrMergeSentences } from '@/contract/setup-terms';
import { runCard } from '@/server/views/runs';

let world: World;
eachWorld(created => {
	world = created;
});

async function versionPr(merge: VersionPrMerge, allowAutoMerge: boolean, prepare: Record<string, unknown>) {
	const repository = widget(world.github);
	repository.allowAutoMerge = allowAutoMerge;
	world.npm.publish('widget', '1.0.0');
	const configuration = editableConfiguration();
	configuration.streams.main = {
		...configuration.streams.main,
		credentials: [],
		prepare: { ...prepare, versionPrMerge: merge },
	};
	const head = world.github.push(repository, {
		'.github/beepboop.json': JSON.stringify(configuration),
		'.github/workflows/prepare.yml': prepareWorkflow,
	}, 'Configure the version PR merge');
	passChecks(repository, head.sha);
	const api = bearer(world, await world.cliSession());
	expect((await api('/api/repositories/discover', { repository: repository.name })).status).toBe(200);
	const { prepared } = await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.0.1' });
	expect(prepared.status).toBe(200);
	return { repository, api, executionId: text(prepared.body, 'id') };
}

async function managed(merge: VersionPrMerge, allowAutoMerge = true) {
	const opened = await versionPr(merge, allowAutoMerge, { strategy: 'managed', bump: 'pr' });
	await world.wait(16_000);
	return opened;
}

async function submitted(repository: Repository, executionId: string, api: Parameters<typeof only>[0]) {
	await world.wait(20_000);
	const run = one(repository.runs.filter(entry => entry.path === '.github/workflows/prepare.yml'), 'prepare run');
	run.status = 'in_progress';
	const identity = runIdentity(repository, run, 'prepare.yml');
	await begin(world, identity, executionId, 'main', 'prepare');
	const edits = (await only(api, 'prepare')).plan?.edits ?? [];
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-prepared-'));
	try {
		const file = join(scratch, 'prepared.json');
		writeFileSync(
			file,
			JSON.stringify({ executionId, files: edits.map(edit => ({ path: edit.path, content: edit.after })) }),
		);
		await runAction(world, 'prepared', identity, { PREPARED_FILE: file });
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

for (const merge of ['squash', 'merge', 'rebase'] as const) {
	test(`versionPrMerge ${merge} turns on GitHub auto-merge with that method for a managed version PR`, async () => {
		const { repository, api } = await managed(merge);
		const pull = one(repository.pulls, 'version PR');
		expect([pull.state, pull.merged, pull.autoMerge, pull.comments]).toEqual([
			'open',
			false,
			merge.toUpperCase(),
			undefined,
		]);
		const preparation = await only(api, 'prepare');
		expect(preparation.managed?.result?.autoMerge).toEqual({ method: merge, state: 'enabled' });
		expect(runCard(preparation, Date.now()).autoMerge).toBe(versionPrMergeSentences[merge].replaceAll('`', ''));
	});
}

test('versionPrMerge squash turns on auto-merge for a version PR that a preparation workflow submits', async () => {
	const { repository, api, executionId } = await versionPr('squash', true, { workflow: { file: 'prepare.yml' } });
	await submitted(repository, executionId, api);
	const pull = one(repository.pulls, 'version PR');
	expect([pull.state, pull.autoMerge]).toEqual(['open', 'SQUASH']);
	expect((await only(api, 'prepare')).prepared?.result?.autoMerge).toEqual({ method: 'squash', state: 'enabled' });
});

test('versionPrMerge manual leaves the version PR for you to merge', async () => {
	const { repository, api } = await managed('manual');
	const pull = one(repository.pulls, 'version PR');
	expect([pull.state, pull.merged, pull.autoMerge, pull.comments]).toEqual(['open', false, undefined, undefined]);
	const preparation = await only(api, 'prepare');
	expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual(['succeeded', undefined]);
	expect(runCard(preparation, Date.now()).autoMerge).toBeUndefined();
});

test('a repository that disallows auto-merge keeps the version PR open with a note', async () => {
	const { repository, api } = await managed('squash', false);
	const pull = one(repository.pulls, 'version PR');
	const note =
		'Beepboop could not turn on squash auto-merge for this version PR. GitHub said: Pull request Auto merge is not allowed for this repository. The PR stays open until you merge it.';
	expect([pull.state, pull.merged, pull.autoMerge, pull.comments]).toEqual(['open', false, undefined, [note]]);
	const preparation = await only(api, 'prepare');
	expect([preparation.state, preparation.managed?.result?.autoMerge]).toEqual([
		'succeeded',
		{ method: 'squash', state: 'refused', note },
	]);
	expect(runCard(preparation, Date.now()).autoMerge).toBe(note);
});

test('the setup PR describes a versionPrMerge change with the sentence of its new value', () => {
	const document = (prepare: Record<string, unknown>) =>
		`${JSON.stringify({ streams: { main: { packages: ['npm:widget'], prepare } } }, null, '\t')}\n`;
	const before = document({ versionLands: 'via-version-pr' });
	const after = document({ versionLands: 'via-version-pr', versionPrMerge: 'rebase' });
	expect(behaviourChanges([{ path: '.github/beepboop.json', before, after }])).toEqual([
		'- `main`',
		`  - \`prepare.versionPrMerge\`: none → \`rebase\`. ${versionPrMergeSentences.rebase}`,
	]);
});
