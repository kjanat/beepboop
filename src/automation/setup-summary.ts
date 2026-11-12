import type { SetupChoices, SetupPlan } from '@/automation/setup-types';
import { registryLabel } from '@/contract/catalog';
import { publicationStages } from '@/domain/publication-stages';

type Stream = SetupChoices['streams'][number];

const registries: Record<string, string> = {
	cargo: registryLabel('cargo'),
	npm: registryLabel('npm'),
	jsr: registryLabel('jsr'),
	pypi: registryLabel('pypi'),
	go: 'the Go module proxy',
	vscode: 'the Visual Studio Marketplace',
	oci: 'the container registry',
	'github-release': 'GitHub releases',
};

export function listed(items: readonly string[]): string {
	const head = items.slice(0, -1), last = items.at(-1) ?? '';
	return head.length ? `${head.join(', ')} and ${last}` : last;
}

function sentence(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

export function streamSummary(
	stream: Stream,
	plan: Pick<SetupPlan, 'inventory' | 'packageIds' | 'workflows'>,
): string[] {
	const packages = new Map(plan.inventory.packages.map((pkg, index) => [plan.packageIds[index] ?? '', pkg]));
	const existing = new Set(plan.workflows.map(workflow => workflow.file));
	const named = (file: string) => existing.has(file) ? file : `${file} (new)`;
	const publishes = (ids: readonly string[]) => {
		const groups = new Map<string, string[]>();
		const release = ids.some(id => /^(?:pkg:github\/|github-release:)/.test(id));
		for (const id of ids.filter(id => !/^(?:pkg:github\/|github-release:)/.test(id))) {
			const pkg = packages.get(id);
			const registry = pkg ? registries[pkg.manager ?? ''] ?? pkg.manager ?? 'its registry' : 'its registry';
			groups.set(registry, [...groups.get(registry) ?? [], pkg?.name ?? id]);
		}
		return listed([
			...[...groups].map(([registry, names]) => `${listed(names)} to ${registry}`),
			...(release ? ['the GitHub release'] : []),
		]);
	};
	const lines: string[] = [];
	const observed = new Set(stream.observe?.flatMap(entry => entry.publications) ?? []);
	const delegated = new Set(stream.operations?.flatMap(entry => entry.publications) ?? []);
	const promote = stream.promote;
	if (promote) {
		const own = stream.packages.filter(id => !observed.has(id) && !delegated.has(id));
		const registered = own.filter(id => packages.get(id)?.manager !== 'go');
		const tags = promote.tagPrefix
			? [
				`${promote.tagPrefix}<version>`,
				...[...new Set([...own, ...(stream.companionModules ?? [])])].flatMap(id => {
					const source = packages.get(id)?.manager === 'go' ? packages.get(id)?.versionSource ?? '' : '';
					const prefix = source.startsWith('tags:') ? source.slice('tags:'.length) : '';
					return prefix && prefix !== promote.tagPrefix ? [`${prefix}<version>`] : [];
				}),
			]
			: [];
		const steps = [
			...(registered.length ? [`publishes ${publishes(registered)}`] : []),
			...(tags.length ? [`pushes the ${tags.length === 1 ? 'tag' : 'tags'} ${listed(tags)}`] : []),
		];
		lines.push(
			`When a release publishes, ${named(promote.file)} ${
				steps.length ? steps.join(', then ') : 'runs the publishing commands'
			}.`,
		);
	}
	const files = [...new Set(stream.observe?.map(entry => entry.file) ?? [])];
	for (const file of files) {
		const entries = stream.observe?.filter(entry => entry.file === file) ?? [];
		const pushes = plan.workflows.find(workflow => workflow.file === file)?.events.includes('push');
		const tags = pushes
			? entries.flatMap(entry => entry.ref?.startsWith('refs/tags/') ? [entry.ref.slice('refs/tags/'.length)] : [])
			: [];
		const ids = [...new Set(entries.flatMap(entry => entry.publications))];
		const start = tags.length
			? `Tags matching ${listed(tags)} start ${file}`
			: `${sentence(file)} runs on its own triggers`;
		lines.push(
			`${ids.length ? `${start}. It publishes ${publishes(ids)}` : start}, and Beepboop records each run. ${
				tags.length ? 'Its triggers stay as they are.' : ''
			}`.trimEnd(),
		);
	}
	for (const operation of stream.operations ?? []) {
		const after = operation.needs.map(name => {
			const file = stream.observe?.find(entry => entry.name === name)?.file ?? name;
			const jobs = operation.needsJobs?.[name];
			return jobs ? `the ${listed(jobs)} ${jobs.length === 1 ? 'job' : 'jobs'} of ${file}` : file;
		});
		const plural = after.length > 1 || operation.needs.some(name => (operation.needsJobs?.[name]?.length ?? 0) > 1);
		lines.push(
			`After ${listed(after)} ${plural ? 'succeed' : 'succeeds'}, ${named(operation.file)} publishes ${
				publishes(operation.publications)
			}.`,
		);
	}
	const prepare = stream.prepare;
	const commands = prepare?.commands.split('\n').map(line => line.trim()).filter(Boolean) ?? [];
	if (prepare) {
		lines.push(
			`${named(prepare.file)} ${
				commands.length ? `runs ${listed(commands.map(command => `\`${command}\``))}` : 'runs its existing jobs'
			} in the version PR.`,
		);
	} else if (stream.promote && stream.packages.length) {
		lines.push(
			stream.bump === 'commit' ? 'Beepboop pushes the version commit itself.' : 'Beepboop opens the version PR itself.',
		);
	}
	const versionFiles = stream.versionFiles?.map(file => file.path) ?? [];
	if (versionFiles.length) {
		lines.push(`The version ${stream.bump === 'commit' ? 'commit' : 'PR'} also updates ${listed(versionFiles)}.`);
	}
	const needs = stream.needs ?? {};
	if (Object.keys(needs).length) {
		const ids = [...stream.packages, ...(stream.observe ?? []).flatMap(entry => entry.publications)];
		const stages = publicationStages(ids, needs);
		lines.push(
			`Publication order:\n${
				stages.map((stage, index) => `  ${index + 1}. ${stage.length > 1 ? 'In parallel: ' : ''}${publishes(stage)}`)
					.join('\n')
			}`,
		);
	}
	return lines;
}
