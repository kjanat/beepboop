export interface Exchange {
	method: string;
	url: string;
	host: string;
	status: number;
	requestBytes: number;
	responseBytes: number;
	at: number;
}

export type Host = (request: Request) => Response | Promise<Response>;

export class Network {
	readonly log: Exchange[] = [];
	readonly unrouted: string[] = [];
	private readonly hosts = new Map<string, Host>();

	serve(host: string, handler: Host): void {
		this.hosts.set(host, handler);
	}
	readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		const handler = this.hosts.get(url.host);
		const requestBytes = request.body ? (await request.clone().arrayBuffer()).byteLength : 0;
		if (!handler) {
			this.unrouted.push(`${request.method} ${request.url}`);
			throw new TypeError(`Network access is disabled in tests: ${request.method} ${request.url}`);
		}
		const response = await handler(request);
		const body = await response.arrayBuffer();
		this.log.push({
			method: request.method,
			url: request.url,
			host: url.host,
			status: response.status,
			requestBytes,
			responseBytes: body.byteLength,
			at: Date.now(),
		});
		return new Response(response.status === 204 || response.status === 304 ? null : body, {
			status: response.status,
			headers: response.headers,
		});
	};
	since(mark: number): Exchange[] {
		return this.log.slice(mark);
	}
	mark(): number {
		return this.log.length;
	}
}
