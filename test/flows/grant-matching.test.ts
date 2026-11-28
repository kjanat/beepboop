import { expect, test } from 'bun:test';
import type { Grant } from '@/credentials/grant.ts';
import { allowsRun, coversBinding, secretAliases } from '@/credentials/grant.ts';

const runtime: Grant = {
	_tag: 'Runtime',
	id: 'grant-1',
	alias: 'npm-token',
	repositoryId: 42,
	repository: 'octo/widget',
	operation: 'release',
	workflow: 'release.yml',
	ref: 'refs/tags/v*',
	environment: 'release',
};
const secret: Grant = {
	_tag: 'EnvironmentSecret',
	id: 'grant-2',
	alias: 'cargo-token',
	repositoryId: 42,
	repository: 'octo/widget',
	operation: 'release',
	workflow: 'release.yml',
	ref: 'refs/tags/v*',
	environment: 'release',
	secretName: 'CARGO_TOKEN',
};
const run = {
	repository: 'octo/widget',
	ref: 'refs/tags/v1.2.0',
	workflowRef: 'octo/widget/.github/workflows/release.yml@refs/tags/v1.2.0',
	environment: 'release',
};

test('a runtime grant allows only the run of its workflow, ref, environment and operation', () => {
	expect(allowsRun(runtime, 'release', run)).toBe(true);
	expect(allowsRun(runtime, 'prepare', run)).toBe(false);
	expect(allowsRun(runtime, 'release', { ...run, repository: 'octo/gadget' })).toBe(false);
	expect(allowsRun(runtime, 'release', {
		...run,
		ref: 'refs/heads/main',
		workflowRef: 'octo/widget/.github/workflows/release.yml@refs/heads/main',
	})).toBe(false);
	expect(allowsRun(runtime, 'release', { ...run, environment: 'staging' })).toBe(false);
	expect(allowsRun(runtime, 'release', {
		repository: run.repository,
		ref: run.ref,
		workflowRef: run.workflowRef,
	})).toBe(false);
	expect(allowsRun(runtime, 'release', {
		...run,
		workflowRef: 'octo/widget/.github/workflows/other.yml@refs/tags/v1.2.0',
	})).toBe(false);
	expect(allowsRun(secret, 'release', run)).toBe(false);
	const { environment: _environment, ...unscoped } = runtime;
	expect(allowsRun(unscoped, 'release', {
		repository: run.repository,
		ref: run.ref,
		workflowRef: run.workflowRef,
	})).toBe(true);
});

test('runtime grants cover a stream when one grant matches one of its workflow bindings', () => {
	const binding = { operation: 'release', file: 'release.yml', ref: 'refs/tags/v1.0.0' };
	expect(coversBinding([runtime], [binding], 'octo/widget')).toBe(true);
	expect(coversBinding([runtime], [{ ...binding, file: 'publish.yml' }, binding], 'octo/widget')).toBe(true);
	expect(coversBinding([runtime], [{ ...binding, file: 'publish.yml' }], 'octo/widget')).toBe(false);
	expect(coversBinding([runtime], [{ ...binding, operation: 'prepare' }], 'octo/widget')).toBe(false);
	expect(coversBinding([runtime], [binding], 'octo/gadget')).toBe(false);
	expect(coversBinding([runtime], [{ ...binding, ref: 'refs/heads/main' }], 'octo/widget')).toBe(false);
	expect(coversBinding([secret], [binding], 'octo/widget')).toBe(false);
	expect(coversBinding([], [binding], 'octo/widget')).toBe(false);
});

test('secret aliases name the GitHub secret grants of a workflow whose secret it reads', () => {
	expect(secretAliases([runtime, secret], 'release.yml', ['CARGO_TOKEN'])).toEqual(['cargo-token']);
	expect(secretAliases([runtime, secret], 'release.yml', ['NPM_TOKEN'])).toEqual([]);
	expect(secretAliases([runtime, secret], 'publish.yml', ['CARGO_TOKEN'])).toEqual([]);
	const repository: Grant = {
		_tag: 'RepositorySecret',
		id: 'grant-3',
		alias: 'registry-token',
		repositoryId: 42,
		repository: 'octo/widget',
		operation: 'release',
		workflow: 'release.yml',
		ref: 'refs/tags/v*',
		secretName: 'REGISTRY_TOKEN',
	};
	expect(secretAliases([repository, runtime, secret], 'release.yml', ['CARGO_TOKEN', 'REGISTRY_TOKEN'])).toEqual([
		'registry-token',
		'cargo-token',
	]);
});
