#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { context, AGENTS, VERSION, detect, discoverObsidian, planSetup, install, planUninstall, uninstall, doctor, instructions, prepareTest, checkTest, cleanTest } from '../src/core.mjs';

const HELP = `
  AGENT MEMORY · Learn once. Reuse across agents.

  Usage: agent-memory <command> [options]

  setup                 Guided setup with a preview before writing
  doctor                Check files and show remaining manual steps (no AI calls)
  instructions [agent]  Print the shared pointer for an agent's global rules
  test [prepare]        Create a private read/write challenge and show prompts
  test check            Verify an exact answer and a saved test lesson
  test clean            Remove unchanged, identified test files
  uninstall             Disconnect agents; keep every real memory note

  Setup options:
    --memory-dir PATH   Knowledge folder (default: ~/AgentMemory)
    --notes-dir PATH    Optional existing Markdown notes to consult
    --agents LIST      codex,claude,cursor,antigravity (or all)
    --allow-capture     Allow Claude to write inbox Markdown files only
    --dry-run           Preview setup/uninstall without changing files
    --yes               Apply without the confirmation prompt

  Other options:
    --answer TEXT       Exact phrase returned by an agent, for test check
    --json              Machine-readable output; requires explicit setup options
    --help              Show help
    --version           Show version

  Examples:
    agent-memory setup
    agent-memory setup --agents all --memory-dir "~/My Notes/Agent Memory" --dry-run
    agent-memory doctor
    agent-memory test

  Notes stay local. Your agent provider still handles its own model requests.
  Docs: https://github.com/Ameer-Jamal/agent-memory#readme
`;

function parse(argv) {
  const flags = {}, positional = [];
  const values = new Set(['memory-dir', 'notes-dir', 'agents', 'answer']);
  const booleans = new Set(['allow-capture', 'dry-run', 'yes', 'json', 'help', 'version']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') { flags.help = true; continue; }
    if (arg === '-v') { flags.version = true; continue; }
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (booleans.has(key)) flags[key] = true;
    else if (values.has(key)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${key} needs a value. Put paths containing spaces in quotes.`);
      flags[key] = value;
    } else throw new Error(`Unknown option: ${arg}. Run agent-memory --help.`);
  }
  return { flags, positional };
}

function options(flags) {
  return {
    memoryDir: flags['memory-dir'], notesDir: flags['notes-dir'],
    agents: flags.agents === 'all' ? AGENTS : flags.agents?.split(',').map(x => x.trim()).filter(Boolean),
    allowCapture: Boolean(flags['allow-capture']),
  };
}

function publicPlan(plan) {
  return { memoryDir: plan.root || plan.state?.memoryDir, agents: plan.agents || plan.state?.agents, changes: plan.changes.map(c => ({ path: c.path, action: c.after === null ? 'remove' : c.before === null ? 'create' : 'update', kind: c.kind })), notesKeptOnUninstall: true };
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.version) { console.log(VERSION); return; }
  if (flags.help || !positional.length) { console.log(HELP); return; }
  const [cmd, sub] = positional;
  const commands = ['setup', 'doctor', 'instructions', 'test', 'uninstall'];
  if (!commands.includes(cmd)) throw new Error(`Unknown command: ${cmd}. Run agent-memory --help.`);
  if (positional.length > (['test', 'instructions'].includes(cmd) ? 2 : 1)) throw new Error('Unexpected extra arguments. Run agent-memory --help.');
  const setupOnly = ['memory-dir', 'notes-dir', 'agents', 'allow-capture'];
  if (cmd !== 'setup' && setupOnly.some(k => flags[k] !== undefined)) throw new Error('Folder, agent, and capture options belong to the setup command.');
  if (flags['dry-run'] && !['setup', 'uninstall'].includes(cmd)) throw new Error('--dry-run is supported for setup and uninstall only.');
  if (flags.answer !== undefined && !(cmd === 'test' && sub === 'check')) throw new Error('--answer is supported for test check only.');
  const ctx = context();
  let rl;
  const ask = async (question, fallback = '') => {
    if (!process.stdin.isTTY || flags.json) throw new Error('This step needs input. Use explicit options and --yes, or run it in a terminal.');
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  };
  const confirm = async message => flags.yes || /^(y|yes)$/iu.test(await ask(message + ' (y/N)', 'n'));
  const output = value => console.log(JSON.stringify(value, null, 2));
  try {
    if (cmd === 'setup') {
      const opts = options(flags);
      if (process.stdin.isTTY && !flags.json && !flags.yes && !flags['dry-run']) {
        console.log('\n  Agent Memory\n  A shared notebook for your coding agents. Obsidian is optional.\n');
        const vaults = discoverObsidian(ctx);
        if (vaults.length) console.log('  Found Obsidian vaults (optional):\n' + vaults.map(v => `    ${v}`).join('\n') + '\n  Use a new subfolder inside a vault, or any ordinary folder.\n');
        opts.memoryDir ||= await ask('Where should your memory live?', path.join(ctx.home, 'AgentMemory'));
        opts.agents ||= (await ask('Which agents? Comma-separated names', detect(ctx).join(',') || AGENTS.join(','))).split(',').map(s => s.trim());
        if (opts.agents.includes('all')) opts.agents = AGENTS;
        if (!opts.notesDir) opts.notesDir = await ask('Existing Markdown notes to search if memory has no answer? Leave blank to skip');
        if (opts.agents.includes('claude') && !opts.allowCapture) opts.allowCapture = /^(y|yes)$/iu.test(await ask('Allow Claude to save Markdown files inside the memory inbox? (y/N)', 'n'));
      }
      const plan = planSetup(ctx, opts);
      if (flags.json) {
        if (!flags['dry-run'] && !flags.yes) throw new Error('Use --yes to apply a JSON setup, or --dry-run to preview.');
        if (!flags['dry-run']) install(ctx, opts);
        output({ ...publicPlan(plan), applied: !flags['dry-run'], next: ['Run doctor', 'Complete manual agent permission/rule steps', 'Run test in a fresh chat'] });
        return;
      }
      console.log(`\n  Memory: ${plan.root}\n  Agents: ${plan.agents.join(', ')}\n`);
      for (const c of publicPlan(plan).changes) console.log(`  ${c.action.toUpperCase().padEnd(6)} ${c.path}`);
      if (!plan.changes.length) console.log('  Already configured. No content changes needed.');
      console.log(`\n  Private backups and installer state: ${ctx.configDir}`);
      if (flags['dry-run']) { console.log('\n  Preview only. No files changed.'); return; }
      if (!await confirm('Apply this setup?')) { console.log('Cancelled. No files changed.'); return; }
      install(ctx, opts);
      console.log('\n  Installed. Your existing instructions were preserved.\n  Start fresh agent chats after completing these steps:\n');
      for (const c of doctor(ctx).checks.filter(c => c.status === 'manual' || c.status === 'warn')) console.log(`  → ${c.label}`);
      console.log('\n  Next: agent-memory test\n');
    } else if (cmd === 'doctor') {
      const d = doctor(ctx);
      if (flags.json) output(d);
      else {
        if (d.memoryDir) console.log(`\n  Memory: ${d.memoryDir}\n`);
        for (const c of d.checks) console.log(`  ${c.status.toUpperCase().padEnd(7)} ${c.label}`);
        console.log('\n  No model calls made. Agent behavior and sandbox permissions require a fresh-chat test.\n');
      }
      if (!d.ok) process.exitCode = 1;
    } else if (cmd === 'instructions') {
      const text = instructions(ctx, sub);
      if (flags.json) output({ instructions: text }); else console.log(text);
    } else if (cmd === 'uninstall') {
      const plan = planUninstall(ctx);
      if (flags.json) {
        if (!flags['dry-run'] && !flags.yes) throw new Error('Use --yes to uninstall, or --dry-run to preview.');
        if (!flags['dry-run']) uninstall(ctx);
        output({ ...publicPlan(plan), applied: !flags['dry-run'], manual: 'Remove the Cursor account User Rule and any memory-only permissions you added in agent UIs.' }); return;
      }
      console.log(`\n  Disconnect ${plan.state.agents.join(', ')}. Keep all notes in ${plan.state.memoryDir}.`);
      for (const c of plan.changes) console.log(`  ${c.path}`);
      if (flags['dry-run']) { console.log('  Preview only. No files changed.'); return; }
      if (!await confirm('Disconnect these agents?')) { console.log('Cancelled. No files changed.'); return; }
      uninstall(ctx);
      console.log('\n  Disconnected. Notes and backups kept.\n  Also remove the Cursor account User Rule and any memory-only permissions added in agent UIs.');
    } else {
      if (!sub || sub === 'prepare') {
        const p = prepareTest(ctx);
        if (flags.json) output(p);
        else console.log(`\n  Test prepared. Start a fresh agent chat.\n\n  1. Paste this read prompt (the answer is intentionally hidden):\n\n${p.readPrompt}\n\n  2. Paste this capture prompt:\n\n${p.writePrompt}\n\n  3. Run agent-memory test check and paste ONLY the returned preflight phrase.\n  4. Run agent-memory test clean afterwards.\n\n  Repeat per agent. To test sharing, use another fresh agent for step 1.\n  This CLI does not launch models or spend provider credits.\n`);
      } else if (sub === 'check') {
        const answer = flags.answer || await ask('Paste ONLY the exact preflight phrase returned by your agent');
        const r = checkTest(ctx, answer);
        if (flags.json) output(r); else console.log(`\n  Read: ${r.read ? 'PASS' : 'FAIL — exact phrase did not match'}\n  Write: ${r.write ? 'PASS — test-only lesson found on disk' : 'FAIL — no new matching test-only lesson found'}\n  ${r.note}\n  Next: agent-memory test clean\n`);
        if (!r.ok) process.exitCode = 1;
      } else if (sub === 'clean') {
        if (!await confirm('Remove only unchanged, identified test files?')) { console.log('Cancelled.'); return; }
        const r = cleanTest(ctx);
        if (flags.json) output(r); else console.log(`Removed ${r.removed.length} test files. Kept ${r.kept.length} edited files. ${r.note}`);
      } else throw new Error('Choose test prepare, test check, or test clean.');
    }
  } finally { rl?.close(); }
}

main().catch(error => {
  if (process.argv.includes('--json')) console.error(JSON.stringify({ error: error.message }));
  else console.error(`\n  Could not complete: ${error.message}\n`);
  process.exitCode = 1;
});
