export const workflowDirectory = '.github/workflows/';

export function workflowPath(file: string): string {
	return `${workflowDirectory}${file}`;
}

export function isWorkflowPath(path: string): boolean {
	return path.startsWith(workflowDirectory);
}
