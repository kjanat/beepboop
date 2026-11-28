import { Predicate, Result } from 'effect';
import { readableConfiguration } from '@/domain/configuration/names.ts';
import type { Package } from '@/domain/inventory.ts';
import { packageId, soleMatch } from '@/domain/package-identity.ts';
import { configurableStarts } from '@/domain/release-start.ts';

type Rewrite = (reference: string) => string;

function purlOf(packages: readonly Package[]): Rewrite {
	return reference => {
		if (reference.startsWith('pkg:')) return reference;
		const found = soleMatch(reference, packages);
		if (!found || found.manager === 'github-release') return reference;
		return Result.getOrElse(Result.try(() => packageId(found)), () => reference);
	};
}

function references(value: unknown, rewrite: Rewrite): unknown {
	return Array.isArray(value) ? value.map(entry => typeof entry === 'string' ? rewrite(entry) : entry) : value;
}

function binding(value: unknown, rewrite: Rewrite): unknown {
	return Predicate.isObject(value) && 'publications' in value
		? { ...value, publications: references(value.publications, rewrite) }
		: value;
}

function role(value: unknown, rewrite: Rewrite): unknown {
	return Predicate.isObject(value) && 'workflow' in value
		? { ...value, workflow: binding(value.workflow, rewrite) }
		: value;
}

function starts(value: unknown): unknown {
	return Array.isArray(value)
		? value.filter(entry => !Predicate.isObject(entry) || configurableStarts.some(via => via === entry.via))
		: value;
}

function field(key: string, value: unknown, rewrite: Rewrite): unknown {
	switch (key) {
		case 'packages':
		case 'companionModules':
		case 'packageTags':
		case 'mustPublish':
			return references(value, rewrite);
		case 'needs':
			return Predicate.isObject(value)
				? Object.fromEntries(Object.entries(value).map(([id, needs]) => [rewrite(id), references(needs, rewrite)]))
				: value;
		case 'prepare':
		case 'release':
			return role(value, rewrite);
		case 'workflows':
			return Predicate.isObject(value)
				? Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, binding(entry, rewrite)]))
				: value;
		case 'startFrom':
			return starts(value);
		default:
			return value;
	}
}

function stream(value: unknown, rewrite: Rewrite): unknown {
	return Predicate.isObject(value)
		? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, field(key, entry, rewrite)]))
		: value;
}

export function canonicalConfiguration(value: unknown, packages: readonly Package[]): unknown {
	const readable = readableConfiguration(value);
	if (!Predicate.isObject(readable) || !Predicate.isObject(readable.streams)) return readable;
	const rewrite = purlOf(packages);
	return {
		...readable,
		streams: Object.fromEntries(
			Object.entries(readable.streams).map(([name, entry]) => [name, stream(entry, rewrite)]),
		),
	};
}

export function outdatedConfiguration(value: unknown, packages: readonly Package[]): boolean {
	return JSON.stringify(canonicalConfiguration(value, packages)) !== JSON.stringify(value);
}
