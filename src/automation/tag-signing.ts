import { Clock, Context, Effect, Layer, Option } from 'effect';
import { Automation } from '@/automation/service.ts';
import type { RefChange, RefPlan } from '@/domain/refs.ts';
import { tagObject, tagPayload } from '@/domain/refs.ts';
import type { Signer } from '@/github/signing.ts';
import { TagSigner } from '@/github/signing.ts';
import type { DomainError } from '@/kernel/errors/domain-error.ts';
import { precondition } from '@/kernel/errors/domain-error.ts';

const signingKey = Effect.fnUntraced(function*(signer: Signer) {
	const identity = yield* signer.identity;
	const user = /^([^<>\n]+) <([^<>\s]+)>$/.exec(identity.userId);
	if (!user?.[1] || !user[2]) return yield* precondition('The signing key needs a user ID with a name and email');
	const seconds = Math.floor((yield* Clock.currentTimeMillis) / 1000);
	return {
		publicKey: identity.publicKey,
		name: user[1],
		email: user[2],
		seconds,
		tagger: `${identity.userId} ${seconds} +0000`,
	};
});

export class TagSigning extends Context.Service<TagSigning, {
	readonly sign: (plan: RefPlan) => Effect.Effect<RefPlan, DomainError>;
	readonly createTag: (
		repository: string,
		repositoryId: number,
		tag: { readonly name: string; readonly commit: string },
	) => Effect.Effect<void, DomainError>;
}>()('beepboop/automation/TagSigning') {
	static readonly layer = Layer.effect(
		TagSigning,
		Effect.gen(function*() {
			const { gateway } = yield* Automation;
			const signers = yield* TagSigner;
			return TagSigning.of({
				sign: Effect.fnUntraced(function*(plan: RefPlan) {
					const signer = yield* signers.current;
					if (Option.isNone(signer) || !plan.changes.some(change => change.annotated)) return plan;
					const key = yield* signingKey(signer.value);
					const changes = yield* Effect.forEach(
						plan.changes,
						change =>
							change.annotated && (change.expected === null || change.replaces)
								? signer.value.sign(
									tagPayload(change, `Release ${plan.version}`, key.tagger),
									`beepboop:${plan.repository}`,
								)
									.pipe(Effect.map(signature => ({
										...change,
										signed: true,
										object: tagObject(change, plan.version, key.tagger, signature),
									})))
								: Effect.succeed(change),
					);
					return { ...plan, changes, publicKey: key.publicKey };
				}),
				createTag: Effect.fnUntraced(function*(repository: string, repositoryId: number, tag) {
					const signer = yield* signers.current;
					if (Option.isNone(signer)) return yield* precondition('Package tags need the tag signer');
					const key = yield* signingKey(signer.value);
					const change: RefChange = {
						name: tag.name,
						expected: null,
						commit: tag.commit,
						annotated: true,
						signed: true,
					};
					const signature = yield* signer.value.sign(
						tagPayload(change, tag.name, key.tagger),
						`beepboop:${repository}`,
					);
					yield* gateway.createTag(repository, repositoryId, {
						name: tag.name,
						commit: tag.commit,
						message: `${tag.name}\n${signature.endsWith('\n') ? signature : `${signature}\n`}`,
						tagger: {
							name: key.name,
							email: key.email,
							date: new Date(key.seconds * 1000).toISOString().replace('.000Z', 'Z'),
						},
						signed: true,
					});
				}),
			});
		}),
	);
}
