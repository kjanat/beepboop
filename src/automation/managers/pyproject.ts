import { object } from '@/automation/managers/helpers';

export function isPyproject(path: string): boolean {
	return /(?:^|\/)pyproject\.toml$/.test(path) && !path.startsWith('.github/');
}
export function privateProject(document: Record<string, unknown>): boolean {
	const project = object(document.project);
	const classifiers = Array.isArray(project.classifiers) ? project.classifiers : [];
	return object(object(document.tool).uv).package === false || classifiers.includes('Private :: Do Not Upload');
}
