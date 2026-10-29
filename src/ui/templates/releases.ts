import type { Execution, RepositoryRecord } from '../../automation/types.ts';
import { htmlEscape } from './html.ts';

export function renderReleases(repositories: RepositoryRecord[], executions: Execution[]): string {
	const options = repositories.map(r => `<option value="${r.id}">${htmlEscape(r.name)}</option>`).join('');
	const preparations = executions.filter(e =>
		e.state === 'succeeded' && ((e.managed && 'groups' in e.managed.plan) || (e.plan && 'groups' in e.plan))
	).map(e => `<option value="${htmlEscape(e.id)}">${htmlEscape(e.repository)} / ${htmlEscape(e.stream)}</option>`)
		.join('');

	return `<section id="releases" hidden>
	<h2>Prepare a release</h2>
	<form id="prepare">
		<label>Repository<select name="repositoryId">${options}</select></label>
		<label>Stream<input name="stream" value="main" required></label>
		<label>Version selection<select name="versionMode">
				<option value="explicit">Explicit version</option>
				<option>patch</option>
				<option>minor</option>
				<option>major</option>
				<option>prerelease</option>
				<option value="next">Next prerelease</option>
				<option value="stable">Promote to stable</option>
			</select>
		</label>
		<label>Explicit version<input name="version" placeholder="1.2.3"></label>
		<label>Prerelease base<select name="base">
				<option>patch</option>
				<option>minor</option>
				<option>major</option>
			</select>
		</label>
		<label>Prerelease identifier<input name="identifier" value="alpha"></label>
		<button name="action" value="plan">Preview changes</button>
		<button name="action" value="prepare">Prepare release</button>
	</form>
	<pre id="plan"></pre>
	<h2>Release sets</h2>
	<p>Prepare several version groups together, then start their operations after the preparation PR is merged.</p>
	<form id="release-set">
		<label>Repository<select name="repositoryId">${options}</select></label>
		<label>Stream<input name="stream" value="main" required></label>
		<label class="wide">Groups and operations<textarea name="plan" required placeholder='{"groups":[{"id":"tool","packages":["npm:package"],"version":{"bump":"patch"}}],"operations":[]}'></textarea></label>
		<button name="action" value="plan-set">Preview release set</button>
		<button name="action" value="prepare-set">Prepare reviewed set</button>
	</form>
	<pre id="set-plan"></pre>
	<form id="start-set">
		<label>Completed preparation<input name="preparationId" list="preparations" required></label>
		<datalist id="preparations">${preparations}</datalist>
		<label>Merged revision<input name="sourceSha" pattern="[a-f0-9]{40}" required></label>
		<button>Start prepared release set</button>
	</form>
	<pre id="set-executions"></pre>
	<h2>Start an operation</h2>
	<form id="start">
		<label>Repository<select name="repositoryId">${options}</select></label>
		<label>Stream<input name="stream" value="main" required></label>
		<label>Operation<input name="operation" required></label>
		<label>Version (optional)<input name="version"></label>
		<label>Target commit (optional)<input name="sourceSha" pattern="[a-f0-9]{40}"></label>
		<button>Start</button>
	</form>
	</section>`;
}
