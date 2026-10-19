import path from 'node:path';
import fs from 'node:fs';

export const ADAPTERS = {
  codex: { name: 'Codex', command: 'codex', live: true, docs: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md' },
  claude: { name: 'Claude Code', command: 'claude', live: true, docs: 'https://code.claude.com/docs/en/memory' },
  cursor: { name: 'Cursor', command: 'agent', live: false, manual: 'Check the account User Rule in Customize → Rules. Use instructions cursor to copy the pointer.', docs: 'https://cursor.com/help/customization/rules' },
  antigravity: { name: 'Antigravity', live: false, manual: 'Allow reads for the memory folder and writes for inbox/ in the app. Test in a fresh chat.', docs: 'https://antigravity.google/docs/rules/' },
  opencode: { name: 'OpenCode', command: 'opencode', live: true, docs: 'https://docs.opencode.ai/docs/rules/' },
  copilot: { name: 'GitHub Copilot CLI', command: 'copilot', live: false, manual: 'Use the guided read/write challenge in Copilot CLI. VS Code uses its own instruction settings.', docs: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions' },
  windsurf: { name: 'Windsurf / Cascade', command: 'windsurf', live: false, manual: 'Check global rules in Cascade. This connection does not establish support for other Devin agents.', docs: 'https://docs.windsurf.com/windsurf/cascade/memories' },
  cline: { name: 'Cline', command: 'cline', live: false, manual: 'Enable agent-memory.md in the Cline Rules panel and test in a fresh chat.', docs: 'https://docs.cline.bot/customization/cline-rules' },
};
export const AGENTS = Object.keys(ADAPTERS);

export function targets(ctx) {
  const h = ctx.home, env = ctx.env || {};
  const folder = (value, fallback) => value ? path.resolve(value === '~' ? h : value.startsWith('~/') || value.startsWith('~\\') ? path.join(h, value.slice(2)) : value) : fallback;
  return {
    codex: path.join(folder(env.CODEX_HOME, path.join(h, '.codex')), 'AGENTS.md'),
    claude: path.join(h, '.claude', 'CLAUDE.md'),
    cursor: path.join(h, '.cursor', 'rules', 'agent-memory.mdc'),
    antigravity: path.join(h, '.gemini', 'GEMINI.md'),
    opencode: path.join(folder(env.XDG_CONFIG_HOME, path.join(h, '.config')), 'opencode', 'AGENTS.md'),
    copilot: path.join(folder(env.COPILOT_HOME, path.join(h, '.copilot')), 'copilot-instructions.md'),
    windsurf: path.join(h, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
    cline: path.join(h, '.cline', 'rules', 'agent-memory.md'),
  };
}

export function executable(command, env = process.env) {
  if (!command) return null;
  const extensions = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const p = path.join(directory, command + ext.toLowerCase());
      try { fs.accessSync(p, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* Try next PATH entry. */ }
    }
  }
  return null;
}
