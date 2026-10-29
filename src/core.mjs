import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { START, END, pointer, templates } from './templates.mjs';
import { ADAPTERS, AGENTS, targets, executable } from './adapters.mjs';
export { AGENTS, targets } from './adapters.mjs';

export const VERSION = '0.3.0';
export const exists = p => fs.existsSync(p);
const read = p => exists(p) ? fs.readFileSync(p, 'utf8') : null;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');

export function context({ home = os.homedir(), configDir = process.env.AGENT_MEMORY_CONFIG_DIR, env } = {}) {
  return { home: path.resolve(home), configDir: path.resolve(configDir || path.join(home, '.config', 'agent-memory')), env: env || (path.resolve(home) === os.homedir() ? process.env : {}) };
}

export function expand(input, home) {
  if (!input || /[\r\n`]/u.test(input)) throw new Error('Choose a folder path without line breaks or backticks.');
  return path.resolve(input === '~' ? home : input.startsWith('~/') || input.startsWith('~\\') ? path.join(home, input.slice(2)) : input);
}

function noLink(p) {
  // Configuration writes must not silently follow symlinks or junctions.
  for (let current = p; ; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing a symbolic-link path: ${current}. Use a regular folder/config file.`);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(current) === current) break;
  }
}

function atomicWrite(p, content, mode = 0o600) {
  noLink(p);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const temp = `${p}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode });
    fs.renameSync(temp, p);
  } finally { if (exists(temp)) fs.unlinkSync(temp); }
}

function load(ctx) {
  const p = path.join(ctx.configDir, 'state.json');
  noLink(p);
  const raw = read(p);
  if (!raw) return null;
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error(`Cannot parse ${p}. Restore its backup before continuing.`); }
  if (state.schema !== 1 || !Array.isArray(state.records) || typeof state.memoryDir !== 'string' || !Array.isArray(state.agents)) throw new Error('Unsupported or damaged installation state. No files were changed.');
  if (state.agents.some(a => !AGENTS.includes(a))) throw new Error('Unknown agent in installation state.');
  const projects = state.projects || [];
  if (!Array.isArray(projects) || projects.some(p => typeof p !== 'string' || !path.isAbsolute(p) || p === ctx.home || p === path.parse(p).root)) throw new Error('Invalid project path in installation state.');
  const known = new Set([...Object.values(targets(ctx)), path.join(ctx.home, '.claude', 'settings.json'), ...projects.flatMap(p => [path.join(p, 'AGENTS.md'), path.join(p, '.git', 'info', 'exclude')])]);
  if (state.records.some(r => !known.has(r.path) || !['instruction', 'permission', 'exclude'].includes(r.kind))) throw new Error('Installation state contains an unexpected config path. No files were changed.');
  return state;
}

function lock(ctx, fn) {
  noLink(ctx.configDir);
  fs.mkdirSync(ctx.configDir, { recursive: true, mode: 0o700 });
  const p = path.join(ctx.configDir, 'operation.lock');
  try { fs.mkdirSync(p); } catch (e) {
    if (e.code === 'EEXIST') throw new Error(`Another operation may be running. If it was interrupted, confirm it stopped, then remove ${p}.`);
    throw e;
  }
  try { return fn(); } finally { fs.rmdirSync(p); }
}

function managed(text, startMarker = START, endMarker = END) {
  const a = text.indexOf(startMarker), b = text.indexOf(endMarker);
  if (a < 0 && b < 0) return null;
  if (a < 0 || b < a || text.indexOf(startMarker, a + startMarker.length) >= 0 || text.indexOf(endMarker, b + endMarker.length) >= 0) throw new Error('A managed instruction block is damaged or duplicated. Repair it before continuing.');
  return { start: a, end: b + endMarker.length, content: text.slice(a, b + endMarker.length) };
}

function claudeRule(root) {
  if (/[?*\[\]{}()!]/u.test(root)) throw new Error('Claude capture permissions cannot safely represent wildcard punctuation in this folder path. Choose a simpler path or approve writes manually without --allow-capture.');
  const normalized = path.join(root, 'inbox', '*.md').replaceAll('\\', '/').replace(/^([A-Za-z]):/u, (_, drive) => `/${drive.toLowerCase()}`);
  return `Edit(/${normalized})`;
}

function parseSettings(raw) {
  let d;
  try { d = raw ? JSON.parse(raw) : {}; } catch { throw new Error('Claude settings.json is not valid JSON. Fix it before enabling capture; no files were changed.'); }
  if (!d || typeof d !== 'object' || Array.isArray(d) || (d.permissions !== undefined && (!d.permissions || typeof d.permissions !== 'object' || Array.isArray(d.permissions))) || (d.permissions?.allow !== undefined && (!Array.isArray(d.permissions.allow) || d.permissions.allow.some(x => typeof x !== 'string')))) throw new Error('Claude permission settings have an unsupported shape. No files were changed.');
  return d;
}

export function detect(ctx) {
  const roots = { codex: '.codex', claude: '.claude', cursor: '.cursor', antigravity: '.gemini', opencode: '.config/opencode', copilot: '.copilot', windsurf: '.codeium/windsurf', cline: '.cline' };
  return AGENTS.filter(a => exists(path.dirname(targets(ctx)[a])) || exists(path.join(ctx.home, roots[a])) || executable(ADAPTERS[a].command, ctx.env));
}

export function discoverObsidian(ctx, platform = process.platform) {
  const config = platform === 'darwin' ? path.join(ctx.home, 'Library', 'Application Support', 'obsidian', 'obsidian.json') : platform === 'win32' ? path.join(process.env.APPDATA || path.join(ctx.home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json') : path.join(ctx.home, '.config', 'obsidian', 'obsidian.json');
  try {
    return [...new Set(Object.values(JSON.parse(fs.readFileSync(config, 'utf8')).vaults || {}).map(v => v.path).filter(p => typeof p === 'string' && exists(p)))];
  } catch { return []; }
}

export function planSetup(ctx, options) {
  const previous = load(ctx);
  const root = expand(options.memoryDir || previous?.memoryDir || path.join(ctx.home, 'AgentMemory'), ctx.home);
  const selected = options.agents || previous?.agents || detect(ctx);
  if (!selected.length) throw new Error(`No agents detected. Choose agents with --agents ${AGENTS.join(',')}.`);
  if (selected.some(a => !AGENTS.includes(a))) throw new Error(`Unknown agent. Choose: ${AGENTS.join(', ')}.`);
  const agents = [...new Set([...(previous?.agents || []), ...selected])];
  if (previous && previous.memoryDir !== root) throw new Error('Memory is already installed in a different folder. Uninstall first to relocate it; your notes will be kept.');
  const notesDir = options.notesDir ? expand(options.notesDir, ctx.home) : previous?.notesDir;
  if (previous && notesDir !== previous.notesDir) throw new Error('The notes source changed. Update MEMORY.md deliberately, or uninstall and choose a new knowledge folder.');
  if (notesDir && (!exists(notesDir) || !fs.statSync(notesDir).isDirectory())) throw new Error('The optional notes source must be an existing directory.');
  noLink(root);
  if (root === ctx.home || root === path.parse(root).root || root === ctx.configDir || ctx.configDir.startsWith(root + path.sep) || root.startsWith(ctx.configDir + path.sep)) throw new Error('Choose a dedicated knowledge folder, separate from your home root and installer settings.');
  const changes = [];
  const records = structuredClone(previous?.records || []);
  let owned = false;
  try { owned = JSON.parse(read(path.join(root, '.agent-memory.json')) || '{}').format === 'agent-memory-markdown-v1'; } catch { /* Existing unrelated folders are never adopted. */ }
  const add = (p, before, after, kind) => { if (before !== after) changes.push({ path: p, before, after, kind, mode: before === null ? 0o600 : fs.statSync(p).mode & 0o777 }); };
  for (const [rel, content] of Object.entries(templates(root, notesDir))) {
    const p = path.join(root, rel); noLink(p);
    const before = read(p);
    if (before !== null && !previous && !owned) throw new Error(`This folder already contains ${rel}. Choose a new subfolder to avoid replacing existing notes.`);
    if (before === null || (rel === 'MEMORY.md' && options.upgradePolicy)) add(p, before, content, 'knowledge');
  }
  for (const { a, p } of [...agents.map(a => ({ a, p: targets(ctx)[a] })), ...(previous?.projects || []).map(project => ({ a: 'project', p: path.join(project, 'AGENTS.md') }))]) {
    noLink(p);
    const before = read(p), text = before || '', block = managed(text);
    const record = records.find(r => r.path === p);
    if (block && !record) throw new Error(`Found an unmanaged existing Agent Memory block in ${p}. Use the original installer settings or remove that block first.`);
    if (record && block && block.content !== managed(record.installed).content) throw new Error(`The managed block in ${p} was edited. Keep custom instructions outside the block before rerunning setup.`);
    if (record && !block) throw new Error(`The managed block is missing in ${p}. Restore it or uninstall before reinstalling.`);
    const header = a === 'cursor' && before === null ? '---\ndescription: Shared Markdown memory for coding agents\nalwaysApply: true\n---\n\n' : '';
    const after = block ? text.slice(0, block.start) + pointer(root) + text.slice(block.end) : text + (text && !text.endsWith('\n\n') ? text.endsWith('\n') ? '\n' : '\n\n' : '') + header + pointer(root) + '\n';
    if (a === 'windsurf' && after.length > 6000) throw new Error('The Windsurf global rules file would exceed its 6,000-character limit. Use a personal project connection instead.');
    add(p, before, after, 'instruction');
    if (!record) records.push({ path: p, kind: 'instruction', original: before, installed: after });
    else {
      // Never adopt later user edits as our own content: uninstall must keep them.
      const originalBlock = managed(record.installed);
      record.installed = record.installed.slice(0, originalBlock.start) + pointer(root) + record.installed.slice(originalBlock.end);
    }
  }
  if (options.allowCapture && agents.includes('claude')) {
    const p = path.join(ctx.home, '.claude', 'settings.json'); noLink(p);
    const before = read(p), d = parseSettings(before), rule = claudeRule(root);
    if (!d.permissions?.allow?.includes(rule)) {
      d.permissions ??= {}; d.permissions.allow ??= []; d.permissions.allow.push(rule);
      const after = JSON.stringify(d, null, 2) + '\n';
      add(p, before, after, 'permission');
      if (!records.some(r => r.path === p)) records.push({ path: p, kind: 'permission', original: before, installed: after, rule });
    }
  }
  return { root, agents, changes, state: { ...previous, schema: 1, version: VERSION, memoryDir: root, notesDir, agents, records } };
}

function apply(ctx, changes, state) {
  const statePath = path.join(ctx.configDir, 'state.json');
  const all = [...changes, { path: statePath, before: read(statePath), after: state ? JSON.stringify(state, null, 2) + '\n' : null, mode: 0o600 }];
  const changed = all.filter(x => x.before !== x.after);
  // Preflight every path before the first write.
  for (const c of changed) { noLink(c.path); if (read(c.path) !== c.before) throw new Error(`File changed during planning: ${c.path}. Retry after other edits finish.`); }
  if (changed.some(c => c.before !== null)) {
    const backup = path.join(ctx.configDir, 'backups', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    const index = [];
    changed.forEach((c, i) => { if (c.before !== null) { atomicWrite(path.join(backup, `${i}.txt`), c.before); index.push({ file: `${i}.txt`, path: c.path }); } });
    atomicWrite(path.join(backup, 'index.json'), JSON.stringify(index, null, 2));
  }
  const done = [];
  try {
    for (const c of changed) {
      if (read(c.path) !== c.before) throw new Error(`Concurrent edit detected: ${c.path}`);
      if (c.after === null) fs.unlinkSync(c.path); else atomicWrite(c.path, c.after, c.mode);
      done.push(c);
    }
  } catch (error) {
    const conflicts = [];
    for (const c of done.reverse()) {
      if (read(c.path) !== c.after) { conflicts.push(c.path); continue; }
      try { if (c.before === null) fs.unlinkSync(c.path); else atomicWrite(c.path, c.before, c.mode); } catch { conflicts.push(c.path); }
    }
    throw new Error(`${error.message}. Applied files were rolled back${conflicts.length ? ` except concurrently changed files: ${conflicts.join(', ')}. Use local backups to recover` : ''}.`, { cause: error });
  }
  return changed.length;
}

export function install(ctx, options) {
  return lock(ctx, () => {
    const plan = planSetup(ctx, options);
    apply(ctx, plan.changes, plan.state);
    return plan;
  });
}

export function planUninstall(ctx) {
  const state = load(ctx);
  if (!state) throw new Error('No installation found. Your notes were not changed.');
  if (exists(probePath(ctx))) throw new Error('A memory test is active. Run agent-memory test clean before uninstalling.');
  const changes = [];
  for (const r of state.records) {
    noLink(r.path);
    const before = read(r.path);
    if (before === null) continue;
    let after;
    if (before === r.installed) after = r.original;
    else if (r.kind === 'permission') {
      const d = parseSettings(before);
      if (!d.permissions?.allow?.includes(r.rule)) continue;
      d.permissions.allow = d.permissions.allow.filter(x => x !== r.rule);
      const original = parseSettings(r.original);
      if (!d.permissions.allow.length && !original.permissions?.allow) delete d.permissions.allow;
      if (!Object.keys(d.permissions).length && !original.permissions) delete d.permissions;
      after = JSON.stringify(d, null, 2) + '\n';
    } else {
      const markers = r.kind === 'exclude' ? ['# agent-memory:local:start', '# agent-memory:local:end'] : [];
      const block = managed(before, ...markers);
      if (!block) continue;
      if (block.content !== managed(r.installed, ...markers).content) throw new Error(`The managed block in ${r.path} was edited. Review it before uninstalling; no files were changed.`);
      // Remove exactly the managed text; preserve all later user edits.
      after = before.slice(0, block.start) + before.slice(block.end);
    }
    if (before !== after) changes.push({ path: r.path, before, after, mode: fs.statSync(r.path).mode & 0o777 });
  }
  return { state, changes };
}

export function uninstall(ctx) {
  return lock(ctx, () => { const plan = planUninstall(ctx); apply(ctx, plan.changes, null); return plan.state; });
}

export function instructions(ctx, agent) {
  const state = load(ctx);
  if (!state) throw new Error('Run setup first.');
  if (agent && !AGENTS.includes(agent)) throw new Error(`Unknown agent: ${agent}`);
  return pointer(state.memoryDir);
}

export function doctor(ctx) {
  const state = load(ctx);
  if (!state) return { ok: false, checks: [{ status: 'fail', label: 'No installation found. Run agent-memory setup.' }] };
  const checks = [];
  const add = (ok, label) => checks.push({ status: ok ? 'pass' : 'fail', label });
  for (const rel of ['MEMORY.md', 'INDEX.md', 'templates/lesson.md']) add(Boolean(read(path.join(state.memoryDir, rel))), `Readable ${rel}`);
  try { fs.accessSync(path.join(state.memoryDir, 'inbox'), fs.constants.W_OK); add(true, 'Your OS user can write to inbox/ (agent sandbox access must be checked separately)'); } catch { add(false, 'Inbox is not writable by your OS user'); }
  const verification = read(path.join(ctx.configDir, 'verification.json'));
  let verified = {}; try { verified = JSON.parse(verification || '{}'); } catch { /* Report unverified rather than trust damaged results. */ }
  const connections = [];
  for (const a of state.agents) {
    const r = state.records.find(r => r.path === targets(ctx)[a]);
    try { add(managed(read(r.path) || '')?.content === managed(r.installed).content, `${a}: instruction file configured`); } catch { add(false, `${a}: managed block needs repair`); }
    const result = verified[a];
    const current = result?.fingerprint === fingerprint(ctx, a);
    let configured = false; try { configured = managed(read(r.path) || '')?.content === managed(r.installed).content; } catch { /* Already reported above. */ }
    connections.push({ agent: a, name: ADAPTERS[a].name, configured, executable: Boolean(executable(ADAPTERS[a].command, ctx.env)), liveSupported: ADAPTERS[a].live, read: current ? result.read : 'unverified', write: current ? result.write : 'unverified', checkedAt: result?.checkedAt || null, evidence: current ? result.evidence : null, stale: Boolean(result && !current) });
  }
  if (state.agents.includes('codex')) {
    const override = path.join(path.dirname(targets(ctx).codex), 'AGENTS.override.md');
    if (exists(override)) checks.push({ status: 'warn', label: `Codex override exists and may shadow AGENTS.md: ${override}` });
  }
  const permission = state.records.find(r => r.kind === 'permission');
  if (permission) {
    try { add(parseSettings(read(permission.path)).permissions?.allow?.includes(permission.rule), 'Claude scoped inbox capture permission'); } catch { add(false, 'Claude settings need repair'); }
  }
  for (const a of state.agents) if (ADAPTERS[a].manual) checks.push({ status: 'manual', label: `${ADAPTERS[a].name}: ${ADAPTERS[a].manual}` });
  checks.push({ status: 'manual', label: 'Files configured is not behavior verified. Run agent-memory test in each fresh agent chat.' });
  return { ok: !checks.some(c => c.status === 'fail'), memoryDir: state.memoryDir, checks, connections, projects: state.projects || [], retrieval: { pointerCharacters: pointer(state.memoryDir).length, alwaysLoadsNotebook: false, searchOutputCharacters: 4000, initialNotes: 2, searchesBeforeMovingOn: 2 } };
}

const probePath = ctx => path.join(ctx.configDir, 'probe.json');
function probe(ctx) {
  const raw = read(probePath(ctx));
  if (!raw) throw new Error('No active test. Run agent-memory test prepare.');
  const p = JSON.parse(raw), state = load(ctx);
  if (!state || p.root !== state.memoryDir || !/^agent-memory-test-[a-f0-9]+\.md$/u.test(p.fixture)) throw new Error('Test state does not match this installation.');
  return p;
}

export function prepareTest(ctx, { agent } = {}) {
  return lock(ctx, () => {
    const state = load(ctx);
    if (!state) throw new Error('Run setup first.');
    if (agent && !state.agents.includes(agent)) throw new Error('Choose an installed agent for this test.');
    if (exists(probePath(ctx))) throw new Error('A test is already active. Finish it or run agent-memory test clean.');
    const id = crypto.randomBytes(6).toString('hex'), phrase = `preflight-${crypto.randomBytes(16).toString('hex')}`, label = `label-${crypto.randomBytes(16).toString('hex')}`;
    const fixture = `agent-memory-test-${id}.md`;
    const content = `---\nstatus: test-only\nscope: fictional task; never operational advice\n---\n# Memory rehearsal ${id}\nThe preflight phrase for the fictional task "memory rehearsal ${id}" is ${phrase}.\n`;
    const p = { root: state.memoryDir, id, phrase, label, fixture, fixtureHash: hash(content), receipts: [], agent, fingerprint: agent ? fingerprint(ctx, agent) : undefined, before: fs.readdirSync(path.join(state.memoryDir, 'inbox')) };
    atomicWrite(path.join(state.memoryDir, 'inbox', fixture), content);
    try { atomicWrite(probePath(ctx), JSON.stringify(p, null, 2)); } catch (e) { fs.unlinkSync(path.join(state.memoryDir, 'inbox', fixture)); throw e; }
    return {
      readPrompt: `What is the exact preflight phrase for the fictional task "memory rehearsal ${id}"? Check the local reference and cite its source. Do not guess, change files, run procedures, use MCP tools, or delegate.`,
      writePrompt: `Remember this user correction for future agents: for the fictional task "memory capture ${id}", the label is "${label}". Save one new test-only, user-stated Markdown lesson using your shared-memory policy. Never apply this to real work. Do not edit existing notes or the index. Use local file tools only, no MCP or delegation.`,
    };
  });
}

function receipts(p) {
  return fs.readdirSync(path.join(p.root, 'inbox')).filter(name => !p.before.includes(name) && name !== p.fixture && name.endsWith('.md')).filter(name => {
    const file = path.join(p.root, 'inbox', name);
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile() || fs.statSync(file).size > 256 * 1024) return false;
    const text = read(file);
    return text.includes(p.label) && /test.only/iu.test(text) && /user.stated/iu.test(text);
  });
}

export function checkTest(ctx, answer) {
  return lock(ctx, () => {
    const p = probe(ctx);
    const readOk = (answer || '').trim() === p.phrase;
    const found = receipts(p);
    p.receipts = found.map(name => ({ name, digest: hash(read(path.join(p.root, 'inbox', name))) }));
    atomicWrite(probePath(ctx), JSON.stringify(p, null, 2));
    if (p.agent) saveVerification(ctx, p.agent, { read: readOk ? 'verified' : 'failed', write: found.length ? 'verified' : 'failed', evidence: 'manual challenge; user supplied answer, file capture inspected', fingerprint: p.fingerprint });
    return { ok: readOk && found.length > 0, read: readOk, write: found.length > 0, savedFiles: found.map(name => path.join(p.root, 'inbox', name)), note: 'Manual challenge check; not an automatic test of every agent or future task.' };
  });
}

export function fingerprint(ctx, agent) {
  const state = load(ctx);
  if (!state) return '';
  return hash(JSON.stringify([state.memoryDir, read(targets(ctx)[agent]), read(path.join(state.memoryDir, 'MEMORY.md'))]));
}

export function saveVerification(ctx, agent, result) {
  const p = path.join(ctx.configDir, 'verification.json');
  let results = {}; try { results = JSON.parse(read(p) || '{}'); } catch { /* Replace damaged derived evidence only. */ }
  results[agent] = { ...result, checkedAt: new Date().toISOString() };
  atomicWrite(p, JSON.stringify(results, null, 2));
}

export { read, hash, atomicWrite, noLink, load, lock, managed, apply, receipts, probe, claudeRule };

export function cleanTest(ctx) {
  return lock(ctx, () => {
    const p = probe(ctx), removed = [], kept = [];
    const fixture = path.join(p.root, 'inbox', p.fixture);
    if (exists(fixture)) {
      noLink(fixture);
      if (hash(read(fixture)) === p.fixtureHash) { fs.unlinkSync(fixture); removed.push(fixture); } else kept.push(fixture);
    }
    // Receipt notes are removed only after check recorded their exact content.
    for (const r of p.receipts) {
      if (path.basename(r.name) !== r.name) throw new Error('Unexpected receipt path in test state.');
      const file = path.join(p.root, 'inbox', r.name); noLink(file);
      if (!exists(file)) continue;
      if (hash(read(file)) === r.digest) { fs.unlinkSync(file); removed.push(file); } else kept.push(file);
    }
    fs.unlinkSync(probePath(ctx));
    return { removed, kept, note: 'Any unverified or subsequently edited notes were kept.' };
  });
}
