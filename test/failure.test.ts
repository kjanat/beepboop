import { afterEach, expect, spyOn, test } from 'bun:test';
import { failure } from '#failure';

const logged = spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => logged.mockClear());

test('a failed request is logged with its method, path and error', async () => {
	const response = failure(
		new Request('https://beepboop.example/api/workflow/token?x=1', { method: 'POST' }),
		new TypeError('Illegal invocation'),
	);
	expect(response.status).toBe(400);
	expect(response.headers.get('Cache-Control')).toBe('no-store');
	expect(await response.json()).toEqual({ error: 'Illegal invocation' });
	expect(logged.mock.calls).toEqual([[
		'{"event":"request.failed","method":"POST","path":"/api/workflow/token","error":"Illegal invocation"}',
	]]);
});

test('the log keeps the reason the response withholds', async () => {
	const request = new Request('https://beepboop.example/api/x');
	expect(await failure(request, new Error('Bad token signature')).json()).toEqual({
		error: 'Request denied or unavailable',
	});
	expect(await failure(request, new SyntaxError('Unexpected end')).json()).toEqual({
		error: 'Invalid JSON in request or configuration',
	});
	expect(await failure(request, 'thrown string').json()).toEqual({ error: 'Request denied or unavailable' });
	expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)).error)).toEqual([
		'Bad token signature',
		'Unexpected end',
		'thrown string',
	]);
});
