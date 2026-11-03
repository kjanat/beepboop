/** Readable scoped package label. Keep canonical PURLs as form values and API identities. */
export function packageLabel(value: string): string {
	return value.replace(/^(pkg:[a-z0-9.+-]+\/)%40/i, '$1@');
}
