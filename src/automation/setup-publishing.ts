import { Effect, Result } from 'effect';
import { cargoManager } from '@/automation/managers/cargo';
import { object, yaml } from '@/automation/managers/helpers';
import type { Fetcher, VerificationContext } from '@/automation/managers/registry';
import { registryRequest } from '@/automation/managers/verification';
import { packageId } from '@/automation/package-identity';
import { disabled, expandStep } from '@/automation/release-graph/bindings';
import { localAction } from '@/automation/release-graph/calls';
import { cargoJobPackages } from '@/automation/release-graph/graph';
import { publishingJobs } from '@/automation/setup-publishing-jobs';
import type { PublishingCheck, SetupChoices } from '@/automation/setup-types';
import type { Inventory, Snapshot } from '@/automation/types';
import type { DomainError } from '@/contract/errors';
import { precondition } from '@/contract/errors';
import { responseJson } from '@/runtime/http';
import { ioConcurrency } from '@/runtime/policy';

export interface PublishingAccess {
	request: Fetcher;
	github: VerificationContext['github'];
	cargoToken(file: string, secrets: string[]): Effect.Effect<string | undefined, DomainError>;
}

function references(source: unknown, context: 'secrets' | 'vars'): string[] {
	const text = JSON.stringify(source) ?? '';
	return [
		...new Set(
			[...text.matchAll(new RegExp(`\\b${context}(?:\\.([A-Za-z_][\\w]*)|\\[['"]([A-Za-z_][\\w]*)['"]\\])`, 'g'))].map(
				match => match[1] ?? match[2] ?? '',
			),
		),
	];
}

function usedActions(snapshot: Snapshot, steps: unknown, seen = new Set<string>()): string[] {
	if (!Array.isArray(steps)) return [];
	return steps.flatMap(entry => expandStep(object(entry), {}, {})).flatMap(step => {
		if (disabled(step.if) || typeof step.uses !== 'string') return [];
		const local = localAction(step.uses);
		if (!local || seen.has(local)) return [step.uses];
		const source = snapshot.files[`${local}/action.yml`] ?? snapshot.files[`${local}/action.yaml`];
		const parsed = source === undefined ? undefined : yaml(source);
		return [
			step.uses,
			...(parsed && Result.isSuccess(parsed)
				? usedActions(snapshot, object(parsed.success.runs).steps, new Set([...seen, local]))
				: []),
		];
	});
}

export function checkPublishing(
	snapshot: Snapshot,
	inventory: Inventory,
	choices: SetupChoices,
	access: PublishingAccess,
): Effect.Effect<PublishingCheck[]> {
	return Effect.gen(function*() {
		const checks: PublishingCheck[] = [];
		const packages = new Map(
			inventory.packages.filter(pkg => pkg.manager === 'cargo').map(pkg => [packageId(pkg), pkg]),
		);
		const files = new Map<string, Set<string>>();
		for (const stream of choices.streams) {
			for (const entry of stream.observe ?? []) {
				const ids = entry.publications.filter(id => packages.has(id));
				if (ids.length) files.set(entry.file, new Set([...(files.get(entry.file) ?? []), ...ids]));
			}
		}
		if (!files.size) return checks;
		const root = `/repos/${snapshot.repository.name}`;
		const cache = new Map<string, Effect.Effect<unknown, DomainError>>();
		const github = (path: string) => Effect.gen(function*() {
			let found = cache.get(path);
			if (!found) {
				found = yield* Effect.cached(access.github(path));
				cache.set(path, found);
			}
			return yield* found;
		});
		const named = (kind: 'secrets' | 'variables', name: string, environment?: string) => Effect.gen(function*() {
			const paths = [
				...(environment ? [`${root}/environments/${encodeURIComponent(environment)}/${kind}/${name}`] : []),
				`${root}/actions/${kind}/${name}`,
			];
			for (const path of paths) {
				const item = yield* github(path);
				if (item !== null) return object(item);
			}
			for (let page = 1; page <= 100; page++) {
				const body = yield* github(`${root}/actions/organization-${kind}?per_page=100&page=${page}`);
				if (body === null) return undefined;
				const items = object(body)[kind];
				if (!Array.isArray(items)) return yield* precondition(`Invalid GitHub ${kind} response`);
				const found = items.map(object).find(item => item.name === name);
				if (found) return found;
				if (items.length < 100) return undefined;
			}
			return yield* precondition(`GitHub ${kind} pagination limit exceeded`);
		});
		const versions = new Map(
			yield* Effect.forEach([...new Set([...files.values()].flatMap(ids => [...ids]))], id =>
				Effect.gen(function*() {
					const pkg = packages.get(id);
					if (!pkg) return [id, undefined] as const;
					return [id, yield* cargoManager.latest(pkg, access.request)] as const;
				}), { concurrency: ioConcurrency }),
		);
		for (const [file, ids] of files) {
			const add = (subject: string, status: PublishingCheck['status'], message: string) =>
				checks.push({ file, subject, status, message });

			for (const id of ids) {
				const pkg = packages.get(id), version = versions.get(id);
				if (!pkg || !version) continue;
				if (version.kind === 'published') {
					add(pkg.name, 'passed', `crates.io contains ${pkg.name} (latest ${version.version}).`);
				} else if (version.kind === 'missing') {
					add(
						pkg.name,
						'action-required',
						`crates.io returned 404 for ${pkg.name}. Publish its first version with a crates.io API token before using Trusted Publishing, then configure its trusted publisher.`,
					);
				} else {
					add(
						pkg.name,
						'failed',
						`crates.io lookup failed for ${pkg.name}: ${version.reason} (${version.url}). Retry adoption after resolving the lookup failure.`,
					);
				}
			}
			const publishers = publishingJobs(snapshot, file);
			for (const failure of publishers.failures) add(file, 'failed', failure);
			for (const publisher of publishers.jobs) {
				const { job, raw, document } = publisher;
				const selected = cargoJobPackages(snapshot, inventory, publisher.file, job).filter(id => ids.has(id));
				if (!selected.length) continue;
				const subject = publisher.path;
				const configured = { env: document?.env, job: raw };
				const secretNames = references(configured, 'secrets').filter(name => name.toUpperCase() !== 'GITHUB_TOKEN');
				const declaredEnvironment = typeof raw.environment === 'string'
					? raw.environment
					: object(raw.environment).name;
				let environment = typeof declaredEnvironment === 'string' ? declaredEnvironment : undefined;
				const checked = yield* Effect.result(Effect.gen(function*() {
					if (typeof environment === 'string') {
						for (const name of references(environment, 'vars')) {
							const variable = yield* named('variables', name);
							if (typeof variable?.value !== 'string') {
								return yield* precondition(`Environment variable vars.${name} is missing`);
							}
							environment = (environment ?? '').replace(
								new RegExp(`\\$\\{\\{\\s*vars\\.${name}\\s*\\}\\}`, 'g'),
								variable.value,
							);
						}
						if (environment?.includes('${{')) {
							return yield* precondition(
								'The publishing environment uses an expression that cannot be resolved during adoption',
							);
						}
						if ((yield* github(`${root}/environments/${encodeURIComponent(environment ?? '')}`)) === null) {
							return yield* precondition(`Publishing environment ${environment} does not exist`);
						}
					}
					for (const name of references(configured, 'vars')) {
						const variable = yield* named('variables', name, typeof environment === 'string' ? environment : undefined);
						add(
							subject,
							variable ? 'passed' : 'action-required',
							variable
								? `GitHub Actions variable ${name} is available.`
								: `GitHub Actions variable ${name} is missing; configure it before publishing.`,
						);
					}
					for (const name of secretNames) {
						const source = publisher.secret(name);
						const local = source && environment
							? yield* github(`${root}/environments/${encodeURIComponent(environment)}/secrets/${name.toUpperCase()}`)
							: null;
						const secret = local ?? (source ? yield* named('secrets', source) : undefined);
						add(
							subject,
							secret ? 'passed' : 'action-required',
							secret
								? `GitHub Actions secret ${name} is available.`
								: `GitHub Actions secret ${name} is missing; configure it before publishing.`,
						);
					}
					const oidc = usedActions(snapshot, raw.steps).some(action =>
						/^rust-lang\/crates-io-auth-action@/.test(action)
					);
					if (!oidc) return;
					const allowed = publisher.oidc;
					add(
						subject,
						allowed ? 'passed' : 'action-required',
						allowed
							? 'The crates.io authentication action has id-token: write.'
							: 'The crates.io authentication action needs id-token: write on this job.',
					);
					const steps = Array.isArray(raw.steps) ? raw.steps.map(object) : [];
					const tokenSources = [document?.env, raw.env, ...steps.map(step => step.env)].flatMap(env =>
						Object.entries(object(env)).filter(([key]) => /^CARGO_REGISTR(?:Y_TOKEN|IES_CRATES_IO_TOKEN)$/.test(key))
							.map(([, value]) => value)
					);
					const published = selected.filter(id => versions.get(id)?.kind === 'published');
					if (!published.length) return;
					const token = yield* access.cargoToken(
						file,
						references(tokenSources, 'secrets').flatMap(name => publisher.secret(name) ?? []),
					);
					for (const id of published) {
						const pkg = packages.get(id);
						if (!pkg) continue;
						const result = yield* publisherConfiguration(
							access.request,
							pkg.name,
							snapshot.repository.name,
							file,
							typeof environment === 'string' ? environment : undefined,
							token,
						);
						add(`${subject} / ${pkg.name}`, result.status, result.message);
					}
				}));
				if (Result.isFailure(checked)) {
					add(
						subject,
						'failed',
						checked.failure.message.startsWith('GitHub App installation lacks')
							? checked.failure.message
							: `Publishing configuration check failed: ${checked.failure.message}.`,
					);
				}
			}
		}
		return checks;
	});
}

function publisherConfiguration(
	request: Fetcher,
	crate: string,
	repository: string,
	file: string,
	environment: string | undefined,
	token: string | undefined,
): Effect.Effect<Pick<PublishingCheck, 'status' | 'message'>> {
	return Effect.gen(function*() {
		const [owner, name] = repository.split('/');
		let url = `https://crates.io/api/v1/trusted_publishing/github_configs?crate=${
			encodeURIComponent(crate)
		}&per_page=100`;
		for (let page = 0; page < 100; page++) {
			const response = yield* registryRequest(
				request,
				url,
				token ? { headers: { Authorization: `Bearer ${token}` } } : {},
			);
			if (!response.ok) {
				return {
					status: 'failed' as const,
					message: `crates.io trusted-publisher lookup for ${crate} returned HTTP ${response.status}. ${
						response.status === 401 || response.status === 403
							? 'Provide a Beepboop crates-io credential with crate-owner access and the trusted-publishing scope.'
							: 'Retry after resolving the registry error.'
					}`,
				};
			}
			const body = object(yield* responseJson(response));
			if (!Array.isArray(body.github_configs)) {
				return {
					status: 'failed' as const,
					message: `crates.io returned an invalid trusted-publisher response for ${crate}.`,
				};
			}
			const matches = body.github_configs.map(object).some(config =>
				config.crate === crate && String(config.repository_owner).toLowerCase() === owner?.toLowerCase()
				&& String(config.repository_name).toLowerCase() === name?.toLowerCase() && config.workflow_filename === file
				&& (config.environment === null || config.environment === environment)
			);
			if (matches) {
				return {
					status: 'passed' as const,
					message: `crates.io has a trusted publisher for ${crate} matching ${repository}, ${file}${
						environment ? ` and environment ${environment}` : ''
					}.`,
				};
			}
			const next = object(body.meta).next_page;
			if (next === null || next === undefined) {
				return {
					status: 'action-required' as const,
					message: `Configure a crates.io trusted publisher for ${crate} matching ${repository}, ${file}${
						environment ? ` and environment ${environment}` : ''
					}. No matching publisher was found.`,
				};
			}
			if (typeof next !== 'string') break;
			const target = new URL(next, url);
			if (
				target.origin !== 'https://crates.io' || target.pathname !== '/api/v1/trusted_publishing/github_configs'
				|| target.searchParams.get('crate') !== crate || target.href === url
			) break;
			url = target.href;
		}
		return { status: 'failed' as const, message: `crates.io trusted-publisher pagination failed for ${crate}.` };
	}).pipe(
		Effect.orElseSucceed(() => ({
			status: 'failed' as const,
			message:
				`crates.io trusted-publisher request failed for ${crate}. Retry adoption after resolving the registry error.`,
		})),
	);
}
