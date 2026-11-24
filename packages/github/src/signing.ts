import { Context, Effect, Layer, Option } from 'effect';
import type { TagSigner as SignerBinding, SigningIdentity } from '@/domain/refs.ts';
import { fromPromise } from '@/kernel/errors/classify.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';

export interface Signer {
	readonly identity: Effect.Effect<SigningIdentity, DomainError>;
	readonly sign: (data: string, caller: string) => Effect.Effect<string, DomainError>;
}

export function bindingSigner(binding: SignerBinding): Signer {
	return {
		identity: fromPromise(() => binding.identity()),
		sign: (data, caller) => fromPromise(() => binding.sign(data, caller)),
	};
}

export class TagSigner extends Context.Service<TagSigner, {
	readonly current: Effect.Effect<Option.Option<Signer>>;
}>()('beepboopbot/github/TagSigner') {
	static layer(binding: () => SignerBinding | undefined): Layer.Layer<TagSigner> {
		return Layer.succeed(
			TagSigner,
			TagSigner.of({ current: Effect.sync(() => Option.map(Option.fromNullishOr(binding()), bindingSigner)) }),
		);
	}
}
