#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { context, AGENTS, VERSION, detect, discoverObsidian, planSetup, install, planUninstall, uninstall, doctor, instructions, prepareTest, checkTest, cleanTest } from '../src/core.mjs';
import { search, show, maintenance, previewMaintenance, applyMaintenance } from '../src/notebook.mjs';
import { planProject, connectProject } from '../src/projects.mjs';
import { verifyLive } from '../src/verification.mjs';
import { serveUI } from '../src/ui.mjs';

const HELP = `
  AGENT MEMORY · Learn once. Reuse across agents.

  Usage: agent-memory <command> [options]

  setup                 Guided setup with a preview before writing
  ui                    Graphical setup, folder picker, diagnostics and tests
  mcp                   Local MCP server (stdio); --allow-write enables capture
  mcp-config            Print a local MCP connection block; no files changed
  doctor                Check files and show remaining manual steps (no AI calls)
  instructions [agent]  Print the shared pointer for an agent's global rules
  search "KEYWORDS"     Title-first lookup; at most 8 hits / 4,000 characters
  show "relative.md"    Bounded excerpt; default 40, maximum 60 lines
  project add/remove    Connect a personal project with --path DIRECTORY
  maintain              Preview duplicates, stale notes and possible conflicts
  verify --agent NAME   Optional fresh CLI verification; requires --live
  test [prepare]        Create a private read/write challenge and show prompts
  test check            Verify an exact answer and a saved test lesson
  test clean            Remove unchanged, identified test files
  uninstall             Disconnect agents; keep every real memory note

  Setup options:
    --memory-dir PATH   Knowledge folder (default: ~/AgentMemory)
    --notes-dir PATH    Optional existing Markdown notes to consult
    --agents LIST      codex,claude,cursor,antigravity,opencode,copilot,windsurf,cline
    --allow-capture     Allow Claude to write inbox Markdown files only
    --upgrade-policy    Replace MEMORY.md with efficient policy (backed up)
    --dry-run           Preview setup/uninstall without changing files
    --yes               Apply without the confirmation prompt

  Other options:
    --answer TEXT       Exact phrase returned by an agent, for test check
    --agent NAME        Attribute a guided test, or select a live-test CLI
    --source notes      Search an explicitly configured existing notes source
    --limit N           Search hits, 1–8 (default 8)
    --start N --lines N Excerpt range (default 1 / 40)
    --archive-duplicates --reindex   Maintenance actions to preview
    --apply --plan ID   Apply a previously reviewed maintenance plan
    --path DIRECTORY   Project to connect or disconnect
    --live             Opt in to agent calls; may use provider credits
    --allow-write      MCP: opt in to new inbox lessons only
    --no-open --port N UI: print local URL without opening; optional port
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
  const values = new Set(['memory-dir', 'notes-dir', 'agents', 'answer', 'agent', 'source', 'limit', 'start', 'lines', 'plan', 'path', 'port']);
  const booleans = new Set(['allow-capture', 'upgrade-policy', 'dry-run', 'yes', 'json', 'help', 'version', 'archive-duplicates', 'reindex', 'apply', 'live', 'no-open', 'allow-write']);
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
    upgradePolicy: Boolean(flags['upgrade-policy']),
  };
}

function publicPlan(plan) {
  return { memoryDir: plan.state?.memoryDir || plan.root, agents: plan.agents || plan.state?.agents, changes: plan.changes.map(c => ({ path: c.path, action: c.after === null ? 'remove' : c.before === null ? 'create' : 'update', kind: c.kind })), notesKeptOnUninstall: true };
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.version) { console.log(VERSION); return; }
  if (flags.help || !positional.length) { console.log(HELP); return; }
  const [cmd, sub] = positional;
  const commands = ['setup', 'ui', 'doctor', 'instructions', 'test', 'uninstall', 'search', 'show', 'maintain', 'project', 'verify', 'mcp', 'mcp-config'];
  if (!commands.includes(cmd)) throw new Error(`Unknown command: ${cmd}. Run agent-memory --help.`);
  if (positional.length > (['test', 'instructions', 'search', 'show', 'project'].includes(cmd) ? 2 : 1)) throw new Error('Unexpected extra arguments. Run agent-memory --help.');
  const setupOnly = ['memory-dir', 'notes-dir', 'agents', 'allow-capture', 'upgrade-policy'];
  if (cmd !== 'setup' && setupOnly.some(k => flags[k] !== undefined)) throw new Error('Folder, agent, and capture options belong to the setup command.');
  if (flags['dry-run'] && !['setup', 'uninstall', 'project', 'maintain'].includes(cmd)) throw new Error('--dry-run is supported for setup, project, maintenance and uninstall only.');
  if (flags.answer !== undefined && !(cmd === 'test' && sub === 'check')) throw new Error('--answer is supported for test check only.');
  if (flags['allow-write'] && !['mcp', 'mcp-config'].includes(cmd)) throw new Error('--allow-write belongs to mcp or mcp-config only.');
  if (['mcp', 'mcp-config'].includes(cmd) && Object.keys(flags).some(k => !['allow-write', ...(cmd === 'mcp-config' ? ['json'] : [])].includes(k))) throw new Error('Use mcp or mcp-config with --allow-write only (--json is accepted for mcp-config).');
  const ctx = context();
  if (cmd === 'mcp-config') {
    console.log(JSON.stringify({ mcpServers: { 'agent-memory': { command: process.execPath, args: [fileURLToPath(import.meta.url), 'mcp', ...(flags['allow-write'] ? ['--allow-write'] : [])], env: { AGENT_MEMORY_CONFIG_DIR: ctx.configDir } } } }, null, 2));
    return;
  }
  if (cmd === 'mcp') {
    if (flags.json || flags.yes || flags.live || flags.port || flags['no-open']) throw new Error('Use agent-memory mcp [--allow-write]; stdout is reserved for MCP.');
    const { startMemoryMcp } = await import('../src/mcp.mjs');
    const server = startMemoryMcp(ctx, { allowWrite: Boolean(flags['allow-write']) });
    const stop = () => server.close().catch(() => { process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return;
  }
  let rl;
  const ask = async (question, fallback = '') => {
    if (!process.stdin.isTTY || flags.json) throw new Error('This step needs input. Use explicit options and --yes, or run it in a terminal.');
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
  };
  const confirm = async message => flags.yes || /^(y|yes)$/iu.test(await ask(message + ' (y/N)', 'n'));
  const output = value => console.log(JSON.stringify(value, null, flags.json ? undefined : 2));
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
        for (const c of d.connections || []) console.log(`  ${c.name}: read ${c.read}, write ${c.write}${c.stale ? ' (previous evidence stale)' : ''}`);
        if (d.retrieval) console.log(`\n  Startup pointer: ${d.retrieval.pointerCharacters} characters. Notebook not preloaded. Search output capped at 4,000 characters.`);
        console.log('\n  No model calls made. Agent behavior and sandbox permissions require a fresh-chat test.\n');
      }
      if (!d.ok) process.exitCode = 1;
    } else if (cmd === 'instructions') {
      const text = instructions(ctx, sub);
      if (flags.json) output({ instructions: text }); else console.log(text);
    } else if (cmd === 'search') {
      const r = search(ctx, sub, { limit: flags.limit === undefined ? 8 : Number(flags.limit), source: flags.source || 'memory' });
      if (flags.json) output(r); else {
        for (const hit of r.hits) console.log(`${hit.path}:${hit.line}  ${hit.title}${hit.snippet ? '\n  ' + hit.snippet : ''}`);
        console.log(r.guidance + (r.partial ? ' Scan was partial.' : ''));
      }
    } else if (cmd === 'show') {
      const r = show(ctx, sub, { start: Number(flags.start || 1), lines: Number(flags.lines || 40), source: flags.source || 'memory' });
      if (flags.json) output(r); else console.log(r.excerpt + (r.truncated ? '\n[Excerpt truncated]' : ''));
    } else if (cmd === 'maintain') {
      if (flags.apply) {
        if (flags['dry-run']) throw new Error('Choose preview or apply, not both.');
        if (!flags.plan) throw new Error('Preview first, then supply its --plan ID.');
        if (!await confirm('Apply only the reviewed archive/index actions?')) { console.log('Cancelled.'); return; }
        output(applyMaintenance(ctx, flags.plan));
      } else {
        const opts = { archiveDuplicates: Boolean(flags['archive-duplicates']), reindex: Boolean(flags.reindex) };
        const result = flags['dry-run'] ? maintenance(ctx, opts).summary : previewMaintenance(ctx, opts);
        output(result);
        if (!flags.json) console.log(`\nNothing changed in your notes. To apply reviewed actions: agent-memory maintain --apply --plan ${result.planId}`);
      }
    } else if (cmd === 'project') {
      if (!['add', 'remove', 'list'].includes(sub)) throw new Error('Choose project add, remove, or list.');
      if (sub === 'list') { const d = doctor(ctx); output({ projects: d.projects || [] }); return; }
      if (!flags.path) throw new Error('Specify the project directory with --path.');
      const opts = { remove: sub === 'remove' }, plan = planProject(ctx, flags.path, opts);
      if (flags.json && !flags['dry-run'] && !flags.yes) throw new Error('Use --yes to apply or --dry-run to preview.');
      if (flags.json && flags['dry-run']) { output({ ...publicPlan(plan), project: plan.root, warnings: plan.warnings, applied: false }); return; }
      if (!flags.json) { console.log(`Personal project: ${plan.root}`); for (const c of publicPlan(plan).changes) console.log(`  ${c.action} ${c.path}`); for (const w of plan.warnings) console.log(`  ${w}`); }
      if (flags['dry-run']) return;
      if (!await confirm('Apply this personal project connection change?')) { console.log('Cancelled.'); return; }
      output(connectProject(ctx, flags.path, opts));
    } else if (cmd === 'verify') {
      if (!flags.agent) throw new Error('Choose --agent codex, claude, or opencode, and opt in with --live.');
      if (!flags.json) console.log('Running fresh bounded CLI checks. Your agent provider may charge for these calls.');
      const r = await verifyLive(ctx, flags.agent, { live: Boolean(flags.live) }); output(r); if (!r.ok) process.exitCode = 1;
    } else if (cmd === 'ui') {
      if (flags.json) throw new Error('The UI prints a private local URL; use other commands for JSON automation.');
      const port = Number(flags.port || 0); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a port between 0 and 65535.');
      const ui = await serveUI(ctx, { port, open: !flags['no-open'] });
      console.log(`\n  Agent Memory · local setup\n  ${ui.url}\n\n  This private loopback UI closes after 15 idle minutes. Press Ctrl+C to stop.\n`);
      process.once('SIGINT', () => ui.server.close()); process.once('SIGTERM', () => ui.server.close());
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
        const p = prepareTest(ctx, { agent: flags.agent });
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
