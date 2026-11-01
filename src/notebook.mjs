import fs from 'node:fs';
import path from 'node:path';
import { load, read, hash, noLink, atomicWrite, lock } from './core.mjs';

const OMIT = new Set(['.git', '.obsidian', '.archive', 'node_modules', '.config', 'templates']);
const SENSITIVE = /(?:^|[-_ .])(?:secrets?|passwords?|credentials?|private[-_ ]?keys?)(?:[-_ .]|$)/iu;
export const SEARCH_CAP = 4000;

const SECRET_PATTERNS = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u],
  ['API token', /\b(?:ghp_|gho_|ghs_|github_pat_|sk-proj-|sk-ant-|xox[abprs]-)[A-Za-z0-9_-]{10,}|\bsk-[A-Za-z0-9]{32,}|\bAIza[0-9A-Za-z_-]{35}\b|\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/u],
  ['URL with embedded password', /https?:\/\/[^\s/:@]+:[^\s/@]+@/u],
];
// A secret-like name assigned a literal of 8+ characters. Anchored on the keyword with a bounded suffix, so scanning is linear.
const ASSIGNMENT = /(password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token)[\w.-]{0,40}["']?[ \t]*[:=][ \t]*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"']+))/giu;
function literalAssignment(text) {
  for (const [, keyword, double, single, bare] of text.matchAll(ASSIGNMENT)) {
    const quoted = double ?? single, value = quoted ?? bare.replace(/[.,;]+$/u, '');
    if (value.length < 8 || /^[$<{%(]/u.test(value)) continue;
    if (quoted !== undefined) return true;
    if (/^(?:(?:process\.)?env\.|(?:os\.)?environ(?:\[|\.)|(?:os\.)?getenv\s*\(|[\w.]+\s*\()/u.test(value)) continue;
    // Words like "secret: required" are prose; weaker names need a digit or symbol alongside letters.
    if (/^(?:password|passwd|pwd|api|access)/iu.test(keyword) || (/[A-Za-z]/u.test(value) && /[\d!@#$%^&*+/=,]/u.test(value))) return true;
  }
  return false;
}
/** Returns the kind of credential the text appears to contain, or null. Not a complete secret scanner. */
export function findSecret(text) {
  const hit = SECRET_PATTERNS.find(([, re]) => re.test(text))?.[0];
  return hit ?? (literalAssignment(text) ? 'password or key assignment' : null);
}

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
const BM25_K1 = 1.2, BM25_B = 0.75, RECENCY = 0.1;
const FIELD_WEIGHT = { title: 3, tags: 2, headings: 1.5, body: 1 };
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const count = (text, term) => text.split(term).length - 1;
function fieldsOf(shelf, text) {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] || '';
  const tags = front.match(/^tags:\s*(.*)$/mu)?.[1] || '';
  const headings = (text.match(/^#{1,6}\s+.+$/gmu) || []).join('\n');
  return { title: shelf.toLowerCase(), tags: tags.toLowerCase(), headings: headings.toLowerCase(), body: text.toLowerCase() };
}
function bounded(value, key, cap = SEARCH_CAP) {
  while (JSON.stringify(value).length > cap && value[key]?.length) { value[key].pop(); value.outputTruncated = true; }
  return value;
}

export function search(ctx, query, { limit = 8, source = 'memory', now = Date.now() } = {}) {
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
  const weighted = (fields, term) => Object.entries(FIELD_WEIGHT).reduce((sum, [f, w]) => sum + w * count(fields[f], term), 0);
  const df = terms.map(() => 0), candidates = [], deferred = []; let scanned = 0;
  // Cheap pass over every file: name, heading and a 2 KiB prefix. Deep reads are limited to likely matches.
  for (const file of files) {
    if (!budget.remaining) { partial = true; break; }
    const text = head(file, budget, 2048), name = path.relative(root, file).replaceAll('\\', '/'), heading = title(text, file);
    scanned++;
    const fields = fieldsOf(`${name} ${heading}`, text), tf = terms.map(t => weighted(fields, t));
    tf.forEach((n, i) => { if (n > 0) df[i]++; });
    const item = { file, name, heading };
    if (tf.every(n => n > 0)) candidates.push({ ...item, text, tf, length: Math.max(1, text.split(/\s+/u).length), titleHit: terms.every(t => fields.title.includes(t)) });
    else deferred.push(item);
  }
  // A deep read enriches an existing match; it must never be required to return
  // a title/prefix match already found within the shared I/O budget.
  const docs = new Map(candidates.map(item => [item.file, item]));
  let totalLength = candidates.reduce((sum, item) => sum + item.length, 0), deepCount = candidates.length;
  const deep = item => {
    const text = head(item.file, budget), fields = fieldsOf(`${item.name} ${item.heading}`, text), tf = terms.map(t => weighted(fields, t)), length = Math.max(1, text.split(/\s+/u).length);
    const previous = docs.get(item.file);
    if (previous && text.length < previous.text.length) return;
    totalLength += length - (previous?.length || 0); if (!previous) deepCount++;
    if (tf.every(n => n > 0)) docs.set(item.file, { ...item, text, tf, length, titleHit: terms.every(t => fields.title.includes(t)) });
  };
  for (const item of candidates) { if (!budget.remaining) { partial = true; break; } deep(item); }
  for (const item of deferred) {
    if (docs.size >= limit) break;
    if (!budget.remaining) { partial = true; break; }
    deep(item);
  }
  // BM25 over weighted fields (title > tags > headings > body), AND semantics, mild recency boost.
  const average = totalLength / Math.max(1, deepCount), idf = df.map(n => Math.log(1 + (scanned - n + 0.5) / (n + 0.5)));
  const matches = [...docs.values()].map(d => {
    const bm25 = d.tf.reduce((sum, f, i) => sum + idf[i] * f * (BM25_K1 + 1) / (f + BM25_K1 * (1 - BM25_B + BM25_B * d.length / average)), 0);
    const age = Math.max(0, now - fs.statSync(d.file).mtimeMs) / 86400000;
    const score = bm25 * (1 + RECENCY * Math.max(0, 1 - age / 365));
    if (d.titleHit) return { path: d.name, title: d.heading, line: 1, match: 'title', score };
    const lines = d.text.split('\n'), lower = lines.map(l => l.toLowerCase());
    let i = lower.findIndex(l => terms.every(t => l.includes(t)));
    if (i < 0) i = lower.findIndex(l => terms.some(t => l.includes(t)));
    return { path: d.name, title: d.heading, line: Math.max(1, i + 1), match: 'text', snippet: (lines[i] || '').slice(0, 180), score };
  });
  matches.sort((a, b) => b.score - a.score || cmp(a.path, b.path));
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

export function maintenance(ctx, { archiveDuplicates = false, reindex = false, promote, now = new Date() } = {}) {
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
  if (promote !== undefined) {
    if (typeof promote !== 'string' || !promote.startsWith('inbox/') || !promote.endsWith('.md') || path.isAbsolute(promote) || promote.split(/[\\/]/u).some(s => !s || s.startsWith('.'))) throw new Error('Choose a visible Markdown note inside inbox/ to promote.');
    if (promote.split(/[\\/]/u).some(seg => SENSITIVE.test(seg) || OMIT.has(seg))) throw new Error('Not promoting: search skips this name (secret/password/credential/private-key or tooling folders). Rename the inbox note first.');
    const from = path.resolve(root, promote);
    if (!from.startsWith(path.join(root, 'inbox') + path.sep)) throw new Error('Choose a visible Markdown note inside inbox/ to promote.');
    noLink(path.join(root, 'inbox')); noLink(from);
    if (!fs.statSync(from, { throwIfNoEntry: false })?.isFile()) throw new Error('That inbox note does not exist.');
    if (fs.statSync(from).size > 256 * 1024) throw new Error('That note is too large to promote; shorten it first.');
    if (actions.some(a => a.from === from)) throw new Error('That note is already planned for archiving.');
    const text = read(from), kind = findSecret(text);
    if (kind) throw new Error(`Not promoting: the note appears to contain a credential (${kind}). Remove it first.`);
    const to = path.join(root, 'topics', path.basename(from));
    if (fs.existsSync(to)) throw new Error('A topic with that file name already exists; rename the inbox note first.');
    actions.push({ type: 'promote', from, to, digest: hash(text) });
  }
  if (reindex) {
    const file = path.join(root, 'INDEX.md'), before = read(file) || '';
    const startMarker = '<!-- agent-memory:shelf:start -->', endMarker = '<!-- agent-memory:shelf:end -->';
    const start = before.indexOf(startMarker), end = before.indexOf(endMarker);
    if ((start >= 0) !== (end >= 0) || (start >= 0 && end < start)) throw new Error('The generated shelf markers in INDEX.md need repair.');
    const archived = new Set(actions.filter(a => a.type === 'archive').map(a => a.from));
    const promoted = new Map(actions.filter(a => a.type === 'promote').map(a => [a.from, a.to]));
    const shelf = notes.filter(n => !archived.has(n.file)).slice(0, 50).map(n => `- ${n.title.replace(/[<>]/gu, '')} — ${path.relative(root, promoted.get(n.file) || n.file).replaceAll('\\', '/')}`).join('\n');
    const block = `${startMarker}\n## Generated shelf (up to 50 titles; search for more)\n${shelf}\n${endMarker}`;
    const after = start >= 0 ? before.slice(0, start) + block + before.slice(end + endMarker.length) : before + '\n' + block + '\n';
    if (before !== after) actions.push({ type: 'index', file, digest: hash(before), before, after });
  }
  const plan = { root, actions, createdAt: now.toISOString() };
  plan.id = hash(JSON.stringify(plan)).slice(0, 16);
  const summary = { planId: plan.id, scanned: notes.length, partial: scanPartial || budget.partial, duplicates: duplicates.slice(0, 20).map(g => g.slice(0, 8).map(n => path.relative(root, n.file))), stale: stale.slice(0, 20), possibleConflicts: [...titles.values()].filter(g => new Set(g.map(n => n.digest)).size > 1).slice(0, 10).map(g => g.slice(0, 8).map(n => path.relative(root, n.file))), actions: actions.map(a => ({ type: a.type, path: path.relative(root, a.from || a.file).replaceAll('\\', '/') })), actionCount: actions.length, note: 'Exact duplicates only. Same-title notes are review candidates, not proven contradictions. Nothing changes until explicitly applied.' };
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
    const { id: storedId, ...payload } = plan;
    if (hash(JSON.stringify(payload)).slice(0, 16) !== storedId) throw new Error('Maintenance plan changed; preview again and use its exact plan ID.');
    const inside = (p, folder = state.memoryDir) => {
      if (typeof p !== 'string' || p !== path.resolve(p)) return false;
      const relative = path.relative(folder, p);
      return relative !== '' && !path.isAbsolute(relative) && !relative.split(path.sep).some(s => s.startsWith('.'));
    };
    for (const a of plan.actions) {
      const target = { archive: '.archive', promote: 'topics' }[a.type];
      if (!['archive', 'index', 'promote'].includes(a.type) || !inside(a.from || a.file) || (target && !inside(a.to, path.join(state.memoryDir, target))) || (a.type === 'index' && a.file !== path.join(state.memoryDir, 'INDEX.md')) || (a.type === 'promote' && (!inside(a.from, path.join(state.memoryDir, 'inbox')) || !a.from.endsWith('.md') || a.to !== path.join(state.memoryDir, 'topics', path.basename(a.from))))) throw new Error('Unexpected maintenance path.');
      noLink(a.from || a.file); if (a.to) noLink(a.to);
      if (hash(read(a.from || a.file) || '') !== a.digest) throw new Error('A note changed since the preview. Preview again before applying.');
      if (a.to && fs.existsSync(a.to)) throw new Error('A destination file already exists; no files were changed.');
    }
    const done = [];
    try {
      for (const a of plan.actions) {
        if (a.type !== 'index') { fs.mkdirSync(path.dirname(a.to), { recursive: true, mode: 0o700 }); fs.renameSync(a.from, a.to); }
        else {
          atomicWrite(path.join(ctx.configDir, 'backups', `index-${Date.now()}.md`), a.before);
          atomicWrite(a.file, a.after);
        }
        done.push(a);
      }
    } catch (e) {
      for (const a of done.reverse()) {
        if (a.type !== 'index') { if (!fs.existsSync(a.from) && hash(read(a.to) || '') === a.digest) fs.renameSync(a.to, a.from); }
        else if (read(a.file) === a.after) atomicWrite(a.file, a.before);
      }
      throw e;
    }
    fs.unlinkSync(path.join(ctx.configDir, 'maintenance-plan.json'));
    return { applied: done.length, notesDeleted: 0, archive: path.join(state.memoryDir, '.archive') };
  });
}
