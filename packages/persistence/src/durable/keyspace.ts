export interface Keyspace<A> {
	readonly prefix: string;
	readonly decode: (value: unknown) => A;
}

export interface Singleton<A> {
	readonly key: string;
	readonly decode: (value: unknown) => A;
}

export interface Write {
	readonly key: string;
	readonly value: unknown;
}

export const Keyspace = {
	make: <A>(prefix: string, decode: (value: unknown) => A): Keyspace<A> => ({ prefix, decode }),
	key: <A>(space: Keyspace<A>, id: string): string => `${space.prefix}${id}`,
	id: <A>(space: Keyspace<A>, key: string): string => key.slice(space.prefix.length),
	write: <A>(space: Keyspace<A>, id: string, value: A): Write => ({ key: `${space.prefix}${id}`, value }),
};

export const Singleton = {
	make: <A>(key: string, decode: (value: unknown) => A): Singleton<A> => ({ key, decode }),
	write: <A>(singleton: Singleton<A>, value: A): Write => ({ key: singleton.key, value }),
};
