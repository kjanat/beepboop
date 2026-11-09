import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	begin,
	commitAll,
	gitOutput,
	materialize,
	runAction,
	runIdentity,
	runRuntime,
} from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { filesAt } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { one } from '@root/test/support/lists.ts';
import { approvePromotion, prepareRelease } from '@root/test/support/releases.ts';
import { jsonFile, passChecks, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
import type { SigningKey } from '@root/test/support/signing.ts';
import type { World } from '@root/test/support/world.ts';
import { z } from 'zod';
import type { TagSigner } from '@/automation/refs';

const prepareWorkflow = `name: Prepare
on:
  workflow_dispatch:
    inputs:
      beepboop_execution_id:
        required: true
        type: string
jobs:
  prepare:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

const contextFields = z.object({ id: z.string(), sourceSha: z.string() });
const refPlan = z.object({
	changes: z.array(z.object({
		name: z.string(),
		commit: z.string(),
		annotated: z.boolean(),
		signed: z.boolean(),
		object: z.string().optional(),
	})),
	publicKey: z.string().optional(),
});
export type PackedRefPlan = z.infer<typeof refPlan>;

export interface PackedSigning {
	key: SigningKey;
	signer?: TagSigner;
}

export interface PackedRelease {
	repository: Repository;
	promotionId: string;
	plan: PackedRefPlan;
	tags: Record<string, string>;
}

export async function packedRelease(
	world: World,
	beforeRefs?: (promotionId: string) => Promise<void>,
	signing?: PackedSigning,
	githubRelease = false,
): Promise<PackedRelease> {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = z.looseObject({
		streams: z.looseObject({
			main: z.looseObject({
				prepare: z.looseObject({}),
				promote: z.looseObject({ workflow: z.looseObject({ publications: z.array(z.string()) }) }),
			}),
		}),
	}).parse(JSON.parse(widgetConfiguration()));
	configuration.streams.main.prepare = { workflow: { file: 'prepare.yml' } };
	if (githubRelease) configuration.streams.main.promote.workflow.publications.push('github-release:octo/widget');
	configuration.streams.main.promote.workflow.refs = {
		phase: 'version',
		prefix: 'v',
		aliases: [],
		signed: signing !== undefined && signing.signer === undefined,
	};
	if (signing?.signer) world.env.SIGNER = signing.signer;
	const pushed = world.github.push(repository, {
		'.github/beepboop.json': jsonFile(configuration, '\t'),
		'.github/workflows/prepare.yml': prepareWorkflow,
	}, 'Prepare in the workflow');
	const checkout = materialize(filesAt(repository, pushed.sha));
	const scratch = mkdtempSync(join(tmpdir(), 'beepboop-refs-'));
	const origin = join(scratch, 'origin.git');
	const gitconfig = join(scratch, 'gitconfig');
	try {
		world.github.relabel(repository, pushed.sha, checkout.sha);
		passChecks(repository, checkout.sha);
		const api = bearer(world, await world.cliSession());
		const discovered = await api('/api/repositories/discover', { repository: 'octo/widget' });
		if (discovered.status !== 200) throw new Error(`Discover failed ${discovered.status}`);
		const { prepared } = await prepareRelease(api, { repositoryId: repository.id, stream: 'main', version: '1.1.0' });
		if (prepared.status !== 200) throw new Error(`Prepare failed ${prepared.status}`);
		await world.wait(20_000);
		const prepareRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/prepare.yml'),
			'prepare run',
		);
		prepareRun.status = 'in_progress';
		const prepareIdentity = runIdentity(repository, prepareRun, 'prepare.yml');
		const begun = await begin(world, prepareIdentity, text(prepared.body, 'id'), 'main', 'prepare');
		const releaseContext = begun.outputs.context ?? '';
		const source = contextFields.parse(JSON.parse(releaseContext));
		if (source.sourceSha !== gitOutput(checkout.dir, ['rev-parse', 'HEAD'])) {
			throw new Error('Checkout drifted from the planned source');
		}
		const environment = join(scratch, 'env');
		const runner = join(scratch, 'runner');
		writeFileSync(environment, '');
		mkdirSync(runner);
		await runRuntime('prepare', {
			RELEASE_CONTEXT: releaseContext,
			PREPARATION_MODE: 'apply',
			GITHUB_WORKSPACE: checkout.dir,
		});
		await runRuntime('prepare', {
			RELEASE_CONTEXT: releaseContext,
			PREPARATION_MODE: 'submit',
			GITHUB_WORKSPACE: checkout.dir,
			GITHUB_ENV: environment,
			RUNNER_TEMP: runner,
		});
		const submitted = /^PREPARED_FILE=(.+)$/m.exec(readFileSync(environment, 'utf8'));
		const file = submitted?.[1];
		if (!file) throw new Error('Prepare submit wrote no PREPARED_FILE');
		await runAction(world, 'prepared', prepareIdentity, { PREPARED_FILE: file });
		prepareRun.status = 'completed';
		prepareRun.conclusion = 'success';
		await world.workflowRun(repository, prepareRun, 'success', 'workflow_dispatch');
		await world.wait(1_000);
		const pull = one(repository.pulls, 'preparation pull request');
		const released = commitAll(checkout.dir, 'Release 1.1.0');
		const merged = world.github.merge(repository, pull.number);
		world.github.relabel(repository, merged.sha, released);
		passChecks(repository, released);
		if ((await world.push(repository)).status !== 202) throw new Error('Push was refused');
		await world.wait(1_000);
		const { promotion, approved } = await approvePromotion(api, released);
		const promotionId = promotion.id;
		if (promotion.sourceSha !== released) throw new Error('Promotion source is not the packed checkout');
		if (text(approved.body, 'state') !== 'ready') throw new Error('Promotion stayed blocked');
		await world.wait(16_000);
		const promoteRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/publish.yml'),
			'promote run',
		);
		promoteRun.status = 'in_progress';
		const promoteIdentity = runIdentity(repository, promoteRun, 'publish.yml');
		await begin(world, promoteIdentity, promotionId, 'main', 'promote');
		if (beforeRefs) await beforeRefs(promotionId);
		const planned = await runAction(world, 'refs-plan', promoteIdentity, { EXECUTION_ID: promotionId });
		const planBody = refPlan.parse(JSON.parse(planned.outputs.result ?? ''));
		const local = signing && !signing.signer ? signing.key : undefined;
		writeFileSync(
			gitconfig,
			`[url "${origin}"]\n\tinsteadOf = https://github.com/${repository.name}.git\n${
				local ? `[user]\n\tsigningkey = ${local.fingerprint}\n` : ''
			}`,
		);
		gitOutput(scratch, ['init', '--bare', origin]);
		const refsTemp = join(scratch, 'refs-temp');
		mkdirSync(refsTemp);
		await runRuntime('refs', {
			REF_PLAN: planned.outputs.result ?? '',
			REF_TOKEN: 'destination-token',
			GITHUB_WORKSPACE: checkout.dir,
			GIT_CONFIG_GLOBAL: gitconfig,
			RUNNER_TEMP: refsTemp,
			...(local ? { GNUPGHOME: local.home } : {}),
		});
		const tags: Record<string, string> = {};
		for (const change of planBody.changes) {
			const oid = gitOutput(origin, ['rev-parse', `refs/tags/${change.name}`]);
			const commit = gitOutput(origin, ['rev-parse', `refs/tags/${change.name}^{commit}`]);
			if (commit !== change.commit) throw new Error(`Tag ${change.name} points at ${commit}`);
			if (!change.annotated) continue;
			tags[change.name] = gitOutput(origin, ['cat-file', '-p', oid]);
			const verified = signing?.key.verifies(origin, `refs/tags/${change.name}`) ?? false;
			world.github.recordTag(repository, change.name, oid, commit, verified);
		}
		if (readdirSync(refsTemp).length) throw new Error('The refs runtime left files in RUNNER_TEMP');
		await runAction(world, 'refs-complete', promoteIdentity, { EXECUTION_ID: promotionId });
		if (githubRelease) await runAction(world, 'release', promoteIdentity, { EXECUTION_ID: promotionId });
		world.npm.publish('widget', '1.1.0');
		await runAction(world, 'report', promoteIdentity, {
			EXECUTION_ID: promotionId,
			PUBLICATIONS: JSON.stringify([
				{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.1.0', outcome: 'succeeded' },
			]),
		});
		promoteRun.status = 'completed';
		promoteRun.conclusion = 'success';
		await world.workflowRun(repository, promoteRun, 'success', 'workflow_dispatch');
		await world.wait(2_000);
		return { repository, promotionId, plan: planBody, tags };
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}
