#!/usr/bin/env bun
import { cli } from '@kjanat/dreamcli';
import { adopt } from '@/cli/commands/adopt/index';
import { auth } from '@/cli/commands/auth';
import { notifications } from '@/cli/commands/notifications';
import { releaseCommand } from '@/cli/commands/release/index';
import { releases } from '@/cli/commands/releases';
import { repositories } from '@/cli/commands/repositories';
import { runs } from '@/cli/commands/runs';
import { secrets } from '@/cli/commands/secrets';
import { tags } from '@/cli/commands/tags';

export const app = cli('beepboop')
	.manifest({ from: import.meta.url })
	.links()
	.command(auth).command(adopt).command(repositories).command(releaseCommand).command(releases).command(runs).command(
		tags,
	)
	.command(secrets).command(notifications).completions();
if (import.meta.main) await app.run();
