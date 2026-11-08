import { z } from 'zod';

export function safeVersionPath(path: string): boolean {
	return path.length > 0 && !path.startsWith('/') && !path.includes('\\')
		&& !path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')
		&& !/^[A-Za-z]:/.test(path);
}
const common = {
	path: z.string().refine(safeVersionPath, 'Expected a repository-relative path'),
	group: z.string().min(1).optional(),
	template: z.string().max(1000).default('{version}'),
};
export const versionFileSchema = z.discriminatedUnion('format', [
	z.strictObject({
		...common,
		format: z.literal('json'),
		key: z.array(z.union([z.string().min(1), z.number().int().nonnegative()])).min(1),
	}),
	z.strictObject({
		...common,
		format: z.literal('yaml'),
		key: z.array(z.union([z.string().min(1), z.number().int().nonnegative()])).min(1),
	}),
	z.strictObject({ ...common, format: z.literal('toml'), key: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).min(1) }),
	z.strictObject({ ...common, format: z.literal('text'), prefix: z.string().min(1), suffix: z.string().min(1) }),
]);
export type VersionFile = z.infer<typeof versionFileSchema>;
