import { expect, test } from 'bun:test';
import type { StatusSummary } from '@/server/github-status.ts';
import { outageFrom, outageLine } from '@/server/github-status.ts';

const component = (name: string, status = 'operational') => ({ name, status, group: false });
function summary(
	components: ReturnType<typeof component>[],
	incidents: { name: string; status: string; components?: string[] }[],
): StatusSummary {
	return {
		components,
		incidents: incidents.map(incident => ({
			name: incident.name,
			status: incident.status,
			shortlink: `https://stspg.io/${incident.name.length}`,
			...(incident.components ? { components: incident.components.map(name => component(name)) } : {}),
		})),
	};
}

test('an incident that only affects services Beepboop does not use raises no warning', () => {
	expect(outageFrom(summary(
		[component('Copilot'), component('Actions')],
		[{
			name: 'Degraded availability for models in Copilot',
			status: 'monitoring',
			components: ['Copilot', 'Copilot AI Model Providers'],
		}],
	))).toBeUndefined();
	expect(outageFrom(summary([component('Codespaces', 'major_outage')], []))).toBeUndefined();
	expect(outageFrom(summary([component('Actions')], [{ name: 'Old', status: 'resolved', components: ['Actions'] }])))
		.toBeUndefined();
});

test('a warning names the services Beepboop relies on and never the overall page status', () => {
	const outage = outageFrom(summary(
		[component('Actions', 'partial_outage'), component('Copilot', 'major_outage')],
		[
			{ name: 'Delayed webhooks', status: 'investigating', components: ['Webhooks', 'Copilot'] },
			{ name: 'Copilot models', status: 'investigating', components: ['Copilot'] },
		],
	));
	expect(outage?.description).toBe('GitHub reports problems with Actions and Webhooks');
	expect(outage?.components).toEqual([{ name: 'Actions', status: 'partial outage' }]);
	expect(outage?.incidents.map(incident => incident.name)).toEqual(['Delayed webhooks']);
	expect(outage && outageLine(outage)).toBe(
		'GitHub reports problems with Actions and Webhooks: Delayed webhooks (investigating); affected: Actions partial outage. https://github-up.kjanat.dev (https://www.githubstatus.com)',
	);
});

test('an incident that names no services still warns, and says so', () => {
	expect(outageFrom(summary([], [{ name: 'Investigating reports', status: 'investigating' }]))?.description).toBe(
		'GitHub reports an incident without naming the services it affects',
	);
});
