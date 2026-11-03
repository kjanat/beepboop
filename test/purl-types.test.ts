import { expect, test } from 'bun:test';
import { packageIdentity } from '@/package-url';
import type { RegisteredPackageIdentity } from '@/package-url/identity.generated';

// These assertions are also checked by tsc: the declarations must encode the upstream requirements.
const npm: RegisteredPackageIdentity = { type: 'npm', name: 'tool' };
const scoped: RegisteredPackageIdentity = { type: 'npm', namespace: '@scope', name: 'tool' };
const maven: RegisteredPackageIdentity = { type: 'maven', namespace: 'org.example', name: 'tool' };
const swid: RegisteredPackageIdentity = { type: 'swid', name: 'tool', qualifiers: { tag_id: 'id' } };
// @ts-expect-error Maven requires a namespace.
const missingNamespace: RegisteredPackageIdentity = { type: 'maven', name: 'tool' };
// @ts-expect-error PyPI prohibits namespaces.
const prohibitedNamespace: RegisteredPackageIdentity = { type: 'pypi', name: 'tool', namespace: 'scope' };
// @ts-expect-error SWID requires its tag_id qualifier.
const missingQualifier: RegisteredPackageIdentity = { type: 'swid', name: 'tool', qualifiers: { extra: 'value' } };

test('generated identities distinguish required, optional and prohibited components', () => {
	for (const identity of [npm, scoped, maven, swid]) expect(packageIdentity(identity)).toEqual(identity);
	for (const identity of [missingNamespace, prohibitedNamespace, missingQualifier]) {
		expect(() => packageIdentity(identity)).toThrow();
	}
});
