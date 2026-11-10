import type { Document } from 'yaml';
import { isScalar, parseDocument, visit } from 'yaml';

interface Pin {
	repository: string;
	sha: string;
	version: string;
}

const pins = {
	checkout: { repository: 'actions/checkout', sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', version: 'v7.0.1' },
	setupGo: { repository: 'actions/setup-go', sha: 'b7ad1dad31e06c5925ef5d2fc7ad053ef454303e', version: 'v7.0.0' },
	upload: {
		repository: 'actions/upload-artifact',
		sha: 'cf430e030ddbb5b0abf93d22962f4752f3646cd9',
		version: 'v7.0.2',
	},
	download: {
		repository: 'actions/download-artifact',
		sha: '9000827ccba6bdab643e8b6fd33ac0654aef8333',
		version: 'v8.0.2',
	},
	attest: { repository: 'actions/attest', sha: '1e69f48acb82d1966a394da916b4c1698aa569d6', version: 'v4.2.2' },
	sbom: { repository: 'anchore/sbom-action', sha: '66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c', version: 'v0.24.3' },
	mise: { repository: 'jdx/mise-action', sha: 'f5be966e4a917d54244728e6a5fdcd1d93a35e6c', version: 'v5.2.6' },
	install: {
		repository: 'taiki-e/install-action',
		sha: '1e29709c0ec63babbe8f266397a465f29a825f91',
		version: 'v2.87.31',
	},
} as const satisfies Record<string, Pin>;

export type PinnedAction = keyof typeof pins;

export function pinned(action: PinnedAction): string {
	return `${pins[action].repository}@${pins[action].sha}`;
}

const versions = new Map<string, string>(Object.values(pins).map(pin => [`${pin.repository}@${pin.sha}`, pin.version]));

export function renderWorkflow(document: Document): string {
	return document.toString({ lineWidth: 0 });
}

export function matchEnding(rendered: string, original: string | undefined): string {
	if (original === undefined) return rendered;
	const body = rendered.replace(/\n+$/, '');
	return original.endsWith('\n') ? `${body}\n` : body;
}

export function annotatePins(source: string): string {
	const document = parseDocument(source);
	visit(document, {
		Pair(_, pair) {
			if (!isScalar(pair.key) || pair.key.value !== 'uses' || !isScalar(pair.value)) return;
			const version = typeof pair.value.value === 'string' ? versions.get(pair.value.value) : undefined;
			if (version && !pair.value.comment) pair.value.comment = ` ${version}`;
		},
	});
	return renderWorkflow(document);
}
