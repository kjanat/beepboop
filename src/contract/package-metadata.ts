export const readmeFile = /^readme(?:\.[^/]*)?$/i;

export function filled(value: unknown): boolean {
	return typeof value === 'string' && value.trim() !== '';
}

export function lacking(fields: Record<string, boolean>): string[] {
	return Object.entries(fields).flatMap(([field, present]) => present ? [] : [field]);
}
