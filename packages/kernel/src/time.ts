export function formatTime(value: number): string {
	return `${new Date(value).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function machineTime(value: number): string {
	return new Date(value).toISOString();
}
