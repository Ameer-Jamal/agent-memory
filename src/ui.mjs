import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ADAPTERS } from './adapters.mjs';
import { doctor, detect, discoverObsidian, planSetup, install, instructions, prepareTest, checkTest, cleanTest, read } from './core.mjs';
import { search, show, previewMaintenance, applyMaintenance } from './notebook.mjs';
import { planProject, connectProject } from './projects.mjs';
import { verifyLive } from './verification.mjs';

const exec = promisify(execFile);
const web = fileURLToPath(new URL('../web/', import.meta.url));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signature = plan => digest([plan.changes, plan.state.records.map(r => [r.path, read(r.path)])]);
const summary = p => ({ memoryDir: p.root, changes: p.changes.map(c => ({ path: c.path, action: c.after === null ? 'remove' : c.before === null ? 'create' : 'update' })), warnings: p.warnings || [] });

export async function pickFolder() {
  let command, args;
  if (process.platform === 'darwin') { command = '/usr/bin/osascript'; args = ['-e', 'POSIX path of (choose folder with prompt "Choose a folder for Agent Memory")']; }
  else if (process.platform === 'win32') { command = 'powershell.exe'; args = ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "Choose a folder for Agent Memory"; if ($dialog.ShowDialog() -eq "OK") { [Console]::WriteLine($dialog.SelectedPath) }']; }
  else { command = 'zenity'; args = ['--file-selection', '--directory', '--title=Choose a folder for Agent Memory']; }
  try { const result = await exec(command, args, { timeout: 120000, maxBuffer: 8192, windowsHide: true }); return result.stdout.trim(); }
  catch (e) { if (e.code === 'ENOENT') throw new Error('No native folder picker is available. Paste a folder path instead (Linux can install zenity).'); return ''; }
}

export async function serveUI(ctx, { port = 0, open = true, idleMs = 15 * 60 * 1000, folderPicker = pickFolder } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const previews = new Map(); let origin, timer, busy = false;
  const reset = () => { clearTimeout(timer); timer = setTimeout(() => server.close(), idleMs); timer.unref(); };
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const options = b => ({ memoryDir: b.memoryDir, notesDir: b.notesDir || undefined, agents: b.agents, allowCapture: b.allowCapture === true, upgradePolicy: b.upgradePolicy === true });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { json(res, 403, { error: 'Local origin required.' }); return; }
      const url = new URL(req.url, origin);
      if (['/app.js', '/style.css'].includes(url.pathname) && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(fs.readFileSync(path.join(web, url.pathname.slice(1)))); return;
      }
      const provided = req.headers.authorization === `Bearer ${token}` || (url.pathname === '/' && url.searchParams.get('token') === token);
      if (!provided) { json(res, 401, { error: 'Use the private local URL printed by agent-memory ui.' }); return; }
      reset();
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(web, 'index.html'))); return; }
      if (!url.pathname.startsWith('/api/')) { json(res, 404, { error: 'Not found.' }); return; }
      let body = {};
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) { json(res, 415, { error: 'JSON required.' }); return; }
        let raw = '';
        for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 32768) { json(res, 413, { error: 'Request is too large.' }); return; } }
        body = JSON.parse(raw || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected an object.');
      } else if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed.' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        json(res, 200, { ...doctor(ctx), available: Object.entries(ADAPTERS).map(([id, a]) => ({ id, name: a.name, live: a.live, manual: a.manual })), detected: detect(ctx), vaults: discoverObsidian(ctx), defaultFolder: path.join(ctx.home, 'AgentMemory'), busy }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/instructions') { json(res, 200, { text: instructions(ctx, url.searchParams.get('agent') || undefined) }); return; }
      if (req.method === 'GET' && url.pathname === '/api/search') { json(res, 200, search(ctx, url.searchParams.get('q') || '', { source: url.searchParams.get('source') || 'memory' })); return; }
      if (req.method === 'GET' && url.pathname === '/api/show') { json(res, 200, show(ctx, url.searchParams.get('path'), { start: Number(url.searchParams.get('start') || 1), lines: 40 })); return; }
      if (req.method !== 'POST') { json(res, 405, { error: 'Use POST for actions.' }); return; }
      if (busy) { json(res, 409, { error: 'A live test is running. Wait for it to finish.' }); return; }
      if (url.pathname === '/api/pick-folder') { json(res, 200, { path: await folderPicker() }); return; }
      if (url.pathname === '/api/preview' || url.pathname === '/api/project-preview') {
        const project = url.pathname === '/api/project-preview';
        const input = project ? { path: body.path, remove: body.remove === true } : options(body);
        const plan = project ? planProject(ctx, input.path, { remove: input.remove }) : planSetup(ctx, input);
        const id = digest({ input, signature: signature(plan) });
        if (previews.size >= 20) previews.clear();
        previews.set(id, { input, project, hash: signature(plan) });
        json(res, 200, { ...summary(plan), previewId: id }); return;
      }
      if (url.pathname === '/api/install' || url.pathname === '/api/project-apply') {
        const p = previews.get(body.previewId);
        if (!p || p.project !== (url.pathname === '/api/project-apply')) throw new Error('Preview these changes first.');
        const plan = p.project ? planProject(ctx, p.input.path, { remove: p.input.remove }) : planSetup(ctx, p.input);
        if (signature(plan) !== p.hash) throw new Error('Files changed after preview. Review a fresh preview before applying.');
        const result = p.project ? connectProject(ctx, p.input.path, { remove: p.input.remove }) : summary(install(ctx, p.input));
        previews.delete(body.previewId); json(res, 200, { ...result, applied: true }); return;
      }
      if (url.pathname === '/api/maintain-preview') { json(res, 200, previewMaintenance(ctx, { archiveDuplicates: body.archiveDuplicates === true, reindex: body.reindex === true })); return; }
      if (url.pathname === '/api/maintain-apply') { json(res, 200, applyMaintenance(ctx, body.planId)); return; }
      if (url.pathname === '/api/test-prepare') { json(res, 200, prepareTest(ctx, { agent: body.agent || undefined })); return; }
      if (url.pathname === '/api/test-check') { json(res, 200, checkTest(ctx, body.answer)); return; }
      if (url.pathname === '/api/test-clean') { json(res, 200, cleanTest(ctx)); return; }
      if (url.pathname === '/api/verify') {
        if (body.live !== true) throw new Error('Live verification uses your agent provider; explicitly enable it first.');
        busy = true;
        try { json(res, 200, await verifyLive(ctx, body.agent, { live: true })); } finally { busy = false; reset(); }
        return;
      }
      json(res, 404, { error: 'Unknown action.' });
    } catch (e) { if (!res.headersSent) json(res, 400, { error: e instanceof SyntaxError ? 'Invalid JSON.' : e.message }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/?token=${token}`;
  reset(); server.on('close', () => clearTimeout(timer));
  if (open) {
    const spec = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
    const child = spawn(spec[0], spec[1], { stdio: 'ignore', detached: true, shell: false }); child.on('error', () => {}); child.unref();
  }
  return { server, url, token, origin, close: () => new Promise(resolve => server.close(resolve)) };
}
