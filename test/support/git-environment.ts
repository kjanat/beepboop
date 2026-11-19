const repositoryVariables: ReadonlySet<string> = new Set([
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_PREFIX',
	'GIT_NAMESPACE',
	'GIT_CEILING_DIRECTORIES',
	'GIT_DISCOVERY_ACROSS_FILESYSTEM',
	'GIT_QUARANTINE_PATH',
	'GIT_CONFIG',
	'GIT_CONFIG_GLOBAL',
	'GIT_CONFIG_SYSTEM',
	'GIT_CONFIG_NOSYSTEM',
	'GIT_CONFIG_COUNT',
	'GIT_CONFIG_PARAMETERS',
]);

function locatesRepository(name: string): boolean {
	return repositoryVariables.has(name) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(name);
}

export function repositoryVariablesIn(environment: Readonly<Record<string, string | undefined>>): string[] {
	return Object.keys(environment).filter(name => environment[name] !== undefined && locatesRepository(name));
}

export function withoutRepository(environment: Readonly<Record<string, string | undefined>>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(environment).flatMap(([name, value]) =>
			value === undefined || locatesRepository(name) ? [] : [[name, value]]
		),
	);
}
