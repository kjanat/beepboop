import { cargoManager } from '@/automation/managers/cargo';
import { goManager } from '@/automation/managers/go';
import { goreleaserManager } from '@/automation/managers/goreleaser';
import { jsrManager } from '@/automation/managers/jsr';
import { npmManager } from '@/automation/managers/npm';
import { pypiManager } from '@/automation/managers/pypi';
import type { Adapter } from '@/automation/managers/registry';
import { ManagerRegistry } from '@/automation/managers/registry';
import { vscodeManager } from '@/automation/managers/vscode';
import { verifyImage } from '@/automation/oci';
import { discoverers } from '@/discovery/managers/builtins.ts';
import type { ManagerName } from '@/domain/catalog.ts';

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
