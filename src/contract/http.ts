export function isJson(response: Response): boolean {
	return (response.headers.get('content-type') ?? '').split(';')[0]?.trim() === 'application/json';
}

export function bearerHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export const githubApiVersion = '2026-03-10';
