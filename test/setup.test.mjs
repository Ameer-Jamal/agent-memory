import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { context, install, load, targets } from '../src/core.mjs';
import { search } from '../src/notebook.mjs';

const cli = fileURLToPath(new URL('../bin/agent-memory.mjs', import.meta.url));
function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-setup-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  const env = {
    ...process.env, HOME: home, USERPROFILE: home,
    CODEX_HOME: path.join(base, 'custom-codex'), XDG_CONFIG_HOME: path.join(base, 'custom-xdg'),
    COPILOT_HOME: path.join(base, 'custom-copilot'),
    AGENT_MEMORY_CONFIG_DIR: path.join(base, 'private-state'),
  };
  const ctx = context({ home, configDir: env.AGENT_MEMORY_CONFIG_DIR, env });
  // Exercise the real interactive CLI on all supported platforms without a PTY
  // dependency. Only the terminal input boundary is replaced with canned answers.
  const input = path.join(base, 'terminal-input.mjs');
  fs.writeFileSync(input, `
import readline from 'node:readline/promises';
import { syncBuiltinESMExports } from 'node:module';
Object.defineProperty(process.stdin, 'isTTY', { value: true });
const answers = JSON.parse(process.env.AGENT_MEMORY_SETUP_TEST_ANSWERS);
readline.createInterface = () => ({
  question: async prompt => {
    if (!answers.length) throw new Error('Unexpected setup prompt: ' + prompt);
    process.stdout.write(prompt + '\\n');
    return answers.shift();
  },
  close: () => {},
});
syncBuiltinESMExports();
`);
  const run = (answers, flags = []) => spawnSync(process.execPath, ['--import', pathToFileURL(input).href, cli, 'setup', ...flags], {
    cwd: base, env: { ...env, AGENT_MEMORY_SETUP_TEST_ANSWERS: JSON.stringify(answers) }, encoding: 'utf8', timeout: 10000,
  });
  return { base, home, ctx, run };
}

test('guided rerun keeps separate memory and notes folders while adding agents in custom config roots', t => {
  const { base, home, ctx, run } = fixture(t);
  const memoryDir = path.join(home, 'Notes with spaces', 'Shared Memory'), notesDir = path.join(base, 'Separate reference notes');
  fs.mkdirSync(notesDir); fs.writeFileSync(path.join(notesDir, 'reference.md'), '# External reference\nexternalneedle');
  install(ctx, { memoryDir, notesDir, agents: ['codex'] });
  const originalInstruction = fs.readFileSync(targets(ctx).codex, 'utf8'), originalPolicy = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8');
  const result = run(['', 'opencode,copilot', '', 'y']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Where should your memory live? [${memoryDir}]`));
  assert.ok(result.stdout.includes(`Existing Markdown notes folder (optional) [${notesDir}]`));
  const state = load(ctx);
  assert.equal(state.memoryDir, memoryDir); assert.equal(state.notesDir, notesDir);
  assert.deepEqual(state.agents, ['codex', 'opencode', 'copilot']);
  assert.equal(fs.readFileSync(targets(ctx).codex, 'utf8'), originalInstruction);
  assert.equal(fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8'), originalPolicy);
  for (const agent of state.agents) assert.ok(fs.readFileSync(targets(ctx)[agent], 'utf8').includes(memoryDir.replaceAll('\\', '/')));
  assert.equal(search(ctx, 'externalneedle', { source: 'notes' }).hits[0].path, 'reference.md');
  assert.equal(fs.existsSync(path.join(home, 'AgentMemory')), false);
  assert.equal(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.config', 'opencode', 'AGENTS.md')), false);
  const explicit = run(['y'], ['--agents', 'codex', '--memory-dir', memoryDir, '--notes-dir', notesDir]);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.ok(!explicit.stdout.includes('Where should your memory live?'));
  assert.ok(!explicit.stdout.includes('Existing Markdown notes folder'));
  const unchangedState = fs.readFileSync(path.join(ctx.configDir, 'state.json'), 'utf8');
  const changedSource = run([], ['--agents', 'codex', '--memory-dir', memoryDir, '--notes-dir', path.join(base, 'Other notes')]);
  assert.notEqual(changedSource.status, 0); assert.match(changedSource.stderr, /notes source changed/u);
  assert.equal(fs.readFileSync(path.join(ctx.configDir, 'state.json'), 'utf8'), unchangedState);
});

test('guided first install still defaults to AgentMemory with no optional notes folder', t => {
  const { home, ctx, run } = fixture(t);
  const result = run(['', 'codex', '', 'y']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Where should your memory live? [${path.join(home, 'AgentMemory')}]`));
  assert.equal(load(ctx).memoryDir, path.join(home, 'AgentMemory'));
  assert.equal(load(ctx).notesDir, undefined);
});

test('guided rerun supports older state without notesDir and preserves explicit options', t => {
  const { home, ctx, run } = fixture(t), memoryDir = path.join(home, 'Existing Memory');
  install(ctx, { memoryDir, agents: ['codex'] });
  const file = path.join(ctx.configDir, 'state.json'), legacy = load(ctx);
  legacy.version = '0.2.0'; delete legacy.notesDir; fs.writeFileSync(file, JSON.stringify(legacy));
  const result = run(['', '', 'y'], ['--agents', 'codex']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(load(ctx).memoryDir, memoryDir); assert.equal(load(ctx).notesDir, undefined);
  const kept = run(['', 'y'], ['--agents', 'opencode', '--memory-dir', memoryDir]);
  assert.equal(kept.status, 0, kept.stderr); assert.ok(!kept.stdout.includes('Where should your memory live?'));
  assert.deepEqual(load(ctx).agents, ['codex', 'opencode']);
  const before = fs.readFileSync(file, 'utf8');
  const other = path.join(home, 'Unrequested relocation');
  const refused = run([''], ['--agents', 'codex', '--memory-dir', other]);
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /different folder/u);
  assert.equal(fs.readFileSync(file, 'utf8'), before); assert.equal(fs.existsSync(other), false);
});
