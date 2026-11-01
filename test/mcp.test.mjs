import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { context, install, load } from '../src/core.mjs';
import { createMemoryTools } from '../src/mcp.mjs';

const cli = fileURLToPath(new URL('../bin/agent-memory.mjs', import.meta.url));
const lesson = { title: 'Java runner setup', scope: 'fictional project / Java 21', status: 'user-stated', symptom: 'The fictional runner needs a compatible environment.', cause: 'Documented project requirement.', fix: 'Use the documented Java 21 environment.', evidence: 'Synthetic user-stated test preference; no real procedure tested.', source: 'Isolated test fixture' };
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-mcp-'))), home = path.join(base, 'home'); fs.mkdirSync(home);
  const ctx = context({ home, configDir: path.join(base, 'state') });
  const root = path.join(home, 'Memory'); install(ctx, { agents: ['codex'], memoryDir: root });
  t.after(() => fs.rmSync(base, { force: true, recursive: true })); return { base, home, ctx, root };
}
const noteCount = root => fs.readdirSync(path.join(root, 'inbox')).filter(n => n.endsWith('.md')).length;

for (const mode of ['auto', 'legacy']) test(`real stdio MCP ${mode}: discovery, bounded drilldown, fresh refresh and capture/reuse`, async t => {
  const { home, ctx, root } = fixture(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), XDG_CONFIG_HOME: path.join(home, '.config'), AGENT_MEMORY_CONFIG_DIR: ctx.configDir };
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--allow-write'], env, stderr: 'pipe' });
  let errors = ''; transport.stderr?.on('data', d => { errors += d.toString(); });
  const client = new Client({ name: 'isolated-memory-test', version: '1' }, { versionNegotiation: mode === 'auto' ? { mode: 'auto' } : { mode: 'legacy' } });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getNegotiatedProtocolVersion(), mode === 'auto' ? '2026-07-28' : '2025-11-25');
  const listed = await client.listTools(); assert.equal(listed.tools.length, 4);
  assert.ok(listed.tools.find(t => t.name === 'memory_search').annotations.readOnlyHint);
  const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
  const before = await call('memory_refresh'); assert.equal(before.counts.inbox, 0); assert.ok(!JSON.stringify(before).includes('Documented project'));
  const preview = await call('memory_remember', { lesson }); assert.equal(preview.status, 'review_required'); assert.equal(noteCount(root), 0);
  const saved = await call('memory_remember', { review_id: preview.review_id, decision: 'save_new' });
  assert.equal(saved.saved, true); assert.ok(saved.path.startsWith('inbox/')); assert.equal(noteCount(root), 1);
  const first = await call('memory_search', { query: 'java runner' }); assert.equal(first.hits.length, 1); assert.ok(JSON.stringify(first).length <= 4000);
  const page = await call('memory_read', { path: saved.path, start: 1, lines: 8 }); assert.ok(page.excerpt.includes('Java runner')); assert.equal(page.lines, 8);
  const next = await call('memory_read', { path: saved.path, start: 9, lines: 8 }); assert.ok(!next.excerpt.includes('1: ---')); assert.ok(next.excerpt.includes('runner'));
  const after = await call('memory_refresh'); assert.equal(after.counts.inbox, 1); assert.notEqual(before.revision, after.revision);
  const duplicate = await call('memory_remember', { lesson: { ...lesson, title: 'Java runner environment' } }); assert.equal(duplicate.candidates.length, 1);
  const reused = await call('memory_remember', { review_id: duplicate.review_id, decision: 'reuse_existing', existing_path: saved.path }); assert.equal(reused.saved, false); assert.equal(noteCount(root), 1);
  const bad = await client.callTool({ name: 'memory_read', arguments: { path: '../outside.md' } }); assert.equal(bad.isError, true);
  const invalid = await client.callTool({ name: 'memory_search', arguments: { query: 'java', limit: 999 } }); assert.equal(invalid.isError, true);
  assert.equal(errors, '');
});

test('read-only server cannot prepare or save a lesson', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx);
  assert.throws(() => tools.memory_remember.run({ lesson }), /read-only/u); assert.equal(noteCount(root), 0);
  assert.equal(tools.memory_refresh.run({}).write_enabled, false);
});

test('capture requires review, rejects stale changes across agents, and never overwrites existing notes', t => {
  const { ctx, root } = fixture(t), first = createMemoryTools(ctx, { allowWrite: true }), second = createMemoryTools(ctx, { allowWrite: true });
  const a = first.memory_remember.run({ lesson }), b = second.memory_remember.run({ lesson });
  assert.throws(() => first.memory_remember.run({ review_id: a.review_id }), /decision/u);
  const saved = first.memory_remember.run({ review_id: a.review_id, decision: 'save_new' });
  const content = fs.readFileSync(path.join(root, saved.path), 'utf8');
  assert.throws(() => second.memory_remember.run({ review_id: b.review_id, decision: 'save_new' }), /changed after preview/u);
  assert.throws(() => first.memory_remember.run({ review_id: a.review_id, decision: 'save_new' }), /expired/u);
  assert.equal(fs.readFileSync(path.join(root, saved.path), 'utf8'), content); assert.equal(noteCount(root), 1);
});

test('review tokens expire and are bound to the unchanged policy and configured notebook', t => {
  const { ctx, root } = fixture(t); let time = Date.now(); const tools = createMemoryTools(ctx, { allowWrite: true, now: () => time });
  const a = tools.memory_remember.run({ lesson }); time += 16 * 60000;
  assert.throws(() => tools.memory_remember.run({ review_id: a.review_id, decision: 'save_new' }), /expired/u);
  const b = tools.memory_remember.run({ lesson }); fs.appendFileSync(path.join(root, 'MEMORY.md'), '\nChanged policy');
  assert.throws(() => tools.memory_remember.run({ review_id: b.review_id, decision: 'save_new' }), /changed after preview/u);
  assert.equal(noteCount(root), 0);
});

test('reuse requires matching scope; useful differences create new linked notes and preserve originals', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const a = tools.memory_remember.run({ lesson }); const saved = tools.memory_remember.run({ review_id: a.review_id, decision: 'save_new' });
  const original = fs.readFileSync(path.join(root, saved.path), 'utf8');
  const b = tools.memory_remember.run({ lesson: { ...lesson, scope: 'other environment / Java 17' } });
  assert.throws(() => tools.memory_remember.run({ review_id: b.review_id, decision: 'reuse_existing', existing_path: saved.path }), /Scope differs/u);
  const c = tools.memory_remember.run({ lesson: { ...lesson, fix: 'For this fictional project only, also set its documented runner option.' } });
  const added = tools.memory_remember.run({ review_id: c.review_id, decision: 'save_difference', existing_path: saved.path });
  assert.ok(fs.readFileSync(path.join(root, added.path), 'utf8').includes(saved.path)); assert.equal(fs.readFileSync(path.join(root, saved.path), 'utf8'), original);
});

test('oversized lessons, apparent credentials, traversal and linked inbox paths cannot be written', t => {
  const { ctx, root, base } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  assert.throws(() => tools.memory_remember.run({ lesson: { ...lesson, fix: 'word '.repeat(190) } }), /180/u);
  assert.throws(() => tools.memory_remember.run({ lesson: { ...lesson, fix: 'https://user:password@example.com' } }), /credentials/u);
  const a = tools.memory_remember.run({ lesson });
  assert.throws(() => tools.memory_remember.run({ review_id: a.review_id, decision: 'reuse_existing', existing_path: '../outside.md' }), /existing visible/u);
  if (process.platform !== 'win32') {
    fs.renameSync(path.join(root, 'inbox'), path.join(base, 'old-inbox'));
    fs.symlinkSync(path.join(base, 'old-inbox'), path.join(root, 'inbox'));
    assert.throws(() => tools.memory_remember.run({ review_id: a.review_id, decision: 'save_new' }), /symbolic-link/u);
  }
  assert.ok(load(ctx));
});


test('connection snippets are read-only by default, contain an absolute runnable command, and change no configs', t => {
  const { home, ctx, root } = fixture(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENT_MEMORY_CONFIG_DIR: ctx.configDir };
  const before = fs.readFileSync(path.join(ctx.configDir, 'state.json'), 'utf8');
  for (const write of [false, true]) {
    const r = spawnSync(process.execPath, [cli, 'mcp-config', ...(write ? ['--allow-write'] : [])], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const config = JSON.parse(r.stdout).mcpServers['agent-memory'];
    assert.ok(path.isAbsolute(config.command)); assert.ok(path.isAbsolute(config.args[0]));
    assert.equal(config.args.includes('--allow-write'), write);
    assert.equal(config.env.AGENT_MEMORY_CONFIG_DIR, ctx.configDir);
  }
  assert.equal(fs.readFileSync(path.join(ctx.configDir, 'state.json'), 'utf8'), before);
  assert.equal(noteCount(root), 0);
});

test('real read-only MCP rejects writes without creating a probe, lock, or note', async t => {
  const { home, ctx, root } = fixture(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], env: { ...process.env, HOME: home, USERPROFILE: home, AGENT_MEMORY_CONFIG_DIR: ctx.configDir }, stderr: 'pipe' });
  const client = new Client({ name: 'read-only-test', version: '1' }); t.after(() => client.close());
  await client.connect(transport);
  const r = await client.callTool({ name: 'memory_remember', arguments: { lesson } });
  assert.equal(r.isError, true); assert.ok(r.content[0].text.includes('read-only'));
  assert.equal(noteCount(root), 0); assert.equal(fs.existsSync(path.join(ctx.configDir, 'operation.lock')), false);
  assert.equal(fs.existsSync(path.join(ctx.configDir, 'probe.json')), false);
});


test('an identical generated lesson among candidates is reused even if the caller requests save_new', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const a = tools.memory_remember.run({ lesson }); const first = tools.memory_remember.run({ review_id: a.review_id, decision: 'save_new' });
  const b = tools.memory_remember.run({ lesson }); const second = tools.memory_remember.run({ review_id: b.review_id, decision: 'save_new' });
  assert.equal(second.status, 'reused'); assert.equal(second.path, first.path); assert.equal(noteCount(root), 1);
});

test('secrets scan refuses common credential shapes without echoing them', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const samples = {
    'private key': '-----BEGIN RSA PRIVATE KEY-----',
    'AWS access key': 'Use AKIAABCDEFGHIJKLMNOP for the bucket.',
    'API token': 'Set ghp_abcdefghijklmnopqrstuvwxyz0123456789 first.',
    'bearer token': 'Send Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'password or key assignment': 'Then export DB_PASSWORD=hunter2hunter2',
  };
  for (const [kind, fix] of Object.entries(samples)) {
    assert.throws(() => tools.memory_remember.run({ lesson: { ...lesson, fix } }), error => error.message.includes(kind) && !error.message.includes(fix.split(' ').at(-1)));
  }
  assert.throws(() => tools.memory_remember.run({ lesson: { ...lesson, title: 'api_key: "abcd1234efgh5678"' } }), /credentials/u);
  assert.equal(noteCount(root), 0);
});

test('secrets scan does not flag ordinary prose, placeholders or short values', t => {
  const { ctx } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const fixes = [
    'Rotate the password every quarter and keep the token in the vault.',
    'The token: expired, so request a new one.',
    'Set password=$DB_PASSWORD from the environment.',
    'Use max_tokens: 100000 for the long summaries.',
    'Store the api_key = <your key here> in the keychain.',
    'Run the sk-learn style skill check on AKIA documentation pages.',
  ];
  for (const fix of fixes) assert.equal(tools.memory_remember.run({ lesson: { ...lesson, fix } }).status, 'review_required', fix);
});

test('preview surfaces advisory same-scope overlap without overriding save_new', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const a = tools.memory_remember.run({ lesson }); assert.equal(a.overlaps, undefined);
  const first = tools.memory_remember.run({ review_id: a.review_id, decision: 'save_new' });
  const reworded = { ...lesson, evidence: lesson.evidence + ' Checked.' };
  const b = tools.memory_remember.run({ lesson: reworded });
  assert.equal(b.overlaps[0].path, first.path); assert.ok(b.overlaps[0].overlap >= 0.9, JSON.stringify(b.overlaps));
  const saved = tools.memory_remember.run({ review_id: b.review_id, decision: 'save_new' });
  assert.equal(saved.status, 'saved'); assert.notEqual(saved.path, first.path); assert.equal(noteCount(root), 2);
});

test('overlap check keeps different scopes, changed versions and deliberate differences', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const save = l => { const p = tools.memory_remember.run({ lesson: l }); return { p, r: tools.memory_remember.run({ review_id: p.review_id, decision: 'save_new' }) }; };
  save({ ...lesson, fix: 'Use the documented Java 21 environment for the runner.' });
  const other = tools.memory_remember.run({ lesson: { ...lesson, scope: 'other project / Java 21', fix: 'Use the documented Java 21 environment for the runner.' } });
  assert.equal(other.overlaps, undefined);
  assert.equal(tools.memory_remember.run({ review_id: other.review_id, decision: 'save_new' }).saved, true);
  const version = tools.memory_remember.run({ lesson: { ...lesson, fix: 'Use the documented Java 17 environment for the runner.' } });
  assert.equal(version.overlaps[0].same_numbers, false);
  assert.equal(tools.memory_remember.run({ review_id: version.review_id, decision: 'save_new' }).saved, true);
  assert.equal(noteCount(root), 3);
  const same = tools.memory_remember.run({ lesson: { ...lesson, fix: 'Use the documented Java 21 environment for the runner.' } });
  assert.equal(tools.memory_remember.run({ review_id: same.review_id, decision: 'save_difference', existing_path: same.overlaps[0].path }).saved, true);
  assert.equal(noteCount(root), 4);
});


test('high lexical overlap preserves negation, version structure and changed metadata', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const original = { ...lesson, fix: 'Use runtime 1.2 for the documented runner setup.' };
  const save = value => {
    const preview = tools.memory_remember.run({ lesson: value });
    const result = tools.memory_remember.run({ review_id: preview.review_id, decision: 'save_new' });
    assert.equal(result.status, 'saved');
    return preview;
  };
  save(original);
  const version = save({ ...original, fix: original.fix.replace('1.2', '2.1') });
  assert.equal(version.overlaps[0].same_numbers, false);
  save({ ...original, fix: 'Do not ' + original.fix });
  save({ ...original, status: 'verified' });
  save({ ...original, source: 'New independent review evidence' });
  assert.equal(noteCount(root), 5);
});

test('real stdio capture refuses alphabetic credentials and preserves changed versions', async t => {
  const { home, ctx } = fixture(t);
  const env = { ...process.env, HOME: home, USERPROFILE: home, AGENT_MEMORY_CONFIG_DIR: ctx.configDir };
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp', '--allow-write'], env, stderr: 'pipe' });
  const client = new Client({ name: 'capture-regression', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  for (const fix of ['password="correcthorsebatterystaple"', 'api_key=alphabeticliteral', 'password: alphabeticliteral', 'password=abcd,efgh', 'password="long pass phrase"']) {
    const result = await client.callTool({ name: 'memory_remember', arguments: { lesson: { ...lesson, fix } } });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes('alphabeticliteral'));
    assert.ok(!JSON.stringify(result).includes('correcthorsebatterystaple'));
  }
  for (const fix of ['Use runtime 1.2 for the runner.', 'Use runtime 2.1 for the runner.']) {
    const preview = await client.callTool({ name: 'memory_remember', arguments: { lesson: { ...lesson, fix } } });
    assert.ok(!preview.isError, JSON.stringify(preview));
    const { review_id } = JSON.parse(preview.content[0].text);
    const saved = await client.callTool({ name: 'memory_remember', arguments: { review_id, decision: 'save_new' } });
    assert.ok(!saved.isError, JSON.stringify(saved));
    assert.equal(JSON.parse(saved.content[0].text).status, 'saved');
  }
});

test('overlap never invites reuse when only source or status differs, but exact duplicates still reuse', t => {
  const { ctx, root } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  const p = tools.memory_remember.run({ lesson }); const first = tools.memory_remember.run({ review_id: p.review_id, decision: 'save_new' });
  for (const [change, flag] of [[{ source: 'A different documented source' }, 'same_source'], [{ status: 'unverified' }, 'same_status']]) {
    const b = tools.memory_remember.run({ lesson: { ...lesson, ...change } });
    const o = b.overlaps.find(x => x.path === first.path); assert.equal(o.overlap, 1); assert.equal(o[flag], false);
    const saved = tools.memory_remember.run({ review_id: b.review_id, decision: 'save_new' });
    assert.equal(saved.saved, true, flag);
  }
  assert.equal(noteCount(root), 3);
  const exact = tools.memory_remember.run({ lesson });
  const eo = exact.overlaps.find(x => x.path === first.path); assert.equal(eo.same_status && eo.same_source, true);
  assert.equal(tools.memory_remember.run({ review_id: exact.review_id, decision: 'save_new' }).status, 'reused'); assert.equal(noteCount(root), 3);
});

test('secrets scan ignores env references, calls and plain words in lessons', t => {
  const { ctx } = fixture(t), tools = createMemoryTools(ctx, { allowWrite: true });
  for (const fix of ['password: process.env.PASSWORD', 'password: getPassword(),', 'secret: required', 'tokenizer: whitespace-based'])
    assert.equal(tools.memory_remember.run({ lesson: { ...lesson, fix } }).status, 'review_required', fix);
  for (const fix of ['password: "correcthorsebatterystaple"', "token='abcdefghijkl'"])
    assert.throws(() => tools.memory_remember.run({ lesson: { ...lesson, fix } }), /credentials/u, fix);
});
