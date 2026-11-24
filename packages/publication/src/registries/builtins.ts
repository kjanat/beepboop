import { discoverers } from '@/discovery/managers/builtins.ts';
import type { ManagerName } from '@/domain/catalog.ts';
import { cargoManager } from '@/publication/registries/cargo.ts';
import { goManager } from '@/publication/registries/go.ts';
import { goreleaserManager } from '@/publication/registries/goreleaser.ts';
import { jsrManager } from '@/publication/registries/jsr.ts';
import { npmManager } from '@/publication/registries/npm.ts';
import { verifyImage } from '@/publication/registries/oci.ts';
import { pypiManager } from '@/publication/registries/pypi.ts';
import type { Adapter } from '@/publication/registries/registry.ts';
import { ManagerRegistry } from '@/publication/registries/registry.ts';
import { vscodeManager } from '@/publication/registries/vscode.ts';

const adapters = {
	cargo: cargoManager,
	npm: npmManager,
	vscode: vscodeManager,
	jsr: jsrManager,
	pypi: pypiManager,
	workflow: discoverers.workflow,
	'github-release': discoverers['github-release'],
	oci: { ...discoverers.oci, verifyPublication: verifyImage },
	goreleaser: goreleaserManager,
	go: goManager,
	manifest: discoverers.manifest,
	'pre-commit': discoverers['pre-commit'],
} satisfies { [M in ManagerName]: Adapter<M> };

export const managerRegistry = new ManagerRegistry(adapters);
