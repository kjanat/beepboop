import { Effect, Result } from 'effect';
import { publishable } from '@/automation/package-publication';
import { parseSetupPlan } from '@/automation/setup-plan';
import type { SetupChoices, SetupPlan } from '@/automation/setup-types';
import { routes } from '@/contract/routes';
import { api } from '@/ui/browser/api';
import { feedbackFor, find, Refused, refuse, show } from '@/ui/browser/dom';

import { element, hint, label, select, text, workflow } from '@/ui/browser/setup-fields';

const sessions = new WeakMap<
	HTMLFormElement,
	{ plan: SetupPlan; choices: () => Result.Result<SetupChoices, Refused>; reviewed?: string; takeOver?: string }
>();
function editor(form: HTMLFormElement, plan: SetupPlan) {
	form.replaceChildren();
	form.append(
		element('h3', 'Set up releases'),
		element(
			'p',
			'Select the packages, review how they are published, then preview the PR. Nothing is published during setup.',
		),
	);
	const streams = element('div');
	form.append(streams);
	const readers: (() => Result.Result<SetupChoices['streams'][number] | undefined, Refused>)[] = [];
	const advanced = element('details');
	advanced.append(element('summary', 'Advanced settings'));
	const revision = text(advanced, 'Actions revision override (optional)', plan.choices.actionsRevision ?? '');
	hint(
		advanced,
		'Normally leave this empty. Generated workflows use the current compatible v1 Actions release. Override it only when deliberately testing another revision.',
	);
	const add = (value: SetupChoices['streams'][number]) => {
		const box = element('fieldset');
		box.append(
			element(
				'legend',
				value.name === 'main' && plan.choices.streams.length === 1
					? 'Packages to release'
					: `Release group: ${value.name}`,
			),
		);
		const enabled = element('input');
		enabled.type = 'checkbox';
		enabled.checked = true;
		if (plan.choices.streams.length > 1 || readers.length > 0) label(box, 'Include this release group', enabled);
		const body = element('fieldset');
		body.className = 'setup-group-body';
		box.append(body);
		const selected = plan.inventory.packages.flatMap((pkg, index) => {
			const id = plan.packageIds[index];
			if (!id || !publishable(pkg)) return [];
			const input = element('input');
			input.type = 'checkbox';
			input.checked = value.packages.includes(id);
			label(body, `${pkg.name} (${pkg.manifest})`, input);
			return [{ input, pkg: { ...pkg, id } }];
		});
		const groupAdvanced = element('details');
		groupAdvanced.append(element('summary', 'Versioning and group settings'));
		const name = text(groupAdvanced, 'Release group name', value.name);
		name.required = true;
		name.pattern = '[a-z][a-z0-9\\-]{0,63}';
		hint(groupAdvanced, 'A release group is a set of packages released together. Most repositories only need one.');
		const versioning = select(groupAdvanced, 'How package versions change', [
			['workspace', 'Give the selected packages the same version'],
			['independent', 'Version each package separately'],
			...(value.versioning === 'none'
				? [['none', 'Keep the configured custom version policy']] as [string, string][]
				: []),
		], value.versioning);
		hint(groupAdvanced, 'Choose the actual version when preparing a release. Setup does not change package versions.');
		const selection = () => ({
			name: name.value,
			packages: selected.filter(entry => entry.input.checked).map(entry => entry.pkg),
		});
		const publishing = workflow(body, 'promote', plan, selection, value.promote);
		const preparing = workflow(body, 'prepare', plan, selection, value.prepare, publishing);
		publishing.onChange = () => preparing.refresh();
		for (const { input } of selected) {
			input.addEventListener('change', () => {
				publishing.refresh();
				preparing.refresh();
			});
		}
		name.addEventListener('input', () => {
			publishing.refresh();
			preparing.refresh();
		});
		body.append(groupAdvanced);
		enabled.addEventListener('change', () => {
			body.disabled = !enabled.checked;
		});
		streams.append(box);
		readers.push(() =>
			Result.gen(function*() {
				if (!enabled.checked) return undefined;
				const packages = selection().packages.map(pkg => pkg.id);
				if (!packages.length) {
					return yield* Result.fail(new Refused({ message: 'Select at least one package to release.' }));
				}
				const prepare = yield* preparing.read(), promote = yield* publishing.read();
				return {
					name: name.value,
					packages,
					required: packages,
					versioning: versioning.value === 'independent'
						? 'independent' as const
						: versioning.value === 'none'
						? 'none' as const
						: 'workspace' as const,
					...(prepare ? { prepare } : {}),
					...(promote ? { promote } : {}),
				};
			})
		);
	};
	plan.choices.streams.forEach(add);
	const addButton = element('button', 'Add another release group');
	addButton.type = 'button';
	addButton.addEventListener('click', () => {
		add({ name: `release-${readers.length + 1}`, versioning: 'workspace', packages: [], required: [] });
		invalidate();
	});
	advanced.append(addButton);
	form.append(advanced);
	const preview = element('button', 'Preview release setup');
	preview.value = 'preview';
	const apply = element('button', 'Open setup PR');
	apply.value = 'apply';
	apply.disabled = true;
	const takeOver = element('button', 'Replace edited setup branch');
	takeOver.value = 'takeover';
	takeOver.hidden = true;
	const result = element('div');
	result.className = 'setup-result';
	result.setAttribute('aria-live', 'polite');
	form.append(preview, apply, takeOver, result);
	feedbackFor(form);
	const choices = (): Result.Result<SetupChoices, Refused> =>
		Result.all(readers.map(read => read())).pipe(Result.map(streams => ({
			streams: streams.filter((stream): stream is NonNullable<typeof stream> => stream !== undefined),
			...(revision.value ? { actionsRevision: revision.value } : {}),
		})));
	sessions.set(form, { plan, choices });
	function invalidate() {
		const session = sessions.get(form);
		if (session) {
			delete session.reviewed;
			delete session.takeOver;
		}
		apply.disabled = true;
		takeOver.hidden = true;
		if (result.childNodes.length) {
			result.replaceChildren(element('p', 'Your choices changed. Preview again to review the updated workflow.'));
		}
	}
	form.addEventListener('input', invalidate);
	form.addEventListener('change', invalidate);
}
function review(form: HTMLFormElement, plan: SetupPlan) {
	const result = form.querySelector('.setup-result');
	if (!result) return;
	result.replaceChildren(element('h3', 'Review setup changes'), element('p', `Inspected commit: ${plan.sourceSha}`));
	for (const message of [...plan.blockers, ...plan.notes]) result.append(element('p', message));
	if (plan.prior) {
		const link = element(
			'a',
			plan.prior.superseded ? 'Previous setup proposal — superseded by current configuration' : 'Existing setup PR',
		);
		link.href = plan.prior.url;
		result.append(link);
	}
	for (const edit of plan.edits) {
		const details = element('details');
		details.append(
			element('summary', edit.path),
			element('h4', 'Current'),
			element('pre', edit.before),
			element('h4', 'Proposed'),
			element('pre', edit.after),
		);
		result.append(details);
	}
	if (!plan.edits.length) result.append(element('p', 'No file changes needed.'));
	const apply = find(form, 'button[value="apply"]', HTMLButtonElement);
	if (apply) apply.disabled = !!plan.blockers.length || !plan.edits.length;
	const takeOver = find(form, 'button[value="takeover"]', HTMLButtonElement);
	if (takeOver) takeOver.hidden = !takeOverAllowed(plan);
	if (plan.branchConflict) {
		result.append(
			element('p', 'Taking over force-pushes this proposal and deletes the other commits on the setup branch.'),
		);
	}
}
function takeOverAllowed(plan: SetupPlan): boolean {
	return plan.branchConflict && plan.blockers.length === 1 && plan.edits.length > 0;
}
function parsePlan(value: unknown): Effect.Effect<SetupPlan, Refused> {
	return parseSetupPlan(value).pipe(Effect.mapError(error => new Refused({ message: error.message })));
}
export function setup(form: HTMLFormElement, action: string) {
	return Effect.gen(function*() {
		const repository = form.dataset.repository;
		if (!repository) return yield* refuse('Repository missing');
		const session = sessions.get(form);
		if (!session) {
			const plan = yield* parsePlan(yield* api(routes.setupPreview, { repository }));
			editor(form, plan);
			const apply = find(form, 'button[value="apply"]', HTMLButtonElement);
			if (apply) apply.disabled = true;
			return;
		}
		const choices = yield* Effect.fromResult(session.choices()), identity = JSON.stringify(choices);
		if (action !== 'apply' && action !== 'takeover') {
			delete session.reviewed;
			const plan = yield* parsePlan(yield* api(routes.setupPreview, { repository, choices }));
			session.plan = plan;
			if (!plan.blockers.length) session.reviewed = identity;
			if (takeOverAllowed(plan)) session.takeOver = identity;
			review(form, plan);
			return;
		}
		const takingOver = action === 'takeover';
		if ((takingOver ? session.takeOver : session.reviewed) !== identity) {
			return yield* refuse('Preview these choices again before applying.');
		}
		const { planId, sourceSha, setupHead } = session.plan;
		const result = yield* api(routes.setupApply, {
			repository,
			choices,
			planId,
			sourceSha,
			setupHead,
			...(takingOver ? { takeOver: true } : {}),
		});
		delete session.reviewed;
		delete session.takeOver;
		const output = form.querySelector('.setup-result');
		if (output) {
			const link = element('a', 'Review setup pull request');
			link.href = result.url;
			output.replaceChildren(link);
		}
		show('Setup PR ready for review. Merge it yourself, then refresh inspection.', form);
	});
}

export function canApplySetup(form: HTMLFormElement): boolean {
	return !!sessions.get(form)?.reviewed;
}
