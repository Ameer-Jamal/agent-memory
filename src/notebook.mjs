import fs from 'node:fs';
import path from 'node:path';
import { load, read, hash, noLink, atomicWrite, lock } from './core.mjs';

const OMIT = new Set(['.git', '.obsidian', '.archive', 'node_modules', '.config', 'templates']);
const SENSITIVE = /(?:^|[-_ .])(?:secrets?|passwords?|credentials?|private[-_ ]?keys?)(?:[-_ .]|$)/iu;
export const SEARCH_CAP = 4000;

export function notebook(ctx) {
  const state = load(ctx);
  if (!state) throw new Error('Run setup first.');
  return state;
}

export function walkMarkdown(root, maxFiles = 10000) {
  const files = [], pending = [root]; let partial = false, visited = 0;
  while (pending.length && files.length < maxFiles && visited < maxFiles * 4) {
    const directory = pending.shift();
    noLink(directory);
    const dir = fs.opendirSync(directory);
    try {
      for (let entry; (entry = dir.readSync());) {
        visited++;
        if (visited >= maxFiles * 4 || files.length >= maxFiles) { partial = true; break; }
        if (entry.name.startsWith('.') || SENSITIVE.test(entry.name) || OMIT.has(entry.name) || entry.isSymbolicLink()) continue;
        const p = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(p);
        else if (entry.isFile() && entry.name.endsWith('.md')) files.push(p);
      }
    } finally { dir.closeSync(); }
  }
  return { files, partial: partial || pending.length > 0 };
}

function head(file, budget, maximum = 65536) {
  noLink(file);
  const size = fs.statSync(file).size;
  const length = Math.min(size, maximum, budget.remaining);
  if (length < size) budget.partial = true;
  if (length <= 0) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const n = fs.readSync(fd, buffer, 0, length, 0);
    budget.remaining -= n;
    return buffer.toString('utf8', 0, n);
  } finally { fs.closeSync(fd); }
}

function title(text, file) { return (text.match(/^#\s+(.+)$/mu)?.[1] || path.basename(file, '.md')).slice(0, 160); }
function bounded(value, key, cap = SEARCH_CAP) {
  while (JSON.stringify(value).length > cap && value[key]?.length) { value[key].pop(); value.outputTruncated = true; }
  return value;
}

export function search(ctx, query, { limit = 8, source = 'memory' } = {}) {
  const state = notebook(ctx);
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Use a short query of up to 200 characters.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('Search returns 1–8 hits. Narrow the query instead of increasing the cap.');
  if (!['memory', 'notes'].includes(source)) throw new Error('Choose source memory or notes.');
  if (source === 'notes' && !state.notesDir) throw new Error('No optional notes source is configured.');
  const root = source === 'notes' ? state.notesDir : state.memoryDir;
  const roots = source === 'notes' ? [root] : ['topics', 'inbox'].map(d => path.join(root, d));
  const terms = [...new Set(query.toLowerCase().trim().split(/\s+/u))];
  let files = [], partial = false;
  for (const folder of roots) {
    if (!fs.existsSync(folder)) continue;
    const result = walkMarkdown(folder, 10000 - files.length);
    files.push(...result.files); partial ||= result.partial;
  }
  const budget = { remaining: 8 * 1024 * 1024, partial: false };
  const matches = [], deferred = []; let scanned = 0;
  // Prefer file names and headings before searching bodies. All I/O stays local.
  for (const file of files) {
    if (!budget.remaining) { partial = true; break; }
    const text = head(file, budget, 2048), name = path.relative(root, file).replaceAll('\\', '/'), heading = title(text, file);
    const shelf = `${name} ${heading}`.toLowerCase(); scanned++;
    if (terms.every(t => shelf.includes(t))) matches.push({ path: name, title: heading, line: 1, match: 'title', score: 100 });
    else deferred.push({ file, name, heading });
  }
  if (matches.length < limit) {
    for (const item of deferred) {
      if (!budget.remaining) { partial = true; break; }
      const text = head(item.file, budget), lower = `${item.name} ${item.heading}\n${text}`.toLowerCase();
      if (!terms.every(t => lower.includes(t))) continue;
      const lines = text.split('\n');
      let i = lines.findIndex(line => terms.every(t => line.toLowerCase().includes(t)));
      if (i < 0) i = lines.findIndex(line => terms.some(t => line.toLowerCase().includes(t)));
      matches.push({ path: item.name, title: item.heading, line: Math.max(1, i + 1), match: 'text', snippet: (lines[i] || '').slice(0, 180), score: 10 });
      if (matches.length >= limit * 2) break;
    }
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return bounded({ query, source, hits: matches.slice(0, limit).map(({ score, ...hit }) => hit), scanned, partial: partial || budget.partial, outputTruncated: false, guidance: matches.length ? 'Open only a matching excerpt. Start with at most two notes.' : 'No useful match in the scanned notes. Continue with current evidence; narrow scope if scan was partial.' }, 'hits');
}

export function show(ctx, relative, { start = 1, lines = 40, source = 'memory' } = {}) {
  const state = notebook(ctx);
  if (!['memory', 'notes'].includes(source) || (source === 'notes' && !state.notesDir)) throw new Error('Choose memory or a configured notes source.');
  const root = source === 'notes' ? state.notesDir : state.memoryDir;
  if (!relative || path.isAbsolute(relative) || !relative.endsWith('.md')) throw new Error('Choose a relative Markdown path inside your memory folder.');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || relative.split(/[\\/]/u).some(s => s.startsWith('.'))) throw new Error('Choose a visible note inside your memory folder.');
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(lines) || lines < 1 || lines > 60) throw new Error('Use --start 1 or higher and --lines between 1 and 60.');
  noLink(file);
  const budget = { remaining: 256 * 1024, partial: false };
  const all = head(file, budget, 256 * 1024).split('\n');
  let excerpt = all.slice(start - 1, start - 1 + lines).map((line, i) => `${start + i}: ${line}`).join('\n');
  const result = { path: relative, start, lines: Math.min(lines, Math.max(0, all.length - start + 1)), excerpt, truncated: budget.partial };
  while (JSON.stringify(result).length > SEARCH_CAP && excerpt.length) { excerpt = excerpt.slice(0, -200); result.excerpt = excerpt; result.truncated = true; }
  return result;
}

export function maintenance(ctx, { archiveDuplicates = false, reindex = false, now = new Date() } = {}) {
  const state = notebook(ctx), root = state.memoryDir;
  let scanPartial = false;
  const files = ['topics', 'inbox'].flatMap(d => {
    if (!fs.existsSync(path.join(root, d))) return [];
    const scan = walkMarkdown(path.join(root, d), 2500);
    scanPartial ||= scan.partial;
    return scan.files;
  });
  const budget = { remaining: 16 * 1024 * 1024, partial: false }, notes = [];
  for (const file of files) {
    const text = head(file, budget, 256 * 1024);
    if (!budget.remaining) break;
    if (/test.only/iu.test(text) || fs.statSync(file).size > 256 * 1024) continue;
    const get = key => text.match(new RegExp(`^${key}:\\s*(.+)$`, 'mu'))?.[1]?.trim();
    notes.push({ file, text, title: title(text, file), scope: get('scope') || '', verified: get('last_verified'), status: get('status'), digest: hash(text) });
  }
  const duplicateGroups = new Map(), titles = new Map(), stale = [], actions = [];
  notes.sort((a, b) => (a.file.includes(`${path.sep}topics${path.sep}`) ? 0 : 1) - (b.file.includes(`${path.sep}topics${path.sep}`) ? 0 : 1) || a.file.localeCompare(b.file));
  for (const note of notes) {
    const key = note.digest;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(note);
    const group = `${note.title.toLowerCase()}|${note.scope.toLowerCase()}`;
    if (!titles.has(group)) titles.set(group, []);
    titles.get(group).push(note);
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(note.verified || '') ? Date.parse(note.verified) : NaN;
    if (note.status === 'verified' && Number.isFinite(date) && now.getTime() - date > 180 * 86400000) stale.push(path.relative(root, note.file));
  }
  const duplicates = [...duplicateGroups.values()].filter(g => g.length > 1);
  if (archiveDuplicates) for (const group of duplicates) for (const note of group.slice(1)) {
    if (actions.length >= 50) break;
    actions.push({ type: 'archive', from: note.file, to: path.join(root, '.archive', `${path.basename(note.file, '.md')}-${hash(path.relative(root, note.file)).slice(0, 8)}-${note.digest.slice(0, 8)}.md`), digest: note.digest });
  }
  if (reindex) {
    const file = path.join(root, 'INDEX.md'), before = read(file) || '';
    const startMarker = '<!-- agent-memory:shelf:start -->', endMarker = '<!-- agent-memory:shelf:end -->';
    const start = before.indexOf(startMarker), end = before.indexOf(endMarker);
    if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) throw new Error('The generated shelf markers in INDEX.md need repair.');
    const archived = new Set(actions.map(a => a.from));
    const shelf = notes.filter(n => !archived.has(n.file)).slice(0, 50).map(n => `- ${n.title.replace(/[<>]/gu, '')} — ${path.relative(root, n.file).replaceAll('\\', '/')}`).join('\n');
    const block = `${startMarker}\n## Generated shelf (up to 50 titles; search for more)\n${shelf}\n${endMarker}`;
    const after = start >= 0 ? before.slice(0, start) + block + before.slice(end + endMarker.length) : before + '\n' + block + '\n';
    if (before !== after) actions.push({ type: 'index', file, digest: hash(before), before, after });
  }
  const plan = { root, actions, createdAt: now.toISOString() };
  plan.id = hash(JSON.stringify(plan)).slice(0, 16);
  const summary = { planId: plan.id, scanned: notes.length, partial: scanPartial || budget.partial, duplicates: duplicates.slice(0, 20).map(g => g.slice(0, 8).map(n => path.relative(root, n.file))), stale: stale.slice(0, 20), possibleConflicts: [...titles.values()].filter(g => new Set(g.map(n => n.digest)).size > 1).slice(0, 10).map(g => g.slice(0, 8).map(n => path.relative(root, n.file))), actions: actions.map(a => ({ type: a.type, path: path.relative(root, a.from || a.file) })), actionCount: actions.length, note: 'Exact duplicates only. Same-title notes are review candidates, not proven contradictions. Nothing changes until explicitly applied.' };
  while (JSON.stringify(summary).length > 8000) {
    const key = ['duplicates', 'stale', 'possibleConflicts', 'actions'].sort((a, b) => JSON.stringify(summary[b]).length - JSON.stringify(summary[a]).length)[0];
    summary[key].pop(); summary.outputTruncated = true;
  }
  return { plan, summary };
}

export function previewMaintenance(ctx, options) {
  return lock(ctx, () => { const result = maintenance(ctx, options); atomicWrite(path.join(ctx.configDir, 'maintenance-plan.json'), JSON.stringify(result.plan)); return result.summary; });
}

export function applyMaintenance(ctx, id) {
  return lock(ctx, () => {
    if (fs.existsSync(path.join(ctx.configDir, 'probe.json'))) throw new Error('Clean the active memory test before maintaining notes.');
    const state = notebook(ctx), plan = JSON.parse(read(path.join(ctx.configDir, 'maintenance-plan.json')) || '{}');
    if (!id || plan.id !== id || plan.root !== state.memoryDir || !Array.isArray(plan.actions)) throw new Error('Preview maintenance first and use its exact plan ID.');
    const inside = p => typeof p === 'string' && p.startsWith(state.memoryDir + path.sep);
    for (const a of plan.actions) {
      if (!['archive', 'index'].includes(a.type) || !inside(a.from || a.file) || (a.type === 'archive' && (!inside(a.to) || !a.to.startsWith(path.join(state.memoryDir, '.archive') + path.sep)))) throw new Error('Unexpected maintenance path.');
      noLink(a.from || a.file); if (a.to) noLink(a.to);
      if (hash(read(a.from || a.file) || '') !== a.digest) throw new Error('A note changed since the preview. Preview again before applying.');
      if (a.to && fs.existsSync(a.to)) throw new Error('An archive target already exists; no files were changed.');
    }
    const done = [];
    try {
      for (const a of plan.actions) {
        if (a.type === 'archive') { fs.mkdirSync(path.dirname(a.to), { recursive: true, mode: 0o700 }); fs.renameSync(a.from, a.to); }
        else {
          atomicWrite(path.join(ctx.configDir, 'backups', `index-${Date.now()}.md`), a.before);
          atomicWrite(a.file, a.after);
        }
        done.push(a);
      }
    } catch (e) {
      for (const a of done.reverse()) {
        if (a.type === 'archive') { if (!fs.existsSync(a.from) && hash(read(a.to) || '') === a.digest) fs.renameSync(a.to, a.from); }
        else if (read(a.file) === a.after) atomicWrite(a.file, a.before);
      }
      throw e;
    }
    fs.unlinkSync(path.join(ctx.configDir, 'maintenance-plan.json'));
    return { applied: done.length, notesDeleted: 0, archive: path.join(state.memoryDir, '.archive') };
  });
}
