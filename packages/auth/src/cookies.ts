export const accessCookie = '__Host-beepboop_access';
export const refreshCookie = '__Host-beepboop_refresh';
export const flowCookie = '__Host-beepboop_flow';

export function cookie(request: Request, name: string): string | undefined {
	return request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1);
}
