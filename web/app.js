const token = new URL(location.href).searchParams.get('token');
const $ = id => document.getElementById(id);
let status, previewId, projectPreviewId, maintenanceId;
async function api(route, body) {
  const response = await fetch('/api/' + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result;
}
function notice(text, error = false) { $('notice').hidden = false; $('notice').textContent = text; $('notice').className = error ? 'error' : ''; }
function run(fn) { return async event => { event?.preventDefault(); const button = event?.currentTarget; if (button?.tagName === 'BUTTON') button.setAttribute('aria-busy', 'true'); try { await fn(); } catch (e) { notice(e.message, true); } finally { if (button?.tagName === 'BUTTON') button.removeAttribute('aria-busy'); } }; }
function badge(text, state) { const el = document.createElement('span'); el.className = 'badge ' + (state === true ? 'good' : state === false ? 'bad' : ''); el.textContent = text; return el; }
function renderChanges(id, result) {
  const root = $(id); root.replaceChildren();
  if (!result.changes.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Already configured. No file changes needed.'; root.append(p); }
  for (const c of result.changes) { const row = document.createElement('div'); row.className = 'change'; const b = document.createElement('b'); b.textContent = c.action; row.append(b, document.createTextNode(c.path)); root.append(row); }
  for (const warning of result.warnings || []) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = warning; root.append(p); }
}
async function refresh() {
  status = await api('status');
  if (!$('memory').value) $('memory').value = status.memoryDir || status.defaultFolder;
  if (!$('agents').children.length) for (const a of status.available) {
    const label = document.createElement('label'); label.className = 'agent-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = a.id; input.name = 'agent'; input.checked = status.connections?.some(c => c.agent === a.id) || status.detected.includes(a.id);
    const text = document.createElement('span'); text.textContent = a.name;
    const small = document.createElement('small'); small.textContent = status.detected.includes(a.id) ? 'Found config or command' : 'Not detected · optional'; text.append(small); label.append(input, text); $('agents').append(label);
  }
  $('vaults').textContent = status.vaults.length ? 'Obsidian vaults found: ' + status.vaults.join(' · ') : '';
  $('connection-list').replaceChildren(); $('test-agent').replaceChildren();
  for (const c of status.connections || []) {
    const card = document.createElement('div'); card.className = 'card'; const row = document.createElement('div'); row.className = 'connection';
    const name = document.createElement('h3'); name.textContent = c.name;
    const badges = document.createElement('div'); badges.className = 'badges'; badges.append(badge(c.configured ? 'Configured' : 'Needs setup', c.configured), badge(`Read: ${c.read}`, c.read === 'verified' ? true : undefined), badge(`Write: ${c.write}`, c.write === 'verified' ? true : undefined)); row.append(name, badges); card.append(row);
    const p = document.createElement('p'); p.className = 'subtle'; p.textContent = `${c.executable ? 'CLI command found' : 'CLI not found on PATH'} · ${c.liveSupported ? 'Automatic test available' : 'Use guided test'}${c.stale ? ' · Previous results are stale' : ''}${c.checkedAt ? ' · Last checked ' + new Date(c.checkedAt).toLocaleString() : ''}`; card.append(p); $('connection-list').append(card);
    const option = document.createElement('option'); option.value = c.agent; option.textContent = c.name; $('test-agent').append(option);
  }
  if (!(status.connections || []).length) $('connection-list').textContent = 'Set up a notebook first, then check connections here.';
  $('diagnostics').replaceChildren(); for (const c of status.checks) { const li = document.createElement('li'); li.textContent = `${c.status}: ${c.label}`; $('diagnostics').append(li); }
  liveButton();
}
function liveButton() { const selected = $('test-agent').value; $('live-test').disabled = !$('live-consent').checked || !status?.connections?.find(c => c.agent === selected)?.liveSupported; }
for (const nav of document.querySelectorAll('[data-tab]')) nav.addEventListener('click', () => { for (const section of document.querySelectorAll('.panel')) section.hidden = section.id !== nav.dataset.tab; for (const item of document.querySelectorAll('.nav')) { item.classList.toggle('active', item === nav); if (item === nav) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); } window.scrollTo(0, 0); });
for (const button of document.querySelectorAll('[data-pick]')) button.addEventListener('click', run(async () => { const result = await api('pick-folder', {}); if (result.path) { const input = $(button.dataset.pick); input.value = result.path; input.dispatchEvent(new Event('input', { bubbles: true })); } }));
$('setup-form').addEventListener('input', () => { previewId = null; $('apply').disabled = true; });
$('setup-form').addEventListener('submit', run(async () => { const agents = [...document.querySelectorAll('input[name=agent]:checked')].map(x => x.value); if (!agents.length) throw new Error('Choose at least one agent.'); const result = await api('preview', { memoryDir: $('memory').value, notesDir: $('notes').value, agents, allowCapture: $('capture').checked, upgradePolicy: $('upgrade').checked }); previewId = result.previewId; renderChanges('changes', result); $('setup-preview').hidden = false; $('apply').disabled = false; notice('Preview ready. Your files have not changed.'); }));
$('apply').addEventListener('click', run(async () => { if (!previewId) throw new Error('Preview your current choices first.'); await api('install', { previewId }); previewId = null; $('setup-preview').hidden = true; await refresh(); notice('Installed. Check connections, complete manual steps, and start fresh agent chats.'); }));
$('refresh').addEventListener('click', run(refresh));
$('copy-pointer').addEventListener('click', run(async () => { const result = await api('instructions'); $('pointer').textContent = result.text; $('pointer').hidden = false; try { await navigator.clipboard.writeText(result.text); notice('Instructions copied. Paste into the tool’s global rules.'); } catch { notice('Select and copy the instructions shown below.'); } }));
async function projectPreview(remove) { const result = await api('project-preview', { path: $('project').value, remove }); projectPreviewId = result.previewId; renderChanges('project-changes', result); $('project-apply').hidden = false; }
$('project').addEventListener('input', () => { projectPreviewId = null; $('project-apply').hidden = true; });
$('project-preview').addEventListener('click', run(() => projectPreview(false))); $('project-remove').addEventListener('click', run(() => projectPreview(true)));
$('project-apply').addEventListener('click', run(async () => { if (!projectPreviewId) throw new Error('Preview the project change first.'); await api('project-apply', { previewId: projectPreviewId }); $('project-apply').hidden = true; await refresh(); notice('Project connection updated. Your knowledge stayed in the personal notebook.'); }));
$('search-form').addEventListener('submit', run(async () => { const result = await api('search?q=' + encodeURIComponent($('query').value)); $('hits').replaceChildren(); $('excerpt').hidden = true;
  for (const hit of result.hits) { const div = document.createElement('div'); div.className = 'hit'; const button = document.createElement('button'); button.type = 'button'; button.textContent = hit.title; button.addEventListener('click', run(async () => { const note = await api('show?path=' + encodeURIComponent(hit.path) + '&start=' + Math.max(1, hit.line - 4)); $('excerpt').hidden = false; $('excerpt').textContent = note.excerpt + (note.truncated ? '\n[Excerpt truncated]' : ''); })); const p = document.createElement('p'); p.textContent = `${hit.path}:${hit.line}` + (hit.snippet ? ' · ' + hit.snippet : ''); div.append(button, p); $('hits').append(div); }
  const p = document.createElement('p'); p.className = 'hint'; p.textContent = result.guidance + (result.partial ? ' Search was bounded; some content may not have been scanned.' : ''); $('hits').append(p);
}));
$('maintain-preview').addEventListener('click', run(async () => { const result = await api('maintain-preview', { archiveDuplicates: $('archive').checked, reindex: $('reindex').checked }); maintenanceId = result.planId; $('maintenance').hidden = false; $('maintenance').textContent = JSON.stringify(result, null, 2); $('maintain-apply').disabled = !result.actions.length; notice('Maintenance preview only. No notes changed.'); }));
for (const id of ['archive', 'reindex']) $(id).addEventListener('change', () => { maintenanceId = null; $('maintain-apply').disabled = true; });
$('maintain-apply').addEventListener('click', run(async () => { if (!maintenanceId) throw new Error('Review a fresh maintenance preview.'); const result = await api('maintain-apply', { planId: maintenanceId }); $('maintain-apply').disabled = true; $('maintenance').textContent = JSON.stringify(result, null, 2); notice('Reviewed maintenance applied. Duplicates were archived, not deleted.'); }));
$('prepare').addEventListener('click', run(async () => { const result = await api('test-prepare', { agent: $('test-agent').value }); $('read-prompt').value = result.readPrompt; $('write-prompt').value = result.writePrompt; $('prompts').hidden = false; notice('Challenge prepared. Use a fresh agent chat; the read answer is intentionally hidden.'); }));
$('check-test').addEventListener('click', run(async () => { const result = await api('test-check', { answer: $('answer').value }); $('test-result').hidden = false; $('test-result').textContent = JSON.stringify(result, null, 2); await refresh(); notice(result.ok ? 'Read and write verified. Clean the test notes next.' : 'A check did not pass. Inspect the result; do not assume memory is working.', !result.ok); }));
$('clean-test').addEventListener('click', run(async () => { const result = await api('test-clean', {}); $('prompts').hidden = true; $('test-result').textContent = JSON.stringify(result, null, 2); notice('Identified unchanged test files cleaned. Edited notes were kept.'); }));
$('live-consent').addEventListener('change', liveButton); $('test-agent').addEventListener('change', liveButton);
$('live-test').addEventListener('click', run(async () => { if (!$('live-consent').checked) throw new Error('Opt in to agent calls first.'); $('live-test').disabled = true; $('live-progress').textContent = 'Running two bounded fresh CLI calls. This can take a few minutes; leave this window open.'; try { const result = await api('verify', { agent: $('test-agent').value, live: true }); $('test-result').hidden = false; $('test-result').textContent = JSON.stringify(result, null, 2); await refresh(); notice(result.ok ? 'Fresh CLI read and write both verified.' : 'Verification did not fully pass. Check login, model, and permissions.', !result.ok); } finally { $('live-progress').textContent = ''; liveButton(); } }));
refresh().catch(e => notice(e.message, true));
