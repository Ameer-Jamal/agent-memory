import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, targets, install, planSetup, planUninstall, uninstall, doctor, instructions, prepareTest, checkTest, cleanTest, detect, discoverObsidian } from '../src/core.mjs';
import { START, END } from '../src/templates.mjs';

const cli = fileURLToPath(new URL('../bin/agent-memory.mjs', import.meta.url));
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-')));
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  const ctx = context({ home, configDir: path.join(base, 'private-state') });
  const opts = { memoryDir: path.join(home, 'Notes with spaces', 'Agent Memory'), agents: ['codex', 'claude', 'cursor', 'antigravity'] };
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, home, ctx, opts };
}
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

test('plain-folder setup preserves existing instructions, uses private state, and is idempotent', t => {
  const { ctx, opts } = fixture(t), p = targets(ctx).claude;
  write(p, '# My instructions\nKeep this exactly.\n');
  install(ctx, opts);
  const first = fs.readFileSync(p, 'utf8');
  assert.ok(first.startsWith('# My instructions\nKeep this exactly.\n'));
  assert.ok(first.includes(opts.memoryDir.replaceAll('\\', '/')));
  assert.equal(planSetup(ctx, opts).changes.length, 0);
  install(ctx, opts);
  assert.equal(fs.readFileSync(p, 'utf8'), first);
  assert.equal(doctor(ctx).ok, true);
  assert.equal(doctor(ctx).checks.filter(c => c.status === 'manual').length, 3);
  assert.ok(fs.existsSync(path.join(ctx.configDir, 'backups')));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(ctx.configDir, 'state.json')).mode & 0o777, 0o600);
});

test('dry planning does not create notes, configs, state, or backups', t => {
  const { ctx, opts } = fixture(t);
  assert.ok(planSetup(ctx, opts).changes.length > 4);
  assert.equal(fs.existsSync(opts.memoryDir), false);
  assert.equal(fs.existsSync(ctx.configDir), false);
  assert.equal(fs.existsSync(targets(ctx).codex), false);
});

test('uninstall restores unchanged configs exactly and keeps all notes', t => {
  const { ctx, opts } = fixture(t), original = '# Rules\r\nExisting text\r\n';
  write(targets(ctx).codex, original);
  install(ctx, opts);
  write(path.join(opts.memoryDir, 'inbox', 'real-lesson.md'), '# A real lesson');
  uninstall(ctx);
  assert.equal(fs.readFileSync(targets(ctx).codex, 'utf8'), original);
  assert.equal(fs.existsSync(targets(ctx).claude), false);
  assert.equal(fs.readFileSync(path.join(opts.memoryDir, 'inbox', 'real-lesson.md'), 'utf8'), '# A real lesson');
  assert.equal(fs.existsSync(path.join(ctx.configDir, 'state.json')), false);
});

test('uninstall preserves user edits made after setup', t => {
  const { ctx, opts } = fixture(t);
  write(targets(ctx).claude, '# Before\n'); install(ctx, opts);
  fs.appendFileSync(targets(ctx).claude, '\n# Added later\nKeep this too.\n');
  uninstall(ctx);
  const text = fs.readFileSync(targets(ctx).claude, 'utf8');
  assert.ok(text.includes('# Before')); assert.ok(text.includes('# Added later'));
  assert.ok(!text.includes(START)); assert.ok(!text.includes(END));
});

test('reinstall preserves curated memory and can add agents', t => {
  const { ctx, opts } = fixture(t);
  install(ctx, { ...opts, agents: ['codex'] });
  write(path.join(opts.memoryDir, 'INDEX.md'), '# My curated index\n');
  install(ctx, { ...opts, agents: ['claude'] });
  assert.equal(fs.readFileSync(path.join(opts.memoryDir, 'INDEX.md'), 'utf8'), '# My curated index\n');
  assert.ok(fs.existsSync(targets(ctx).codex)); assert.ok(fs.existsSync(targets(ctx).claude));
});

test('reinstall never adopts later user edits that uninstall would erase', t => {
  const { ctx, opts } = fixture(t), p = targets(ctx).claude;
  write(p, '# Original\n'); install(ctx, opts);
  fs.appendFileSync(p, '\n# My later preference\nKeep me.\n');
  install(ctx, opts); uninstall(ctx);
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(text.includes('# Original')); assert.ok(text.includes('# My later preference'));
  assert.ok(!text.includes(START));
});

test('Claude capture permission is scoped, opt-in, idempotent, and preserves later settings', t => {
  const { ctx, opts } = fixture(t), p = path.join(ctx.home, '.claude', 'settings.json');
  write(p, JSON.stringify({ theme: 'dark', permissions: { deny: ['Read(~/.ssh/**)'] } }));
  install(ctx, opts);
  assert.equal(JSON.parse(fs.readFileSync(p)).permissions.allow, undefined);
  install(ctx, { ...opts, allowCapture: true });
  install(ctx, { ...opts, allowCapture: true });
  const settings = JSON.parse(fs.readFileSync(p));
  assert.equal(settings.permissions.allow.length, 1);
  assert.ok(settings.permissions.allow[0].startsWith('Edit(//'));
  assert.ok(settings.permissions.allow[0].endsWith('/inbox/*.md)'));
  settings.language = 'English'; settings.permissions.allow.push('Read(~/Public/**)');
  write(p, JSON.stringify(settings)); uninstall(ctx);
  const after = JSON.parse(fs.readFileSync(p));
  assert.equal(after.language, 'English'); assert.equal(after.theme, 'dark');
  assert.deepEqual(after.permissions.allow, ['Read(~/Public/**)']);
  assert.deepEqual(after.permissions.deny, ['Read(~/.ssh/**)']);
});

test('pre-existing capture permission belongs to the user and survives uninstall', t => {
  const { ctx, opts } = fixture(t), p = path.join(ctx.home, '.claude', 'settings.json');
  install(ctx, { ...opts, allowCapture: true });
  const settings = fs.readFileSync(p, 'utf8'); uninstall(ctx);
  write(p, settings); install(ctx, { ...opts, allowCapture: true }); uninstall(ctx);
  assert.equal(fs.readFileSync(p, 'utf8'), settings);
});

test('invalid Claude JSON prevents every setup write', t => {
  const { ctx, opts } = fixture(t);
  write(path.join(ctx.home, '.claude', 'settings.json'), '{ bad json');
  assert.throws(() => install(ctx, { ...opts, allowCapture: true }), /not valid JSON/u);
  assert.equal(fs.existsSync(opts.memoryDir), false); assert.equal(fs.existsSync(targets(ctx).codex), false);
});

test('unsupported Claude permission shapes fail before writing', t => {
  const { ctx, opts } = fixture(t);
  write(path.join(ctx.home, '.claude', 'settings.json'), '{"permissions":{"allow":"all"}}');
  assert.throws(() => install(ctx, { ...opts, allowCapture: true }), /unsupported shape/u);
  assert.equal(fs.existsSync(opts.memoryDir), false);
});

test('capture permissions never turn path punctuation into a broader glob', t => {
  const { ctx, opts } = fixture(t);
  const memoryDir = opts.memoryDir + '[personal]';
  assert.throws(() => install(ctx, { ...opts, memoryDir, allowCapture: true }), /wildcard punctuation/u);
  assert.equal(fs.existsSync(memoryDir), false);
});

test('existing note files are not overwritten or silently adopted', t => {
  const { ctx, opts } = fixture(t);
  write(path.join(opts.memoryDir, 'INDEX.md'), 'Existing notebook');
  assert.throws(() => install(ctx, opts), /already contains INDEX/u);
  assert.equal(fs.readFileSync(path.join(opts.memoryDir, 'INDEX.md'), 'utf8'), 'Existing notebook');
  assert.equal(fs.existsSync(targets(ctx).codex), false);
});

test('rejects relocation, unknown agents, home root, and line-break injection', t => {
  const { ctx, opts } = fixture(t);
  assert.throws(() => planSetup(ctx, { ...opts, agents: ['unknown'] }), /Unknown agent/u);
  assert.throws(() => planSetup(ctx, { ...opts, memoryDir: ctx.home }), /dedicated/u);
  assert.throws(() => planSetup(ctx, { ...opts, memoryDir: 'bad\npath' }), /line breaks/u);
  install(ctx, opts);
  assert.throws(() => planSetup(ctx, { ...opts, memoryDir: opts.memoryDir + '-other' }), /different folder/u);
});

test('rejects damaged, duplicate, edited, and unowned managed blocks', t => {
  const { ctx, opts } = fixture(t), p = targets(ctx).codex;
  write(p, START + '\nbroken'); assert.throws(() => planSetup(ctx, opts), /damaged/u);
  write(p, START + '\ntext\n' + END); assert.throws(() => planSetup(ctx, opts), /unmanaged/u);
  fs.unlinkSync(p); install(ctx, opts);
  fs.appendFileSync(p, START + '\nagain\n' + END);
  assert.throws(() => planUninstall(ctx), /duplicated/u);
});

test('a write failure rolls back already changed files', t => {
  const { ctx, opts } = fixture(t);
  write(targets(ctx).codex, '# Original\n');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to === targets(ctx).antigravity) throw new Error('Simulated disk write failure');
    return rename(from, to);
  });
  assert.throws(() => install(ctx, opts), /rolled back/u);
  assert.equal(fs.readFileSync(targets(ctx).codex, 'utf8'), '# Original\n');
  assert.equal(fs.existsSync(path.join(opts.memoryDir, 'MEMORY.md')), false);
  assert.equal(fs.existsSync(path.join(ctx.configDir, 'state.json')), false);
});

test('configuration symlinks and linked ancestors are refused', { skip: process.platform === 'win32' }, t => {
  const { base, ctx, opts } = fixture(t), outside = path.join(base, 'outside.md');
  write(outside, 'Do not touch'); fs.mkdirSync(path.dirname(targets(ctx).codex), { recursive: true });
  fs.symlinkSync(outside, targets(ctx).codex);
  assert.throws(() => install(ctx, opts), /symbolic-link/u);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'Do not touch');
});

test('a held operation lock blocks mutations', t => {
  const { ctx, opts } = fixture(t);
  fs.mkdirSync(path.join(ctx.configDir, 'operation.lock'), { recursive: true });
  assert.throws(() => install(ctx, opts), /Another operation/u);
  assert.equal(fs.existsSync(opts.memoryDir), false);
});

test('doctor reports missing files and Codex overrides without claiming model verification', t => {
  const { ctx, opts } = fixture(t);
  assert.equal(doctor(ctx).ok, false); install(ctx, opts);
  write(path.join(ctx.home, '.codex', 'AGENTS.override.md'), '# Override');
  assert.ok(doctor(ctx).checks.some(c => c.status === 'warn' && /override/u.test(c.label)));
  fs.unlinkSync(path.join(opts.memoryDir, 'INDEX.md')); assert.equal(doctor(ctx).ok, false);
});

test('manual challenge requires exact retrieval AND an actual new test-only capture', t => {
  const { ctx, opts } = fixture(t); install(ctx, opts);
  const prompts = prepareTest(ctx);
  const p = JSON.parse(fs.readFileSync(path.join(ctx.configDir, 'probe.json')));
  assert.ok(!prompts.readPrompt.includes(p.phrase)); assert.ok(!prompts.readPrompt.includes(opts.memoryDir));
  assert.equal(checkTest(ctx, 'guess').ok, false);
  assert.equal(checkTest(ctx, p.phrase).write, false);
  write(path.join(opts.memoryDir, 'inbox', 'receipt.md'), `# test-only\nstatus: user-stated\n${p.label}`);
  assert.equal(checkTest(ctx, p.phrase).ok, true);
  assert.throws(() => prepareTest(ctx), /already active/u);
  assert.throws(() => uninstall(ctx), /test is active/u);
  const cleaned = cleanTest(ctx); assert.equal(cleaned.removed.length, 2);
  assert.ok(fs.existsSync(path.join(opts.memoryDir, 'INDEX.md')));
});

test('test cleanup keeps real notes, modified fixtures, and changed receipts', t => {
  const { ctx, opts } = fixture(t); install(ctx, opts);
  write(path.join(opts.memoryDir, 'inbox', 'real.md'), 'A real note'); prepareTest(ctx);
  const p = JSON.parse(fs.readFileSync(path.join(ctx.configDir, 'probe.json')));
  write(path.join(opts.memoryDir, 'inbox', 'receipt.md'), `test-only user-stated ${p.label}`);
  checkTest(ctx, p.phrase);
  fs.appendFileSync(path.join(opts.memoryDir, 'inbox', p.fixture), '\nA later edit');
  fs.appendFileSync(path.join(opts.memoryDir, 'inbox', 'receipt.md'), '\nA later edit');
  const r = cleanTest(ctx); assert.equal(r.kept.length, 2); assert.equal(r.removed.length, 0);
  assert.ok(fs.existsSync(path.join(opts.memoryDir, 'inbox', 'real.md')));
});

test('detects existing agent folders and optional Obsidian vaults without changing them', t => {
  const { ctx } = fixture(t);
  fs.mkdirSync(path.join(ctx.home, '.cursor')); assert.deepEqual(detect(ctx), ['cursor']);
  const vault = path.join(ctx.home, 'My Vault'); fs.mkdirSync(vault);
  write(path.join(ctx.home, '.config', 'obsidian', 'obsidian.json'), JSON.stringify({ vaults: { id: { path: vault } } }));
  assert.deepEqual(discoverObsidian(ctx, 'linux'), [vault]);
});

test('can consult an existing notes source without copying it into memory', t => {
  const { ctx, opts } = fixture(t), source = path.join(ctx.home, 'Existing Notes');
  write(path.join(source, 'private.md'), 'This stays outside the new memory.');
  install(ctx, { ...opts, notesDir: source });
  assert.ok(fs.readFileSync(path.join(opts.memoryDir, 'MEMORY.md'), 'utf8').includes(source.replaceAll('\\', '/')));
  assert.equal(fs.existsSync(path.join(opts.memoryDir, 'private.md')), false);
  assert.ok(instructions(ctx, 'cursor').includes(opts.memoryDir.replaceAll('\\', '/')));
});

test('CLI help and dry-run JSON work without touching real user configs', t => {
  const { ctx, opts, base } = fixture(t);
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.ok(help.stdout.includes('Learn once'));
  const result = spawnSync(process.execPath, [cli, 'setup', '--agents', 'all', '--memory-dir', opts.memoryDir, '--dry-run', '--json'], { encoding: 'utf8', env: { ...process.env, AGENT_MEMORY_CONFIG_DIR: ctx.configDir, HOME: ctx.home, USERPROFILE: ctx.home, CODEX_HOME: path.join(ctx.home, '.codex') }, cwd: base });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).applied, false);
  assert.equal(fs.existsSync(opts.memoryDir), false);
  const bad = spawnSync(process.execPath, [cli, 'setup', '--wat'], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.ok(bad.stderr.includes('Unknown option'));
});

test('CLI completes setup, challenge, cleanup and uninstall in an isolated home', t => {
  const { ctx, opts, base } = fixture(t);
  const env = { ...process.env, HOME: ctx.home, USERPROFILE: ctx.home, CODEX_HOME: path.join(ctx.home, '.codex'), AGENT_MEMORY_CONFIG_DIR: ctx.configDir };
  const run = args => {
    const r = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: base, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  };
  assert.equal(run(['setup', '--agents', 'all', '--memory-dir', opts.memoryDir, '--yes', '--allow-capture']).applied, true);
  assert.equal(run(['doctor']).ok, true);
  assert.ok(run(['instructions', 'cursor']).instructions.includes(START));
  run(['test', 'prepare']);
  const p = JSON.parse(fs.readFileSync(path.join(ctx.configDir, 'probe.json')));
  write(path.join(opts.memoryDir, 'inbox', 'capture.md'), `test-only user-stated ${p.label}`);
  assert.equal(run(['test', 'check', '--answer', p.phrase]).ok, true);
  assert.equal(run(['test', 'clean', '--yes']).removed.length, 2);
  assert.equal(run(['uninstall', '--yes']).applied, true);
  assert.ok(fs.existsSync(path.join(opts.memoryDir, 'MEMORY.md')));
});
