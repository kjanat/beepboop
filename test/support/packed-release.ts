import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitAll, gitOutput, materialize, runAction, runRuntime } from '@root/test/support/actions.ts';
import type { Repository } from '@root/test/support/github.ts';
import { botId, ownerId } from '@root/test/support/github.ts';
import { bearer, text } from '@root/test/support/http.ts';
import { passChecks, widget, widgetConfiguration } from '@root/test/support/repositories.ts';
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

function one<T>(items: T[], label: string): T {
	const [item] = items;
	if (items.length !== 1 || item === undefined) throw new Error(`Expected one ${label}, found ${items.length}`);
	return item;
}

function filesAt(repository: Repository, sha: string): Record<string, string> {
	const commit = repository.commits.get(sha);
	const tree = commit ? repository.trees.get(commit.tree) : undefined;
	if (!tree) throw new Error('Missing tree');
	return Object.fromEntries(tree);
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
): Promise<PackedRelease> {
	const repository = widget(world.github);
	world.npm.publish('widget', '1.0.0');
	const configuration = z.looseObject({
		streams: z.looseObject({
			main: z.looseObject({
				prepare: z.looseObject({}),
				promote: z.looseObject({ workflow: z.looseObject({}) }),
			}),
		}),
	}).parse(JSON.parse(widgetConfiguration()));
	configuration.streams.main.prepare = { workflow: { file: 'prepare.yml' } };
	configuration.streams.main.promote.workflow.refs = {
		phase: 'version',
		prefix: 'v',
		aliases: [],
		signed: signing !== undefined && signing.signer === undefined,
	};
	if (signing?.signer) world.env.SIGNER = signing.signer;
	const pushed = world.github.push(repository, {
		'.github/beepboop.json': `${JSON.stringify(configuration, null, '\t')}\n`,
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
		const request = { repositoryId: repository.id, stream: 'main', version: '1.1.0' };
		const plan = await api('/api/releases/plan', request);
		const prepared = await api('/api/releases/prepare', {
			...request,
			sourceSha: text(plan.body, 'sourceSha'),
			planId: text(plan.body, 'planId'),
		});
		if (prepared.status !== 200) throw new Error(`Prepare failed ${prepared.status}`);
		await world.wait(20_000);
		const prepareRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/prepare.yml'),
			'prepare run',
		);
		prepareRun.status = 'in_progress';
		const prepareIdentity = {
			repository,
			runId: prepareRun.id,
			sha: prepareRun.headSha,
			file: 'prepare.yml',
			actorId: botId,
		};
		const begun = await runAction(world, 'begin', prepareIdentity, {
			EXECUTION_ID: text(prepared.body, 'id'),
			STREAM: 'main',
			OPERATION: 'prepare',
		});
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
		await world.webhook('workflow_run', {
			action: 'completed',
			workflow_run: {
				id: prepareRun.id,
				conclusion: 'success',
				event: 'workflow_dispatch',
				path: prepareRun.path,
				head_repository: { id: repository.id },
			},
			repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
		});
		await world.wait(1_000);
		const pull = one(repository.pulls, 'preparation pull request');
		const released = commitAll(checkout.dir, 'Release 1.1.0');
		const merged = world.github.merge(repository, pull.number);
		world.github.relabel(repository, merged.sha, released);
		passChecks(repository, released);
		if ((await world.push(repository)).status !== 202) throw new Error('Push was refused');
		await world.wait(1_000);
		const listed = await api('/api/executions');
		if (!Array.isArray(listed.body)) throw new Error('Expected an execution list');
		const promotion = one(
			listed.body.filter(entry => text(entry, 'operation') === 'promote'),
			'promotion',
		);
		const promotionId = text(promotion, 'id');
		if (text(promotion, 'sourceSha') !== released) throw new Error('Promotion source is not the packed checkout');
		const approved = await api('/api/executions/approve', { id: promotionId, sourceSha: released });
		if (text(approved.body, 'state') !== 'ready') throw new Error('Promotion stayed blocked');
		await world.wait(16_000);
		const promoteRun = one(
			repository.runs.filter(run => run.path === '.github/workflows/publish.yml'),
			'promote run',
		);
		promoteRun.status = 'in_progress';
		const promoteIdentity = {
			repository,
			runId: promoteRun.id,
			sha: promoteRun.headSha,
			file: 'publish.yml',
			actorId: botId,
		};
		await runAction(world, 'begin', promoteIdentity, {
			EXECUTION_ID: promotionId,
			STREAM: 'main',
			OPERATION: 'promote',
		});
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
		world.npm.publish('widget', '1.1.0');
		await runAction(world, 'report', promoteIdentity, {
			EXECUTION_ID: promotionId,
			PUBLICATIONS: JSON.stringify([
				{ id: 'pkg:npm/widget', manager: 'npm', name: 'widget', version: '1.1.0', outcome: 'succeeded' },
			]),
		});
		promoteRun.status = 'completed';
		promoteRun.conclusion = 'success';
		await world.webhook('workflow_run', {
			action: 'completed',
			workflow_run: {
				id: promoteRun.id,
				conclusion: 'success',
				event: 'workflow_dispatch',
				path: promoteRun.path,
				head_repository: { id: repository.id },
			},
			repository: { id: repository.id, full_name: repository.name, owner: { id: ownerId } },
		});
		await world.wait(2_000);
		return { repository, promotionId, plan: planBody, tags };
	} finally {
		rmSync(checkout.dir, { recursive: true, force: true });
		rmSync(scratch, { recursive: true, force: true });
	}
}
