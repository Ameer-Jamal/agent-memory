import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, install, planSetup, uninstall, targets, load, read, doctor, prepareTest, checkTest, cleanTest, probe } from '../src/core.mjs';
import { ADAPTERS, AGENTS } from '../src/adapters.mjs';
import { pointer, templates } from '../src/templates.mjs';
import { search, show, walkMarkdown, previewMaintenance, applyMaintenance } from '../src/notebook.mjs';
import { planProject, connectProject } from '../src/projects.mjs';
import { invocation, finalText, verifyLive, runCommand, failureHint } from '../src/verification.mjs';
import { serveUI } from '../src/ui.mjs';

const cli = fileURLToPath(new URL('../bin/agent-memory.mjs', import.meta.url));
function fixture(t, agents = AGENTS) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-v2-'))), home = path.join(base, 'home');
  fs.mkdirSync(home);
  const ctx = context({ home, configDir: path.join(base, 'state') });
  const opts = { memoryDir: path.join(home, 'My Memory'), agents };
  install(ctx, opts);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, home, ctx, opts, root: opts.memoryDir };
}
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

test('all eight integrations install, remain idempotent, and disconnect without deleting notes', t => {
  const { ctx, opts, root } = fixture(t);
  assert.equal(AGENTS.length, 8);
  assert.equal(planSetup(ctx, opts).changes.length, 0);
  for (const a of AGENTS) assert.ok(read(targets(ctx)[a]).includes('Do NOT preload'));
  assert.ok(targets(ctx).opencode.endsWith(path.join('opencode', 'AGENTS.md')));
  assert.ok(targets(ctx).copilot.endsWith('copilot-instructions.md'));
  assert.ok(targets(ctx).cline.endsWith(path.join('.cline', 'rules', 'agent-memory.md')));
  uninstall(ctx); assert.ok(fs.existsSync(path.join(root, 'MEMORY.md')));
});

test('OpenCode and Copilot respect explicit config roots without reading real homes', t => {
  const { ctx, base } = fixture(t);
  const isolated = context({ home: ctx.home, configDir: path.join(base, 'other-state'), env: { XDG_CONFIG_HOME: path.join(base, 'xdg'), COPILOT_HOME: path.join(base, 'copilot') } });
  assert.equal(targets(isolated).opencode, path.join(base, 'xdg', 'opencode', 'AGENTS.md'));
  assert.equal(targets(isolated).copilot, path.join(base, 'copilot', 'copilot-instructions.md'));
});

test('startup pointer is short and explicitly prevents whole-library startup loads', () => {
  const text = pointer('/example/notes');
  assert.ok(text.length < 1500);
  assert.ok(text.includes('Skip lookup for routine tasks'));
  assert.ok(text.includes('Do NOT preload MEMORY.md, INDEX.md, or whole folders'));
  assert.ok(text.includes('2 searches')); assert.ok(text.includes('2 relevant excerpts'));
  assert.ok(!text.includes('Before starting a task, read'));
});

test('policy upgrades are explicit, backed up, and preserve topics', t => {
  const { ctx, opts, root } = fixture(t);
  write(path.join(root, 'MEMORY.md'), '# My existing policy\nCustom policy\n');
  write(path.join(root, 'topics', 'custom.md'), '# Keep my knowledge');
  install(ctx, opts); assert.ok(read(path.join(root, 'MEMORY.md')).includes('Custom policy'));
  const plan = planSetup(ctx, { ...opts, upgradePolicy: true });
  assert.ok(plan.changes.some(c => c.path === path.join(root, 'MEMORY.md')));
  install(ctx, { ...opts, upgradePolicy: true });
  assert.ok(read(path.join(root, 'MEMORY.md')).includes('Look up a useful page'));
  assert.equal(read(path.join(root, 'topics', 'custom.md')), '# Keep my knowledge');
  const backups = fs.readdirSync(path.join(ctx.configDir, 'backups'));
  assert.ok(backups.some(dir => fs.readdirSync(path.join(ctx.configDir, 'backups', dir)).some(name => read(path.join(ctx.configDir, 'backups', dir, name))?.includes('Custom policy'))));
});

test('search prefers titles, returns eight hits at most, and caps serialized output', t => {
  const { ctx, root } = fixture(t);
  for (let i = 0; i < 80; i++) write(path.join(root, 'topics', `java-${i}.md`), '# Java runner\n' + 'Long irrelevant content. '.repeat(300));
  const r = search(ctx, 'java runner');
  assert.equal(r.hits.length, 8); assert.ok(r.hits.every(h => h.match === 'title'));
  assert.ok(JSON.stringify(r).length <= 4000);
  assert.ok(r.hits.every(h => !h.snippet));
});

test('body search finds an exact useful line, not a full note dump', t => {
  const { ctx, root } = fixture(t);
  write(path.join(root, 'inbox', 'environment.md'), '# Setup issue\n\nVerified workaround: use java21 for runner42.\n' + 'Unrelated details\n'.repeat(100));
  const r = search(ctx, 'java21 runner42');
  assert.equal(r.hits[0].line, 3); assert.ok(r.hits[0].snippet.includes('java21'));
  assert.ok(r.hits[0].snippet.length <= 180);
  assert.equal(search(ctx, 'nonexistent-phrase').hits.length, 0);
  assert.equal(search(ctx, '.*').hits.length, 0);
  assert.throws(() => search(ctx, 'a', { limit: 999 }), /1–8/u);
});

test('source notes are opt-in and sensitive filenames/metadata are excluded', t => {
  const { ctx, opts, root } = fixture(t);
  const source = path.join(ctx.home, 'Source');
  write(path.join(source, 'tooling.md'), '# External setup\nneedle999');
  write(path.join(source, 'passwords.md'), '# Secret\nneedle999');
  write(path.join(source, '.git', 'hidden.md'), '# Hidden\nneedle999');
  assert.throws(() => search(ctx, 'needle999', { source: 'notes' }), /No optional/u);
  uninstall(ctx); install(ctx, { ...opts, notesDir: source });
  assert.equal(search(ctx, 'needle999').hits.length, 0);
  const r = search(ctx, 'needle999', { source: 'notes' });
  assert.equal(r.hits.length, 1); assert.equal(r.hits[0].path, 'tooling.md');
  assert.ok(show(ctx, 'tooling.md', { source: 'notes' }).excerpt.includes('needle999'));
  assert.ok(fs.existsSync(path.join(root, 'MEMORY.md')));
});

test('excerpts enforce character/line limits and refuse traversal or linked notes', t => {
  const { ctx, root, base } = fixture(t);
  write(path.join(root, 'topics', 'long.md'), Array.from({ length: 200 }, (_, i) => `line ${i}: ` + '"'.repeat(200)).join('\n'));
  const r = show(ctx, 'topics/long.md', { start: 10, lines: 60 });
  assert.ok(JSON.stringify(r).length <= 4000); assert.ok(r.excerpt.startsWith('10:'));
  assert.throws(() => show(ctx, '../outside.md'), /inside/u);
  assert.throws(() => show(ctx, 'topics/long.md', { lines: 61 }), /between 1 and 60/u);
  if (process.platform !== 'win32') {
    write(path.join(base, 'outside.md'), 'private'); fs.symlinkSync(path.join(base, 'outside.md'), path.join(root, 'topics', 'linked.md'));
    assert.throws(() => show(ctx, 'topics/linked.md'), /symbolic-link/u);
    assert.equal(search(ctx, 'private').hits.length, 0);
  }
});

test('filesystem scans expose partial results rather than pretending to scan everything', t => {
  const { root } = fixture(t);
  for (let i = 0; i < 10; i++) write(path.join(root, 'topics', `${i}.md`), '# Note');
  const r = walkMarkdown(path.join(root, 'topics'), 3);
  assert.equal(r.files.length, 3); assert.equal(r.partial, true);
});

test('maintenance previews exact duplicates, stale facts and possible conflicts without changing notes', t => {
  const { ctx, root } = fixture(t);
  const text = '---\nstatus: verified\nscope: project-a\nlast_verified: 2020-01-01\n---\n# Java setup\nUse version 21.\n';
  write(path.join(root, 'topics', 'java.md'), text); write(path.join(root, 'inbox', 'copy.md'), text);
  write(path.join(root, 'inbox', 'different.md'), text.replace('21', '17'));
  const r = previewMaintenance(ctx, { archiveDuplicates: true, reindex: true, now: new Date('2026-10-18') });
  assert.equal(r.duplicates.length, 1); assert.ok(r.stale.length >= 2); assert.equal(r.possibleConflicts.length, 1);
  assert.ok(fs.existsSync(path.join(root, 'inbox', 'copy.md')));
  assert.ok(JSON.stringify(r).length <= 8000);
  const applied = applyMaintenance(ctx, r.planId);
  assert.equal(applied.notesDeleted, 0); assert.equal(fs.existsSync(path.join(root, 'inbox', 'copy.md')), false);
  assert.ok(fs.existsSync(path.join(root, 'inbox', 'different.md')));
  assert.equal(fs.readdirSync(path.join(root, '.archive')).length, 1);
  assert.ok(read(path.join(root, 'INDEX.md')).includes('agent-memory:shelf:start'));
});

test('maintenance refuses stale previews and keeps manual index text', t => {
  const { ctx, root } = fixture(t);
  write(path.join(root, 'INDEX.md'), '# My manual shelf\nKeep this line.\n');
  const r = previewMaintenance(ctx, { reindex: true });
  fs.appendFileSync(path.join(root, 'INDEX.md'), 'A later edit\n');
  assert.throws(() => applyMaintenance(ctx, r.planId), /changed since/u);
  const next = previewMaintenance(ctx, { reindex: true }); applyMaintenance(ctx, next.planId);
  assert.ok(read(path.join(root, 'INDEX.md')).includes('Keep this line.'));
  assert.ok(read(path.join(root, 'INDEX.md')).includes('A later edit'));
});

test('maintenance preserves whitespace differences that can change code or Markdown meaning', t => {
  const { ctx, root } = fixture(t);
  write(path.join(root, 'topics', 'code.md'), '# Example\n```python\nif ready:\n    run()\n```\n');
  write(path.join(root, 'inbox', 'code.md'), '# Example\n```python\nif ready:\nrun()\n```\n');
  const r = previewMaintenance(ctx, { archiveDuplicates: true });
  assert.equal(r.duplicates.length, 0);
  assert.equal(r.actions.length, 0);
  assert.equal(r.possibleConflicts.length, 1);
});

test('duplicate notes with identical basenames get distinct archive destinations', t => {
  const { ctx, root } = fixture(t);
  for (const name of ['a', 'b', 'c']) write(path.join(root, 'inbox', name, 'same.md'), '# Identical\nSame evidence.');
  const r = previewMaintenance(ctx, { archiveDuplicates: true }); applyMaintenance(ctx, r.planId);
  assert.equal(fs.readdirSync(path.join(root, '.archive')).length, 2);
});

test('personal project connection preserves instructions and uses local Git excludes for new files', t => {
  const { ctx, home } = fixture(t), project = path.join(home, 'Project'); fs.mkdirSync(project);
  assert.equal(spawnSync('git', ['init', project], { encoding: 'utf8' }).status, 0);
  const preview = planProject(ctx, project); assert.ok(preview.changes.length >= 2);
  connectProject(ctx, project);
  assert.ok(read(path.join(project, 'AGENTS.md')).includes('Do NOT preload'));
  assert.ok(read(path.join(project, '.git', 'info', 'exclude')).includes('/AGENTS.md'));
  assert.equal(planProject(ctx, project).changes.length, 0);
  fs.appendFileSync(path.join(project, 'AGENTS.md'), '\n# My later instructions\n');
  connectProject(ctx, project, { remove: true });
  assert.ok(read(path.join(project, 'AGENTS.md')).includes('My later instructions'));
  assert.ok(!read(path.join(project, 'AGENTS.md')).includes('agent-memory:managed:start'));
});

test('global uninstall disconnects owned projects, keeps notes, and preserves later Git excludes', t => {
  const { ctx, root, home } = fixture(t), project = path.join(home, 'Project'); fs.mkdirSync(project);
  spawnSync('git', ['init', project]); connectProject(ctx, project);
  fs.appendFileSync(path.join(project, '.git', 'info', 'exclude'), '\nmy-later-file\n');
  uninstall(ctx);
  assert.equal(fs.existsSync(path.join(project, 'AGENTS.md')), false);
  assert.ok(read(path.join(project, '.git', 'info', 'exclude')).includes('my-later-file'));
  assert.ok(!read(path.join(project, '.git', 'info', 'exclude')).includes('/AGENTS.md'));
  assert.ok(fs.existsSync(path.join(root, 'MEMORY.md')));
});

test('manual evidence is attributed and becomes stale when the policy changes', t => {
  const { ctx, root } = fixture(t, ['opencode']);
  prepareTest(ctx, { agent: 'opencode' }); const p = probe(ctx);
  write(path.join(root, 'inbox', 'receipt.md'), `test-only user-stated ${p.label}`); checkTest(ctx, p.phrase); cleanTest(ctx);
  let c = doctor(ctx).connections[0]; assert.equal(c.read, 'verified'); assert.equal(c.write, 'verified');
  assert.ok(c.evidence.includes('manual'));
  fs.appendFileSync(path.join(root, 'MEMORY.md'), '\nA policy edit');
  c = doctor(ctx).connections[0]; assert.equal(c.stale, true); assert.equal(c.read, 'unverified');
});

test('live verification requires opt-in and grades final answers rather than tool output', async t => {
  const { ctx, root } = fixture(t, ['opencode']);
  await assert.rejects(() => verifyLive(ctx, 'opencode'), /Opt in/u);
  let calls = 0;
  const runner = async () => {
    const p = probe(ctx); calls++;
    if (calls === 2) write(path.join(root, 'inbox', 'live-receipt.md'), `test-only user-stated ${p.label}`);
    return { code: 0, output: JSON.stringify({ type: 'text', part: { text: calls === 1 ? p.phrase : 'Saved' } }) };
  };
  const r = await verifyLive(ctx, 'opencode', { live: true, runner });
  assert.equal(r.ok, true); assert.equal(calls, 2);
  assert.equal(doctor(ctx).connections[0].write, 'verified');
  assert.equal(fs.readdirSync(path.join(root, 'inbox')).filter(x => x.endsWith('.md')).length, 0);
  assert.equal(finalText('codex', JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'fake answer' } })), '');
});

test('an unavailable live CLI is not reported as verified and leaves no active probe', async t => {
  const { ctx } = fixture(t, ['claude']);
  const r = await verifyLive(ctx, 'claude', { live: true, runner: async () => ({ code: null, output: '', reason: 'CLI unavailable' }) });
  assert.equal(r.read, 'unavailable'); assert.equal(r.write, 'skipped'); assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(ctx.configDir, 'probe.json')), false);
});

test('runner arguments never bypass permissions or put prompts through a shell', () => {
  for (const a of ['codex', 'claude', 'opencode']) {
    const r = invocation(a, path.resolve('notes'), 'test prompt', true);
    assert.ok(!r.args.some(x => /bypass|--auto$/u.test(x)));
    assert.equal(r.args.at(-1), 'test prompt');
  }
});

test('live verification refuses real agents in isolated homes and safely records runner failures', async t => {
  const { ctx } = fixture(t, ['opencode']);
  await assert.rejects(() => verifyLive(ctx, 'opencode', { live: true }), /OS-user context/u);
  const r = await verifyLive(ctx, 'opencode', { live: true, runner: async () => { throw new Error('private provider response'); } });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('private provider response'));
  assert.equal(fs.existsSync(path.join(ctx.configDir, 'probe.json')), false);
  assert.equal(doctor(ctx).connections[0].read, 'failed');
  assert.ok(failureHint('401 api_key_expired SECRET').includes('expired API key'));
  assert.ok(!failureHint('401 api_key_expired SECRET').includes('SECRET'));
});

test('live runner times out without invoking any model', async () => {
  const r = await runCommand({ command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] }, { cwd: os.tmpdir(), env: process.env, timeout: 50 });
  assert.ok(r.reason.includes('time limit'));
});

test('loopback UI requires a private token, blocks cross-origin requests, and previews no config contents', async t => {
  const { ctx, opts } = fixture(t);
  const ui = await serveUI(ctx, { open: false, folderPicker: async () => opts.memoryDir });
  t.after(() => ui.close());
  let r = await fetch(ui.origin + '/api/status'); assert.equal(r.status, 401);
  r = await fetch(ui.origin + '/api/status', { headers: { Authorization: 'Bearer ' + ui.token, Origin: 'https://example.com' } }); assert.equal(r.status, 403);
  r = await fetch(ui.url); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  const request = (route, body) => fetch(ui.origin + '/api/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + ui.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  r = await request('preview', { memoryDir: opts.memoryDir, agents: ['opencode'] }); const p = await r.json();
  assert.ok(p.previewId); assert.ok(!JSON.stringify(p).includes('before'));
  fs.appendFileSync(targets(ctx).opencode, '\nA concurrent user edit\n');
  r = await request('install', { previewId: p.previewId }); assert.equal(r.status, 400);
  r = await request('pick-folder', {}); assert.equal((await r.json()).path, opts.memoryDir);
  r = await request('verify', { agent: 'opencode', live: false }); assert.equal(r.status, 400);
  r = await request('install', { previewId: 'invented' }); assert.equal(r.status, 400);
});

test('CLI bounded lookup and policy upgrade options work in an isolated home', t => {
  const { ctx, root, opts, home } = fixture(t, ['opencode']);
  write(path.join(root, 'topics', 'java.md'), '# Java runner\nUse a matching environment.');
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), AGENT_MEMORY_CONFIG_DIR: ctx.configDir, XDG_CONFIG_HOME: path.join(home, '.config') };
  const run = args => { const r = spawnSync(process.execPath, [cli, ...args, '--json'], { env, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  assert.equal(run(['search', 'java runner']).hits.length, 1);
  assert.ok(run(['show', 'topics/java.md', '--lines', '2']).excerpt.includes('Java runner'));
  assert.equal(run(['setup', '--agents', 'opencode', '--memory-dir', opts.memoryDir, '--upgrade-policy', '--yes']).applied, true);
  const result = run(['maintain', '--reindex']); assert.ok(result.planId);
  assert.equal(run(['maintain', '--apply', '--plan', result.planId, '--yes']).notesDeleted, 0);
});
