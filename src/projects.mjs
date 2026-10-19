import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load, read, expand, noLink, managed, lock, apply, targets } from './core.mjs';
import { pointer } from './templates.mjs';

const LOCAL = ['# agent-memory:local:start', '# agent-memory:local:end'];
export function planProject(ctx, directory, { remove = false } = {}) {
  const state = load(ctx);
  if (!state) throw new Error('Run setup to create your personal memory folder first.');
  const root = expand(directory, ctx.home);
  if (root === ctx.home || root === path.parse(root).root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Choose an existing project directory, not your home/root folder.');
  noLink(root);
  const file = path.join(root, 'AGENTS.md');
  if (Object.values(targets(ctx)).includes(file)) throw new Error('This is an agent config directory, not a project.');
  const next = structuredClone(state); next.projects ||= [];
  const changes = [], warnings = [];
  const owned = next.records.filter(r => r.project === root);
  const add = (p, before, after) => { if (before !== after) changes.push({ path: p, before, after, mode: before === null ? 0o600 : fs.statSync(p).mode & 0o777 }); };
  if (remove) {
    if (!next.projects.includes(root)) throw new Error('This project has no managed connection.');
    for (const r of owned) {
      noLink(r.path);
      const before = read(r.path); if (before === null) continue;
      if (before === r.installed) add(r.path, before, r.original);
      else {
        const markers = r.kind === 'exclude' ? LOCAL : [], block = managed(before, ...markers);
        if (!block) continue;
        if (block.content !== managed(r.installed, ...markers).content) throw new Error('A project memory block was edited. Review it before disconnecting.');
        add(r.path, before, before.slice(0, block.start) + before.slice(block.end));
      }
    }
    next.projects = next.projects.filter(p => p !== root); next.records = next.records.filter(r => r.project !== root);
  } else {
    noLink(file);
    const before = read(file), record = owned.find(r => r.path === file), block = managed(before || '');
    if (block && !record) throw new Error('This project has an unowned memory block. Use its original installer state.');
    if (record && (!block || block.content !== managed(record.installed).content)) throw new Error('The project block was changed. Review it before reconnecting.');
    const after = block ? before.slice(0, block.start) + pointer(state.memoryDir) + before.slice(block.end) : (before || '') + (before ? '\n\n' : '') + pointer(state.memoryDir) + '\n';
    add(file, before, after);
    if (!record) next.records.push({ path: file, kind: 'instruction', project: root, original: before, installed: after });
    else { const old = managed(record.installed); record.installed = record.installed.slice(0, old.start) + pointer(state.memoryDir) + record.installed.slice(old.end); }
    if (!next.projects.includes(root)) next.projects.push(root);
    // A new personal pointer is hidden from ordinary Git adds, using local-only excludes.
    const git = path.join(root, '.git');
    if (before === null && fs.existsSync(git) && fs.statSync(git).isDirectory()) {
      const exclude = path.join(git, 'info', 'exclude'); noLink(exclude);
      const old = read(exclude), block = `${LOCAL[0]}\n/AGENTS.md\n${LOCAL[1]}`;
      const afterExclude = (old || '') + '\n' + block + '\n';
      add(exclude, old, afterExclude);
      next.records.push({ path: exclude, kind: 'exclude', project: root, original: old, installed: afterExclude });
    } else {
      const tracked = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', 'AGENTS.md'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      if (tracked.status === 0 || !fs.existsSync(git) || fs.statSync(git).isFile()) warnings.push('The pointer contains your personal memory path. Keep its managed block out of commits; existing tracked files/worktrees are not automatically ignored.');
    }
  }
  return { root, changes, state: next, warnings, remove };
}

export function connectProject(ctx, directory, options) {
  return lock(ctx, () => { const plan = planProject(ctx, directory, options); apply(ctx, plan.changes, plan.state); return { path: plan.root, connected: !plan.remove, warnings: plan.warnings, notesCopied: 0 }; });
}
