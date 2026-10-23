import type { Execution, RepositoryRecord } from './types.ts';

function htmlEscape(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
	);
}
export function renderDashboard(
	repositories: RepositoryRecord[],
	executions: Execution[],
): Response {
	const nonce = crypto.randomUUID();
	const options = repositories
		.map((r) => `<option value="${r.id}">${htmlEscape(r.name)}</option>`)
		.join('');
	const page =
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beepboop · Releases</title><style nonce="${nonce}">
:root{font-family:system-ui,sans-serif;color:#e6eaf0;background:#111820;color-scheme:dark}body{max-width:1160px;margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between}h1{font-size:26px}nav{display:flex;gap:8px;margin:24px 0;flex-wrap:wrap}button,a{color:inherit}button{cursor:pointer;background:#243344;border:1px solid #456078;border-radius:6px;padding:9px 14px}nav button[aria-selected=true]{background:#416858}section{margin-bottom:30px}section[hidden]{display:none}article,form{background:#19232e;padding:20px;border:1px solid #304150;border-radius:8px;margin:12px 0}label{display:inline-flex;flex-direction:column;gap:5px;margin:8px 12px 8px 0}input,select,textarea{padding:9px;border:1px solid #526273;border-radius:4px;background:#111820;font:inherit}textarea{display:block;width:95%;min-height:100px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{text-align:left;border-bottom:1px solid #304150;padding:10px}small,.muted{color:#a7b8c9}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}#feedback{position:sticky;bottom:12px;background:#20382e;padding:14px;white-space:pre-wrap;border-radius:8px}details{margin:12px 0}.state{font-family:monospace;color:#9cdbc1}a{color:#a1c9ff}h2{font-size:21px}
</style></head><body><header><div><h1>Beepboop</h1><span class="muted">Release automation</span></div><form action="/auth/logout" method="post"><button>Sign out</button></form></header>
<nav aria-label="Dashboard">${
			['Repositories', 'Releases', 'Executions', 'Credentials', 'Activity']
				.map(
					(name, i) => `<button data-tab="${name.toLowerCase()}" aria-selected="${i === 0}">${name}</button>`,
				)
				.join('')
		}</nav>
<section id="repositories"><h2>Repositories</h2><form id="discover"><label>Repository<input name="repository" placeholder="owner/repository" required></label><button name="action" value="discover">Inspect</button><button name="action" value="onboard">Open onboarding PR</button></form>
${
			repositories
				.map(
					(r) =>
						`<article><h3>${htmlEscape(r.name)}</h3><p>${htmlEscape(r.inventory.managers.join(' · '))}</p><p>${
							r.configuration ? 'Configuration discovered' : 'Awaiting onboarding'
						} · <code>${htmlEscape(r.sha.slice(0, 12))}</code></p>${
							r.diagnostics
								.map((d) => `<p>${htmlEscape(d)}</p>`)
								.join(
									'',
								)
						}<details><summary>${r.inventory.packages.length} packages · ${r.inventory.workflows.length} workflows</summary><table><thead><tr><th>Package</th><th>Version</th><th>Manager</th></tr></thead><tbody>${
							r.inventory.packages
								.map(
									(p) =>
										`<tr><td>${htmlEscape(p.name)}</td><td>${htmlEscape(p.version)}</td><td>${
											htmlEscape(p.manager)
										}</td></tr>`,
								)
								.join('')
						}</tbody></table><ul>${
							r.inventory.workflows
								.map((w) => `<li>${htmlEscape(w.file)} — ${htmlEscape(w.events.join(', '))}</li>`)
								.join(
									'',
								)
						}</ul>${r.inventory.diagnostics.map((d) => `<p>${htmlEscape(d)}</p>`).join('')}</details></article>`,
				)
				.join('') || '<p>No repositories enrolled. Inspect a repository to begin.</p>'
		}</section>
<section id="releases" hidden><h2>Prepare a release</h2><form id="prepare"><label>Repository<select name="repositoryId">${options}</select></label><label>Stream<input name="stream" value="main" required></label><label>Version selection<select name="versionMode"><option value="explicit">Explicit version</option><option>patch</option><option>minor</option><option>major</option><option>prerelease</option><option value="next">Next prerelease</option><option value="stable">Promote to stable</option></select></label><label>Explicit version<input name="version" placeholder="1.2.3"></label><label>Prerelease base<select name="base"><option>patch</option><option>minor</option><option>major</option></select></label><label>Prerelease identifier<input name="identifier" value="alpha"></label><button name="action" value="plan">Preview changes</button><button name="action" value="prepare">Prepare release</button></form><pre id="plan"></pre><h2>Start an operation</h2><form id="start"><label>Repository<select name="repositoryId">${options}</select></label><label>Stream<input name="stream" value="main" required></label><label>Operation<input name="operation" required></label><label>Version (optional)<input name="version"></label><label>Target commit (optional)<input name="sourceSha" pattern="[a-f0-9]{40}"></label><button>Start</button></form></section>
<section id="executions" hidden><h2>Executions</h2>${
			executions
				.map(
					(e) =>
						`<article><h3>${htmlEscape(e.repository)} · ${htmlEscape(e.stream)} / ${
							htmlEscape(
								e.operation,
							)
						}</h3><span class="state">${htmlEscape(e.state)}</span> ${htmlEscape(e.version ?? '')}<p>${
							htmlEscape(
								e.reason ?? '',
							)
						}</p><p>Source <code>${htmlEscape(e.sourceSha)}</code>${
							e.runId
								? ` · <a href="https://github.com/${
									htmlEscape(
										e.repository,
									)
								}/actions/runs/${e.runId}">Workflow run ${e.runId}</a>`
								: ''
						}</p>${
							e.publications.length
								? `<table><thead><tr><th>Destination</th><th>Version</th><th>Result</th></tr></thead><tbody>${
									e.publications
										.map(
											(p) =>
												`<tr><td>${htmlEscape(p.manager)} · ${htmlEscape(p.name)}</td><td>${
													htmlEscape(p.version)
												}</td><td>${
													htmlEscape(
														p.outcome,
													)
												}${p.required ? '' : ' (optional)'}</td></tr>`,
										)
										.join('')
								}</tbody></table>`
								: '<p class="muted">Awaiting publication reports.</p>'
						}${
							e.state === 'blocked' && e.operation === 'promote'
								? `<button data-approve="${e.id}" data-sha="${e.sourceSha}">Approve this commit</button>`
								: ''
						}${
							['failed', 'cancelled'].includes(e.state) ? `<button data-retry="${e.id}">Retry failed jobs</button>` : ''
						}${
							e.state === 'uncertain'
								? `<button data-reconcile="${e.id}">Reconcile outcome</button>`
								: ''
						}<details><summary>Artifacts and identity</summary><pre>${
							htmlEscape(
								JSON.stringify(
									{
										configurationSha: e.configurationSha,
										workflowSha: e.workflowSha,
										runAttempt: e.runAttempt,
										artifacts: e.artifacts,
									},
									null,
									2,
								),
							)
						}</pre></details></article>`,
				)
				.join('') || '<p>No executions yet.</p>'
		}</section>
<section id="credentials" hidden><h2>Credentials</h2><p>Credential changes require a fresh touch of an enrolled security key.</p><button id="load-credentials">Refresh credentials</button><pre id="credential-list"></pre><form id="enroll"><h3>Enroll a security key</h3><label>Key name<input name="label" placeholder="Primary YubiKey" required></label><label>Initial enrollment token<input name="bootstrap" type="password" autocomplete="off"></label><button>Enroll key</button></form><form id="secret"><label>Alias<input name="alias" required></label><label>New value<input name="value" type="password" autocomplete="off"></label><button name="action" value="replace">Replace</button><button name="action" value="reveal">Reveal</button><button name="action" value="sync">Synchronize</button><output id="revealed"></output></form><form id="grant"><h3>Grant access</h3><label>Grant ID<input name="id" required></label><label>Alias<input name="alias" required></label><label>Repository<input name="repository" required></label><label>Repository ID<input name="repositoryId" type="number" required></label><label>Operation<input name="operation" required></label><label>Workflow<input name="workflow" placeholder="publish.yml" required></label><label>Ref<input name="ref" placeholder="refs/heads/master" required></label><label>Environment<input name="environment"></label><label>Delivery<select name="delivery"><option>runtime</option><option>repository</option><option>environment</option></select></label><label>GitHub secret name<input name="secretName"></label><button>Save grant</button></form><form id="revoke"><label>Grant ID<input name="grantId" required></label><button>Revoke grant</button></form></section>
<section id="activity" hidden><h2>Activity</h2><button id="load-activity">Refresh activity</button><pre id="activity-list"></pre></section><output id="feedback" hidden></output>
<script nonce="${nonce}">
const feedback=document.querySelector('#feedback');
function show(message){feedback.hidden=false;feedback.textContent=typeof message==='string'?message:JSON.stringify(message,null,2)}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
function fields(form){const data=Object.fromEntries(new FormData(form));for(const key of Object.keys(data))if(data[key]==='')delete data[key];if(data.repositoryId)data.repositoryId=Number(data.repositoryId);return data}
async function elevated(){const challenge=await api('/api/authenticators/options',{register:false});const credential=await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(challenge.options)});const result=await api('/api/authenticators/verify',{id:challenge.id,response:credential.toJSON()});return result.proof}
for(const button of document.querySelectorAll('[data-tab]'))button.onclick=()=>{for(const section of document.querySelectorAll('body>section'))section.hidden=section.id!==button.dataset.tab;for(const tab of document.querySelectorAll('[data-tab]'))tab.setAttribute('aria-selected',String(tab===button))};
function submit(id,handler){document.querySelector('#'+id).onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await handler(fields(event.target),button.value)}catch(error){show(error.message)}finally{button.disabled=false}}}
submit('discover',async(data,action)=>show(await api('/api/repositories/'+action,data)));
submit('prepare',async(data,action)=>{if(data.versionMode!=='explicit')data.version=data.versionMode==='prerelease'?{bump:'prerelease',base:data.base,identifier:data.identifier}:{bump:data.versionMode};delete data.versionMode;delete data.base;delete data.identifier;const result=await api('/api/releases/'+action,data);document.querySelector('#plan').textContent=JSON.stringify(result,null,2);show(action==='plan'?'Release plan ready.':'Release preparation started.')});
submit('start',async data=>show(await api('/api/executions/start',{...data,requestId:crypto.randomUUID()})));
submit('enroll',async data=>{let proof;if(!data.bootstrap)proof=await elevated();const challenge=await api('/api/authenticators/options',{register:true,bootstrap:data.bootstrap,label:data.label,proof});const credential=await navigator.credentials.create({publicKey:PublicKeyCredential.parseCreationOptionsFromJSON(challenge.options)});await api('/api/authenticators/verify',{id:challenge.id,response:credential.toJSON()});document.querySelector('#enroll').reset();show('Security key enrolled.')});
submit('secret',async(data,action)=>{const result=await api('/api/credentials/'+action,{...data,proof:await elevated()});document.querySelector('#secret input[name=value]').value='';if(action==='reveal'){const output=document.querySelector('#revealed');output.textContent=result.value;setTimeout(()=>output.textContent='',30000);show('Credential revealed for 30 seconds.')}else show(result)});
submit('grant',async grant=>show(await api('/api/credentials/grant',{grant,proof:await elevated()})));
submit('revoke',async data=>show(await api('/api/credentials/revoke',{...data,proof:await elevated()})));
document.querySelector('#load-credentials').onclick=async()=>{try{document.querySelector('#credential-list').textContent=JSON.stringify(await api('/api/credentials'),null,2)}catch(e){show(e.message)}};
document.querySelector('#load-activity').onclick=async()=>{try{document.querySelector('#activity-list').textContent=JSON.stringify(await api('/api/activity'),null,2)}catch(e){show(e.message)}};
for(const b of document.querySelectorAll('[data-approve],[data-retry],[data-reconcile]'))b.onclick=async()=>{b.disabled=true;try{show(b.dataset.approve?await api('/api/executions/approve',{id:b.dataset.approve,sourceSha:b.dataset.sha}):await api('/api/executions/recover',{id:b.dataset.retry||b.dataset.reconcile,action:b.dataset.retry?'retry':'reconcile'}))}catch(e){show(e.message)}finally{b.disabled=false}};
</script></body></html>`;
	return new Response(page, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Content-Security-Policy':
				`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff',
		},
	});
}
