import { z } from 'zod';

const token = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/);
const packageName = z.string().regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
const scope = z.string().regex(/^@[a-z0-9][a-z0-9._-]*$/);
const selection = z.union([token, z.array(token).min(1)]);
const versionSource = z.string().regex(
	/^(?:tags:[^\s]*|(?!(?:.*\/)?\.\.?\/)(?:[\w.-]+\/)*(?:Cargo\.toml#(?:workspace\.)?package\.version|package\.json#version))$/,
);

/** Shared fields are validated; repository-specific build metadata is preserved. */
export const targetFields = z.looseObject({
	pkg: token.optional(),
	os: selection.optional(),
	cpu: selection.optional(),
	libc: selection.optional(),
	rust: token.optional(),
	rust_target: token.optional(),
	target: token.optional(),
	runner: z.string().min(1).optional(),
	build: token.optional(),
	asset: z.string().min(1).optional(),
	zipFileName: z.string().min(1).optional(),
	format: token.optional(),
	tier: z.number().int().positive().optional(),
	experimental: z.boolean().optional(),
});
const npmTarget = targetFields.extend({ pkg: token });
const facade = z.looseObject({ name: packageName, pkg: token.optional(), shim: packageName.optional() });
const common = {
	$schema: z.string().optional(),
	versionSource: versionSource.optional(),
	binaries: z.array(token).min(1).optional(),
	bundle: z.looseObject({ name: packageName }).optional(),
	targets: z.array(npmTarget).min(1),
};
export const npmTargetDescriptor = z.union([
	z.looseObject({
		...common,
		platformScope: z.never().optional(),
		scope,
		facade: packageName,
		facades: z.never().optional(),
	}),
	z.looseObject({
		...common,
		platformScope: z.never().optional(),
		scope,
		facades: z.array(facade).min(1),
		facade: z.never().optional(),
	}),
	z.looseObject({
		...common,
		scope: z.never().optional(),
		facades: z.never().optional(),
		platformScope: scope,
		binary: token,
		facade: packageName,
	}),
]);
const platformEntry = targetFields.extend({ os: selection, cpu: selection });
export const platformMap = z.object({ $schema: z.string().optional() }).catchall(platformEntry);
const buildTarget = z.union([
	targetFields.extend({ target: token, runner: z.string().min(1), build: token }),
	targetFields.extend({ rust: token, runner: z.string().min(1), build: token }),
]);
/** The public schema and runtime reader share this contract. */
export const targetsSchema = z.union([
	npmTargetDescriptor,
	z.array(buildTarget).min(1),
	platformMap,
]);
export type NpmTargetDescriptor = z.infer<typeof npmTargetDescriptor>;
