export interface NpmPackage {
	latest?: string;
	versions: Map<string, string>;
	tags: Record<string, string>;
}

export function npmIntegrity(name: string, version: string): string {
	return `sha512-${Buffer.from(`${name}@${version}`).toString('base64')}`;
}

export class FakeNpm {
	readonly packages = new Map<string, NpmPackage>();
	publish(name: string, version: string, tag = 'latest'): string {
		const entry: NpmPackage = this.packages.get(name) ?? { versions: new Map(), tags: {} };
		const integrity = npmIntegrity(name, version);
		entry.versions.set(version, integrity);
		entry.tags[tag] = version;
		if (tag === 'latest') entry.latest = version;
		this.packages.set(name, entry);
		return integrity;
	}
	handle(request: Request): Response {
		const path = decodeURIComponent(new URL(request.url).pathname);
		const tags = /^\/-\/package\/(.+)\/dist-tags$/.exec(path);
		if (tags) {
			const entry = this.packages.get(tags[1] ?? '');
			return entry ? Response.json(entry.tags) : Response.json({ error: 'Not found' }, { status: 404 });
		}
		const match = /^\/((?:@[^/]+\/)?[^/@]+)(?:\/([^/]+))?$/.exec(path);
		const entry = match ? this.packages.get(match[1] ?? '') : undefined;
		if (!match || !entry) return Response.json({ error: 'Not found' }, { status: 404 });
		const version = match[2];
		if (version === undefined) {
			return Response.json({
				name: match[1],
				'dist-tags': entry.tags,
				versions: Object.fromEntries([...entry.versions.keys()].map(key => [key, { version: key }])),
			});
		}
		const integrity = entry.versions.get(version);
		if (!integrity) return Response.json({ error: 'Not found' }, { status: 404 });
		return Response.json({ name: match[1], version, dist: { integrity } });
	}
}

export function crateResponse(
	request: Request,
	checksum: (name: string, version: string) => string | Response | undefined,
): Response {
	const [, , , , name, version] = new URL(request.url).pathname.split('/');
	if (!name) return new Response(null, { status: 404 });
	if (!version) return Response.json({ crate: { max_version: '1.0.0' } });
	const found = checksum(name, version);
	if (found instanceof Response) return found;
	return found
		? Response.json({ version: { crate: name, num: version, yanked: false, checksum: found } })
		: new Response(null, { status: 404 });
}

export interface PypiFile {
	packagetype: string;
	yanked: boolean;
	digests: { sha256: string };
}

export interface PypiProject {
	latest: string | undefined;
	files(version: string): PypiFile[] | undefined;
}

export function pypiResponse(
	request: Request,
	project: (name: string | undefined) => PypiProject | undefined,
): Response {
	const [, , name, version] = new URL(request.url).pathname.split('/');
	const found = project(name);
	if (!found) return new Response(null, { status: 404 });
	if (version === 'json') return Response.json({ info: { name, version: found.latest } });
	const urls = found.files(version ?? '');
	return urls ? Response.json({ info: { name, version, yanked: false }, urls }) : new Response(null, { status: 404 });
}
