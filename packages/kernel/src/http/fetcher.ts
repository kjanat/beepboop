export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export const platformFetch: Fetcher = (input, init) => fetch(input, init);
