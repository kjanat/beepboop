import { z } from 'zod';
import { versionFileSchema } from '@/automation/editors';
import { inputSchema, outputSchema, platformSchema } from '@/automation/outputs';
import { managerNames } from '@/contract/catalog';
import type { Configuration } from '@/domain/configuration';

const managerName = z.enum(managerNames);
const strings = z.array(z.string());

const refPolicy = z.object({
	phase: z.enum(['version', 'aliases']),
	prefix: z.string(),
	aliases: z.array(z.enum(['major', 'minor'])),
	signed: z.boolean(),
});
const binding = {
	outputs: z.array(outputSchema).optional(),
	artifactInputs: z.array(inputSchema).optional(),
	platform: platformSchema.optional(),
	refs: refPolicy.optional(),
	mode: z.enum(['observe', 'dispatch']).optional(),
	each: z.literal('package').optional(),
	needs: strings.optional(),
	publications: strings.optional(),
	schedule: z.string().optional(),
	file: z.string(),
	ref: z.string().optional(),
	inputs: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).default({}),
	required: z.boolean().default(true),
};
const workflowBinding = z.object(binding);
const stream = z.object({
	versionFiles: z.array(versionFileSchema).optional(),
	versionSource: z.object({ kind: z.literal('tags'), prefix: z.string() }).optional(),
	packages: strings.optional(),
	versioning: z.enum(['workspace', 'independent', 'none']),
	concurrency: z.enum(['queue', 'supersede-pending']),
	prepare: z.object({
		strategy: z.enum(['managed', 'workflow']).optional(),
		version: z.literal('manual'),
		workflow: workflowBinding.optional(),
	}),
	promote: z.object({ approval: z.enum(['required', 'merge', 'push']), workflow: workflowBinding.optional() }),
	workflows: z.record(z.string(), workflowBinding),
	required: strings,
	credentials: strings,
	channels: z.object({ stable: z.string(), prerelease: z.string() }),
});
const subscription = z.object({
	id: z.string(),
	sourceStream: z.string().optional(),
	sourceGroup: z.string().optional(),
	publication: z.string().optional(),
	source: z.string(),
	event: z.enum(['release', 'package.version.changed', 'workflow_run']),
	stream: z.string(),
	operation: z.string(),
	workflow: z.string().optional(),
});
const winget = z.object({
	config: z.string(),
	tagPrefix: z.string(),
	automatic: z.boolean(),
});
const configurationV1 = z.object({
	winget: winget.optional(),
	extends: strings,
	managers: z.array(managerName),
	streams: z.record(z.string(), stream),
	subscriptions: z.array(subscription),
});

export const storedConfiguration: z.ZodType<Configuration> = configurationV1;
export const storedBinding = workflowBinding;

export function encodeConfigurationV1(configuration: Configuration): z.output<typeof configurationV1> {
	return configurationV1.parse(configuration);
}
