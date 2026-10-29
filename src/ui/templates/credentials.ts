export function renderCredentials(): string {
	return `<section id="credentials" hidden>
		<h2>Credentials</h2>
		<p>Credential changes require a fresh touch of an enrolled security key.</p>
		<button id="load-credentials">Refresh credentials</button>
		<pre id="credential-list"></pre>
		<form id="enroll">
			<h3>Enroll a security key</h3>
			<label>Key name<input name="label" placeholder="Primary YubiKey" required></label>
			<label>Initial enrollment token<input name="bootstrap" type="password" autocomplete="off"></label>
			<button>Enroll key</button>
		</form>
		<form id="secret">
			<label>Alias<input name="alias" required></label>
			<label>New value<input name="value" type="password" autocomplete="off"></label>
			<button name="action" value="replace">Replace</button>
			<button name="action" value="reveal">Reveal</button>
			<button name="action" value="sync">Synchronize</button>
			<output id="revealed"></output>
		</form>
		<form id="grant">
			<h3>Grant access</h3>
			<label>Grant ID<input name="id" required></label>
			<label>Alias<input name="alias" required></label>
			<label>Repository<input name="repository" required></label>
			<label>Repository ID<input name="repositoryId" type="number" required></label>
			<label>Operation<input name="operation" required></label>
			<label>Workflow<input name="workflow" placeholder="publish.yml" required></label>
			<label>Ref<input name="ref" placeholder="refs/heads/master" required></label>
			<label>Environment<input name="environment"></label>
			<label>Delivery<select name="delivery">
					<option>runtime</option>
					<option>repository</option>
					<option>environment</option>
				</select>
			</label>
			<label>GitHub secret name<input name="secretName"></label>
			<button>Save grant</button>
		</form>
		<form id="revoke">
			<label>Grant ID<input name="grantId" required></label>
			<button>Revoke grant</button>
		</form>
	</section>`;
}
