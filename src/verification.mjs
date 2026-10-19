import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { ADAPTERS, executable } from './adapters.mjs';
import { notebook } from './notebook.mjs';
import { prepareTest, checkTest, cleanTest, fingerprint, saveVerification, probe, lock, claudeRule } from './core.mjs';

export function invocation(agent, root, prompt, write = false) {
  const inbox = path.join(root, 'inbox');
  if (agent === 'codex') return { command: 'codex', args: ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', write ? 'workspace-write' : 'read-only', ...(write ? ['--add-dir', inbox] : []), '--json', prompt] };
  if (agent === 'claude') return { command: 'claude', args: ['-p', '--no-session-persistence', '--output-format', 'json', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', `Read,Grep,Glob${write ? ',Write' : ''}`, '--allowedTools', `Read,Grep,Glob${write ? ',' + claudeRule(root) : ''}`, '--permission-mode', 'dontAsk', '--add-dir', root, '--', prompt] };
  if (agent === 'opencode') {
    const permission = { bash: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny', external_directory: { '*': 'deny', [root.replaceAll('\\', '/') + '/*']: 'allow' }, edit: write ? { '*': 'deny', [inbox.replaceAll('\\', '/') + '/*']: 'allow' } : 'deny' };
    return { command: 'opencode', args: ['run', '--pure', '--format', 'json', prompt], env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission }) } };
  }
  throw new Error('Use the guided test for this agent. Automated runners currently support codex, claude, and opencode.');
}

export function finalText(agent, output) {
  if (agent === 'claude') { try { return JSON.parse(output).result || ''; } catch { return ''; } }
  const texts = [];
  for (const line of output.split('\n')) {
    try {
      const e = JSON.parse(line);
      if (agent === 'codex' && e.type === 'item.completed' && e.item?.type === 'agent_message') texts.push(e.item.text);
      if (agent === 'opencode' && e.type === 'text' && typeof e.part?.text === 'string') texts.push(e.part.text);
    } catch { /* Ignore diagnostic lines; never grade tool output as a final answer. */ }
  }
  return texts.join('\n');
}

export function failureHint(text) {
  if (/api_key_expired|api key has expired/iu.test(text)) return 'The agent provider reports an expired API key. Replace it through the provider’s normal setup, then retry; signing in may not renew that key.';
  if (/authentication|unauthorized|invalid.api.key|\b401\b/iu.test(text)) return 'The agent provider rejected authentication. Check the CLI account or credentials; no credentials were changed.';
  if (/model.not.found|model[^\n]{0,100}not supported/iu.test(text)) return 'The configured agent model is unavailable or unsupported. Choose a supported model in that agent, then retry.';
  if (/permission.{0,40}denied|access.{0,40}denied/iu.test(text)) return 'The agent was denied file access. Check scoped memory/inbox permissions; do not bypass the sandbox.';
  return 'Agent failed. Check its normal authentication, model selection, and file permissions in a terminal.';
}

export function runCommand(spec, { cwd, env, timeout = 120000 } = {}) {
  return new Promise(resolve => {
    let command = executable(spec.command, env);
    if (!command) { resolve({ code: null, output: '', reason: 'CLI executable not found on PATH' }); return; }
    let args = spec.args;
    if (process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(command)) {
      // Launch a recognizable npm Node shim without putting prompts through cmd.exe.
      const wrapper = fs.readFileSync(command, 'utf8');
      const entry = wrapper.match(/"%dp0%\\([^"\r\n]+\.(?:js|mjs|cjs))"/iu)?.[1];
      if (!entry) { resolve({ code: null, output: '', reason: 'This Windows command wrapper needs a guided test or native CLI executable' }); return; }
      args = [path.resolve(path.dirname(command), entry), ...args]; command = process.execPath;
    }
    let output = '', error = '', reason = null, settled = false, killTimer;
    const child = spawn(command, args, { cwd, env: { ...env, ...spec.env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = why => { if (reason) return; reason = why; child.kill(); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); killTimer.unref(); };
    const timer = setTimeout(() => stop('Test exceeded its two-minute time limit'), timeout);
    const finish = code => { if (!settled) { settled = true; clearTimeout(timer); clearTimeout(killTimer); resolve({ code, output, reason: reason || (code === 0 ? null : failureHint(output + error)), diagnostic: error ? 'Agent emitted diagnostics; raw provider output is not saved.' : null }); } };
    child.stdout.on('data', data => { const next = output + data.toString(); output = next.slice(0, 128 * 1024); if (Buffer.byteLength(next) > 128 * 1024) stop('Agent output exceeded the 128 KiB test limit'); });
    child.stderr.on('data', data => { error = (error + data.toString()).slice(-1000); });
    child.on('error', e => { reason = e.code === 'ENOENT' ? 'CLI executable unavailable' : 'Could not launch this CLI; use the guided test'; finish(null); });
    child.on('close', finish);
  });
}

export async function verifyLive(ctx, agent, { live = false, runner = runCommand } = {}) {
  if (!live) throw new Error('Live tests call your agent provider. Opt in with --live; normal doctor/test commands make no model calls.');
  if (ctx.home !== os.homedir() && runner === runCommand) throw new Error('Live tests require the current OS-user context. Use an injected runner for isolated test homes.');
  const state = notebook(ctx);
  if (!state.agents.includes(agent) || !ADAPTERS[agent]?.live) throw new Error('Choose an installed live-test agent: codex, claude, or opencode. Other agents use the guided challenge.');
  const before = fingerprint(ctx, agent);
  const prompts = prepareTest(ctx, { agent });
  const expected = probe(ctx).phrase;
  const cwd = fs.mkdtempSync(path.join(ctx.configDir, 'verification-workspace-'));
  let result = { agent, read: 'failed', write: 'skipped', fingerprint: before, evidence: 'automated fresh CLI challenge', reason: null };
  try {
    const readRun = await runner(invocation(agent, state.memoryDir, prompts.readPrompt), { cwd, env: { ...process.env, ...ctx.env } });
    const answer = finalText(agent, readRun.output);
    result.read = readRun.code === 0 && !readRun.reason && answer.includes(expected) ? 'verified' : readRun.code === null ? 'unavailable' : 'failed';
    result.reason = readRun.reason;
    if (result.read === 'verified') {
      const writeRun = await runner(invocation(agent, state.memoryDir, prompts.writePrompt, true), { cwd, env: { ...process.env, ...ctx.env } });
      const checked = checkTest(ctx, expected);
      result.write = checked.write && writeRun.code === 0 && !writeRun.reason ? 'verified' : writeRun.code === null ? 'unavailable' : 'failed';
      result.reason = writeRun.reason;
    }
    // Snapshot exact receipts even after a failed stage so cleanup stays conservative.
    checkTest(ctx, result.read === 'verified' ? expected : '');
    result.ok = result.read === 'verified' && result.write === 'verified';
    if (fingerprint(ctx, agent) !== before) { result.ok = false; result.reason = 'Configuration changed during the test; results are stale.'; }
    lock(ctx, () => saveVerification(ctx, agent, result));
    return result;
  } catch {
    result.ok = false;
    result.reason = 'The live test could not complete. Check the CLI normally, then retry; raw provider errors are not saved.';
    if (result.read === 'verified') result.write = 'failed';
    checkTest(ctx, result.read === 'verified' ? expected : '');
    lock(ctx, () => saveVerification(ctx, agent, result));
    return result;
  } finally {
    cleanTest(ctx);
    // Preserve any files the agent unexpectedly created; never recursively delete them.
    if (fs.readdirSync(cwd).length === 0) fs.rmdirSync(cwd);
  }
}
