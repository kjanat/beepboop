export function failure(request: Request, error: unknown): Response {
	console.error(JSON.stringify({
		event: 'request.failed',
		method: request.method,
		path: new URL(request.url).pathname,
		error: error instanceof Error ? error.message : String(error),
	}));
	return Response.json(
		{
			error: error instanceof SyntaxError
				? 'Invalid JSON in request or configuration'
				: error instanceof Error && !/token|secret|credential/i.test(error.message)
				? error.message
				: 'Request denied or unavailable',
		},
		{ status: 400, headers: { 'Cache-Control': 'no-store' } },
	);
}
